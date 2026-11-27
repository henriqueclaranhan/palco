import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type RenderTask,
} from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { LruPageCache, type RenderedPageEntry } from './pageCache';
import { classifyPdfLoadError } from '@/domain/pdfErrors';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface ViewportBounds {
  width: number;
  height: number;
}

export const SLIDE_THUMBNAIL_BOUNDS: ViewportBounds = {
  width: 240,
  height: 180,
};

const MAX_CACHE_PAGES = 5;
const MAX_THUMBNAIL_CACHE_PAGES = 96;
const MAX_DEVICE_PIXEL_RATIO = 2.25;
const MAX_THUMBNAIL_PIXEL_RATIO = 1.5;
const MAX_CONCURRENT_THUMBNAIL_RENDERS = 2;
const PREFETCH_DELAY_MS = 180;
const SLIDE_BACKGROUND_COLOR = '#FFFFFF';
const DEFAULT_SLIDE_ASPECT_RATIO = 16 / 9;

interface OffscreenRenderOptions {
  pageNumber: number;
  bounds: ViewportBounds;
  expectedVersion: number;
  cacheKey: string;
  maxDpr: number;
  trackActiveTask: boolean;
  signal?: AbortSignal;
}

export interface PdfLoadOptions {
  password?: string;
}

export class PdfEngine {
  private loadingTask: PDFDocumentLoadingTask | null = null;
  private pendingLoadTask: PDFDocumentLoadingTask | null = null;
  private doc: PDFDocumentProxy | null = null;
  private activeRenderTask: RenderTask | null = null;
  private readonly cache = new LruPageCache(MAX_CACHE_PAGES);
  private readonly thumbnailCache = new LruPageCache(MAX_THUMBNAIL_CACHE_PAGES);
  private activeThumbnailRenders = 0;
  private thumbnailWaiters: Array<(granted: boolean) => void> = [];
  private defaultAspectRatio: number | null = null;
  private prefetchTimer: number | null = null;
  private docVersion = 0;

  async load(bytes: Uint8Array, options?: PdfLoadOptions): Promise<number> {
    if (this.pendingLoadTask) {
      const stale = this.pendingLoadTask;
      this.pendingLoadTask = null;
      void stale.destroy().catch(() => undefined);
    }

    // copy buffer since pdf.js transfers it to the worker and detaches the original
    const dataCopy = bytes.slice();
    const loadingTask = getDocument({
      data: dataCopy,
      password: options?.password,
      useSystemFonts: true,
    });
    this.pendingLoadTask = loadingTask;

    let doc: PDFDocumentProxy;
    try {
      doc = await loadingTask.promise;
    } catch (err) {
      if (this.pendingLoadTask === loadingTask) {
        this.pendingLoadTask = null;
      }
      void loadingTask.destroy().catch(() => undefined);
      throw classifyPdfLoadError(err);
    }

    if (this.pendingLoadTask !== loadingTask) {
      void loadingTask.destroy().catch(() => undefined);
      return doc.numPages;
    }

    this.pendingLoadTask = null;
    this.cancelPendingWork();
    this.flushThumbnailWaiters();
    this.cache.clear();
    this.thumbnailCache.clear();
    this.defaultAspectRatio = null;
    this.docVersion += 1;

    if (this.loadingTask) {
      const previous = this.loadingTask;
      this.loadingTask = null;
      this.doc = null;
      await previous.destroy().catch(() => undefined);
    }

    this.loadingTask = loadingTask;
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
      blitToCanvas(cached, targetCanvas, true);
      this.scheduleAdjacentPrefetch(pageNumber, bounds, currentVersion);
      return { width: cached.cssWidth, height: cached.cssHeight };
    }

    const rendered = await this.renderOffscreenPage({
      pageNumber,
      bounds,
      expectedVersion: currentVersion,
      cacheKey,
      maxDpr: MAX_DEVICE_PIXEL_RATIO,
      trackActiveTask: true,
    });
    if (!rendered) return null;

    this.cache.set(rendered);
    blitToCanvas(rendered, targetCanvas, true);
    this.scheduleAdjacentPrefetch(pageNumber, bounds, currentVersion);
    return { width: rendered.cssWidth, height: rendered.cssHeight };
  }

  async getDefaultAspectRatio(): Promise<number> {
    if (this.defaultAspectRatio !== null) {
      return this.defaultAspectRatio;
    }
    if (!this.doc || this.doc.numPages < 1) {
      return DEFAULT_SLIDE_ASPECT_RATIO;
    }

    const currentVersion = this.docVersion;
    try {
      const page = await this.doc.getPage(1);
      if (currentVersion !== this.docVersion) {
        return DEFAULT_SLIDE_ASPECT_RATIO;
      }
      const viewport = page.getViewport({ scale: 1 });
      if (viewport.width > 0 && viewport.height > 0) {
        const ratio = Math.min(2.4, Math.max(0.6, viewport.width / viewport.height));
        this.defaultAspectRatio = ratio;
        return ratio;
      }
    } catch {
      // fall back to default 16:9 aspect ratio
    }
    return DEFAULT_SLIDE_ASPECT_RATIO;
  }

  async renderThumbnail(
    pageNumber: number,
    targetCanvas: HTMLCanvasElement,
    bounds: ViewportBounds,
    signal?: AbortSignal
  ): Promise<ViewportBounds | null> {
    if (!this.isRenderable(pageNumber, bounds) || signal?.aborted) return null;

    const currentVersion = this.docVersion;
    const cacheKey = this.buildThumbnailCacheKey(pageNumber, bounds);
    const cached = this.thumbnailCache.get(cacheKey);
    if (cached) {
      blitToCanvas(cached, targetCanvas, false);
      return { width: cached.cssWidth, height: cached.cssHeight };
    }

    const acquired = await this.acquireThumbnailSlot(signal);
    if (!acquired) return null;

    try {
      if (currentVersion !== this.docVersion || signal?.aborted || !this.doc) {
        return null;
      }

      const cachedAfterWait = this.thumbnailCache.get(cacheKey);
      if (cachedAfterWait) {
        blitToCanvas(cachedAfterWait, targetCanvas, false);
        return {
          width: cachedAfterWait.cssWidth,
          height: cachedAfterWait.cssHeight,
        };
      }

      const rendered = await this.renderOffscreenPage({
        pageNumber,
        bounds,
        expectedVersion: currentVersion,
        cacheKey,
        maxDpr: MAX_THUMBNAIL_PIXEL_RATIO,
        trackActiveTask: false,
        signal,
      });
      if (!rendered || signal?.aborted || currentVersion !== this.docVersion) {
        return null;
      }

      this.thumbnailCache.set(rendered);
      blitToCanvas(rendered, targetCanvas, false);
      return { width: rendered.cssWidth, height: rendered.cssHeight };
    } finally {
      this.releaseThumbnailSlot();
    }
  }

  destroy(): void {
    this.cancelPendingWork();
    this.flushThumbnailWaiters();
    this.cache.clear();
    this.thumbnailCache.clear();
    this.defaultAspectRatio = null;
    this.docVersion += 1;
    if (this.pendingLoadTask) {
      void this.pendingLoadTask.destroy().catch(() => undefined);
      this.pendingLoadTask = null;
    }
    if (this.loadingTask) {
      void this.loadingTask.destroy().catch(() => undefined);
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

  private buildThumbnailCacheKey(pageNumber: number, bounds: ViewportBounds): string {
    return `thumb:${this.docVersion}:${pageNumber}:${Math.round(bounds.width)}x${Math.round(bounds.height)}`;
  }

  private canStartThumbnailRender(): boolean {
    return (
      this.activeRenderTask === null &&
      this.activeThumbnailRenders < MAX_CONCURRENT_THUMBNAIL_RENDERS
    );
  }

  private acquireThumbnailSlot(signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) return Promise.resolve(false);
    if (this.canStartThumbnailRender()) {
      this.activeThumbnailRenders += 1;
      return Promise.resolve(true);
    }

    return new Promise<boolean>((resolve) => {
      const onWake = (granted: boolean) => {
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
        if (!granted) {
          resolve(false);
          return;
        }
        if (signal?.aborted) {
          this.releaseThumbnailSlot();
          resolve(false);
          return;
        }
        resolve(true);
      };

      const onAbort = () => {
        const idx = this.thumbnailWaiters.indexOf(onWake);
        if (idx !== -1) {
          this.thumbnailWaiters.splice(idx, 1);
        }
        resolve(false);
      };

      this.thumbnailWaiters.push(onWake);
      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  private releaseThumbnailSlot(): void {
    this.activeThumbnailRenders = Math.max(0, this.activeThumbnailRenders - 1);
    this.drainThumbnailQueue();
  }

  private drainThumbnailQueue(): void {
    while (this.thumbnailWaiters.length > 0 && this.canStartThumbnailRender()) {
      const next = this.thumbnailWaiters.shift();
      if (!next) break;
      this.activeThumbnailRenders += 1;
      next(true);
    }
  }

  private flushThumbnailWaiters(): void {
    const waiters = this.thumbnailWaiters.splice(0, this.thumbnailWaiters.length);
    for (const wake of waiters) {
      wake(false);
    }
  }

  private async renderOffscreenPage({
    pageNumber,
    bounds,
    expectedVersion,
    cacheKey,
    maxDpr,
    trackActiveTask,
    signal,
  }: OffscreenRenderOptions): Promise<RenderedPageEntry | null> {
    if (!this.doc || signal?.aborted) return null;

    const page = await this.doc.getPage(pageNumber);
    if (expectedVersion !== this.docVersion || signal?.aborted) return null;

    const baseViewport = page.getViewport({ scale: 1 });
    const fitScale = Math.min(
      bounds.width / baseViewport.width,
      bounds.height / baseViewport.height
    );
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);

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

    const onAbort = () => {
      try {
        renderTask.cancel();
      } catch {
        // already finished
      }
    };
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    try {
      await renderTask.promise;
    } catch (err) {
      if (isCancelledRenderError(err)) return null;
      throw err;
    } finally {
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
      if (trackActiveTask && this.activeRenderTask === renderTask) {
        this.activeRenderTask = null;
        this.drainThumbnailQueue();
      }
    }

    if (expectedVersion !== this.docVersion || signal?.aborted) return null;

    return {
      key: cacheKey,
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
          const entry = await this.renderOffscreenPage({
            pageNumber: pageNum,
            bounds,
            expectedVersion,
            cacheKey: key,
            maxDpr: MAX_DEVICE_PIXEL_RATIO,
            trackActiveTask: false,
          });
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

function blitToCanvas(
  entry: RenderedPageEntry,
  targetCanvas: HTMLCanvasElement,
  applyCssSize: boolean
): void {
  targetCanvas.width = entry.canvas.width;
  targetCanvas.height = entry.canvas.height;
  if (applyCssSize) {
    targetCanvas.style.width = `${entry.cssWidth}px`;
    targetCanvas.style.height = `${entry.cssHeight}px`;
  }

  const ctx = targetCanvas.getContext('2d', { alpha: false });
  if (!ctx) return;
  ctx.drawImage(entry.canvas, 0, 0);
}

function isCancelledRenderError(err: unknown): boolean {
  return err instanceof Error && err.name === 'RenderingCancelledException';
}
