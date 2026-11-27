import { useEffect, useMemo, useRef, useState } from 'react';
import type { PdfEngine } from '@/infrastructure/pdfEngine';
import { useLazySlideThumbnails } from '@/application/useLazySlideThumbnails';

interface SlideFilmstripProps {
  engine: PdfEngine;
  docId: string;
  currentPage: number;
  totalPages: number;
  onSelectPage: (page: number) => void;
}

const DEFERRED_THRESHOLD_PAGES = 24;
const IMMEDIATE_WINDOW_RADIUS = 12;

export function SlideFilmstrip({
  engine,
  docId,
  currentPage,
  totalPages,
  onSelectPage,
}: SlideFilmstripProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const hasScrolledInitialRef = useRef(false);
  const [anchorPage, setAnchorPage] = useState(currentPage);
  const currentPageRef = useRef(currentPage);
  currentPageRef.current = currentPage;

  const pages = useMemo(
    () => Array.from({ length: totalPages }, (_, index) => index + 1),
    [totalPages]
  );

  const { aspectRatio } = useLazySlideThumbnails({
    enabled: totalPages > 1,
    engine,
    docId,
    totalPages,
    rootRef: scrollerRef,
    rootMargin: '0px 260px',
    minAspectRatio: 0.7,
    maxAspectRatio: 2.1,
  });

  useEffect(() => {
    hasScrolledInitialRef.current = false;
    setAnchorPage(currentPageRef.current);
  }, [docId]);

  useEffect(() => {
    const activeCard = scrollerRef.current?.querySelector<HTMLButtonElement>(
      `button[data-page="${currentPage}"]`
    );
    if (!activeCard) return;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const behavior =
      !hasScrolledInitialRef.current || prefersReducedMotion ? 'instant' : 'smooth';

    hasScrolledInitialRef.current = true;
    activeCard.scrollIntoView({
      inline: 'center',
      block: 'nearest',
      behavior,
    });
  }, [currentPage, docId, totalPages]);

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const scroller = scrollerRef.current;
    if (!scroller || scroller.scrollWidth <= scroller.clientWidth) return;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      scroller.scrollLeft += e.deltaY;
    }
  };

  if (totalPages <= 1) return null;

  return (
    <nav className="slide-filmstrip-nav" aria-label="Seletor rápido de slides em fila">
      <div ref={scrollerRef} className="slide-filmstrip-scroller" onWheel={handleWheel}>
        <div className="slide-filmstrip-track" role="list">
          {pages.map((page) => {
            const isCurrent = page === currentPage;
            const shouldDefer =
              totalPages > DEFERRED_THRESHOLD_PAGES &&
              Math.abs(page - anchorPage) > IMMEDIATE_WINDOW_RADIUS;

            return (
              <div
                key={page}
                role="listitem"
                className={
                  shouldDefer
                    ? 'slide-filmstrip-item slide-filmstrip-item-deferred'
                    : 'slide-filmstrip-item'
                }
              >
                <button
                  type="button"
                  data-page={page}
                  data-thumb-page={page}
                  className="slide-filmstrip-card"
                  style={{ aspectRatio: String(aspectRatio) }}
                  data-current={isCurrent}
                  aria-current={isCurrent ? 'page' : undefined}
                  aria-label={
                    isCurrent
                      ? `Slide ${page} de ${totalPages} (atual)`
                      : `Ir para slide ${page} de ${totalPages}`
                  }
                  onClick={() => onSelectPage(page)}
                >
                  <canvas className="slide-filmstrip-canvas" aria-hidden="true" />
                  <span className="slide-filmstrip-badge" aria-hidden="true">
                    {page}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
