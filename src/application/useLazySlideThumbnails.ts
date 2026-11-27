import { useEffect, useState, type RefObject } from 'react';
import {
  SLIDE_THUMBNAIL_BOUNDS,
  type PdfEngine,
  type ViewportBounds,
} from '@/infrastructure/pdfEngine';

interface UseLazySlideThumbnailsOptions {
  enabled: boolean;
  engine: PdfEngine;
  docId: string;
  totalPages: number;
  rootRef: RefObject<HTMLElement | null>;
  rootMargin: string;
  bounds?: ViewportBounds;
  minAspectRatio?: number;
  maxAspectRatio?: number;
}

const DEFAULT_ASPECT_RATIO = 16 / 9;

export function useLazySlideThumbnails({
  enabled,
  engine,
  docId,
  totalPages,
  rootRef,
  rootMargin,
  bounds = SLIDE_THUMBNAIL_BOUNDS,
  minAspectRatio = 0.6,
  maxAspectRatio = 2.4,
}: UseLazySlideThumbnailsOptions) {
  const [aspectRatio, setAspectRatio] = useState(DEFAULT_ASPECT_RATIO);

  useEffect(() => {
    if (!enabled || !docId) return;
    let cancelled = false;
    void engine.getDefaultAspectRatio().then((ratio) => {
      if (!cancelled) {
        setAspectRatio(Math.min(maxAspectRatio, Math.max(minAspectRatio, ratio)));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, engine, docId, minAspectRatio, maxAspectRatio]);

  useEffect(() => {
    if (!enabled || !docId || totalPages <= 0) return;
    const root = rootRef.current;
    if (!root) return;

    const targets = Array.from(root.querySelectorAll<HTMLElement>('[data-thumb-page]'));
    if (targets.length === 0) return;

    for (const target of targets) {
      target.dataset.rendered = 'false';
    }

    const inFlight = new Map<number, AbortController>();
    const completed = new Set<number>();

    const startRender = (target: HTMLElement, page: number) => {
      if (completed.has(page) || inFlight.has(page)) return;
      const canvas = target.querySelector<HTMLCanvasElement>('canvas');
      if (!canvas) return;

      const controller = new AbortController();
      inFlight.set(page, controller);

      void engine
        .renderThumbnail(page, canvas, bounds, controller.signal)
        .then((result) => {
          inFlight.delete(page);
          if (result && !controller.signal.aborted) {
            completed.add(page);
            target.dataset.rendered = 'true';
          }
        })
        .catch(() => {
          inFlight.delete(page);
        });
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const target = entry.target as HTMLElement;
          const page = Number(target.dataset.thumbPage);
          if (!Number.isFinite(page)) continue;

          if (entry.isIntersecting) {
            startRender(target, page);
          } else {
            const pending = inFlight.get(page);
            if (pending) {
              pending.abort();
              inFlight.delete(page);
            }
          }
        }
      },
      { root, rootMargin }
    );

    for (const target of targets) {
      observer.observe(target);
    }

    return () => {
      observer.disconnect();
      inFlight.forEach((controller) => controller.abort());
      inFlight.clear();
    };
  }, [enabled, engine, docId, totalPages, rootRef, rootMargin, bounds]);

  return { aspectRatio };
}
