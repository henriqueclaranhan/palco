import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type RenderTask,
} from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { LruPageCache, type RenderedPageEntry } from './pageCache';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface ViewportBounds {
  width: number;
  height: number;
}

const MAX_CACHE_PAGES = 5;
const MAX_DEVICE_PIXEL_RATIO = 2.25;
const PREFETCH_DELAY_MS = 180;
const SLIDE_BACKGROUND_COLOR = '#FFFFFF';

export class PdfEngine {
  private loadingTask: PDFDocumentLoadingTask | null = null;
  private doc: PDFDocumentProxy | null = null;
  private activeRenderTask: RenderTask | null = null;
  private readonly cache = new LruPageCache(MAX_CACHE_PAGES);
  private prefetchTimer: number | null = null;
  private docVersion = 0;

  async load(bytes: Uint8Array): Promise<number> {
    this.cancelPendingWork();
    this.cache.clear();
    this.docVersion += 1;

    if (this.loadingTask) {
      await this.loadingTask.destroy();
      this.loadingTask = null;
      this.doc = null;
    }

    // copy buffer since pdf.js transfers it to the worker and detaches the original
    const dataCopy = bytes.slice();
    const loadingTask = getDocument({ data: dataCopy, useSystemFonts: true });
    this.loadingTask = loadingTask;
    const doc = await loadingTask.promise;
    this.doc = doc;
    return doc.numPages;
  }

  get numPages(): number {
    return this.doc?.numPages ?? 0;
  }

  async renderPage(
    pageNumber: number,
    targetCanvas: HTMLCanvasElement,
    bounds: ViewportBounds
  ): Promise<ViewportBounds | null> {
    if (!this.isRenderable(pageNumber, bounds)) return null;

    const currentVersion = this.docVersion;
    this.cancelPendingWork();

    const cacheKey = this.buildCacheKey(pageNumber, bounds);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      blitToTargetCanvas(cached, targetCanvas);
      this.scheduleAdjacentPrefetch(pageNumber, bounds, currentVersion);
      return { width: cached.cssWidth, height: cached.cssHeight };
    }

    const rendered = await this.renderToOffscreen(
      pageNumber,
      bounds,
      currentVersion,
      true
    );
    if (!rendered) return null;

    this.cache.set(rendered);
    blitToTargetCanvas(rendered, targetCanvas);
    this.scheduleAdjacentPrefetch(pageNumber, bounds, currentVersion);
    return { width: rendered.cssWidth, height: rendered.cssHeight };
  }

  destroy(): void {
    this.cancelPendingWork();
    this.cache.clear();
    this.docVersion += 1;
    if (this.loadingTask) {
      void this.loadingTask.destroy();
      this.loadingTask = null;
    }
    this.doc = null;
  }

  private isRenderable(pageNumber: number, bounds: ViewportBounds): boolean {
    if (!this.doc) return false;
    if (bounds.width <= 0 || bounds.height <= 0) return false;
    return pageNumber >= 1 && pageNumber <= this.doc.numPages;
  }

  private cancelPendingWork(): void {
    if (this.prefetchTimer !== null) {
      window.clearTimeout(this.prefetchTimer);
      this.prefetchTimer = null;
    }
    if (this.activeRenderTask) {
      try {
        this.activeRenderTask.cancel();
      } catch {
        // already finished
      }
      this.activeRenderTask = null;
    }
  }

  private buildCacheKey(pageNumber: number, bounds: ViewportBounds): string {
    return `${this.docVersion}:${pageNumber}:${Math.round(bounds.width)}x${Math.round(bounds.height)}`;
  }

  private async renderToOffscreen(
    pageNumber: number,
    bounds: ViewportBounds,
    expectedVersion: number,
    trackActiveTask: boolean
  ): Promise<RenderedPageEntry | null> {
    if (!this.doc) return null;

    const page = await this.doc.getPage(pageNumber);
    if (expectedVersion !== this.docVersion) return null;

    const baseViewport = page.getViewport({ scale: 1 });
    const fitScale = Math.min(
      bounds.width / baseViewport.width,
      bounds.height / baseViewport.height
    );
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);

    const cssWidth = Math.max(1, Math.floor(baseViewport.width * fitScale));
    const cssHeight = Math.max(1, Math.floor(baseViewport.height * fitScale));
    const viewport = page.getViewport({ scale: fitScale * dpr });

    const offscreen = document.createElement('canvas');
    offscreen.width = Math.max(1, Math.floor(viewport.width));
    offscreen.height = Math.max(1, Math.floor(viewport.height));

    const ctx = offscreen.getContext('2d', { alpha: false });
    if (!ctx) return null;

    ctx.fillStyle = SLIDE_BACKGROUND_COLOR;
    ctx.fillRect(0, 0, offscreen.width, offscreen.height);

    const renderTask = page.render({
      canvas: offscreen,
      canvasContext: ctx,
      viewport,
    });
    if (trackActiveTask) {
      this.activeRenderTask = renderTask;
    }

    try {
      await renderTask.promise;
    } catch (err) {
      if (isCancelledRenderError(err)) return null;
      throw err;
    } finally {
      if (trackActiveTask && this.activeRenderTask === renderTask) {
        this.activeRenderTask = null;
      }
    }

    if (expectedVersion !== this.docVersion) return null;

    return {
      key: this.buildCacheKey(pageNumber, bounds),
      canvas: offscreen,
      cssWidth,
      cssHeight,
    };
  }

  private scheduleAdjacentPrefetch(
    currentPage: number,
    bounds: ViewportBounds,
    expectedVersion: number
  ): void {
    if (!this.doc) return;
    const total = this.doc.numPages;
    const adjacentPages = [currentPage + 1, currentPage - 1].filter(
      (pageNum) => pageNum >= 1 && pageNum <= total
    );
    if (adjacentPages.length === 0) return;

    this.prefetchTimer = window.setTimeout(async () => {
      for (const pageNum of adjacentPages) {
        if (expectedVersion !== this.docVersion || !this.doc) return;
        const key = this.buildCacheKey(pageNum, bounds);
        if (this.cache.has(key)) continue;

        try {
          const entry = await this.renderToOffscreen(
            pageNum,
            bounds,
            expectedVersion,
            false
          );
          if (entry) {
            this.cache.set(entry);
          }
        } catch {
          // prefetch can fail silently
        }
      }
    }, PREFETCH_DELAY_MS);
  }
}

function blitToTargetCanvas(
  entry: RenderedPageEntry,
  targetCanvas: HTMLCanvasElement
): void {
  targetCanvas.width = entry.canvas.width;
  targetCanvas.height = entry.canvas.height;
  targetCanvas.style.width = `${entry.cssWidth}px`;
  targetCanvas.style.height = `${entry.cssHeight}px`;

  const ctx = targetCanvas.getContext('2d', { alpha: false });
  if (!ctx) return;
  ctx.drawImage(entry.canvas, 0, 0);
}

function isCancelledRenderError(err: unknown): boolean {
  return err instanceof Error && err.name === 'RenderingCancelledException';
}
