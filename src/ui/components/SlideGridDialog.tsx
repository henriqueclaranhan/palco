import { useEffect, useMemo, useRef, useState } from 'react';
import { LayoutGrid, X } from 'lucide-react';
import type { PdfEngine } from '@/infrastructure/pdfEngine';
import { useLazySlideThumbnails } from '@/application/useLazySlideThumbnails';

interface SlideGridDialogProps {
  open: boolean;
  engine: PdfEngine;
  docId: string;
  currentPage: number;
  hostPage?: number;
  totalPages: number;
  onSelectPage: (page: number) => void;
  onClose: () => void;
}

const DEFERRED_THRESHOLD_PAGES = 24;
const IMMEDIATE_WINDOW_RADIUS = 12;

export function resolveGridNavigationPage(
  focusedPage: number,
  key: string,
  columns: number,
  totalPages: number
): number | null {
  if (totalPages <= 0) return null;
  const safeColumns = Math.max(1, columns);
  let target: number;

  switch (key) {
    case 'ArrowRight':
      target = focusedPage + 1;
      break;
    case 'ArrowLeft':
      target = focusedPage - 1;
      break;
    case 'ArrowDown':
      target = focusedPage + safeColumns;
      break;
    case 'ArrowUp':
      target = focusedPage - safeColumns;
      break;
    case 'Home':
      target = 1;
      break;
    case 'End':
      target = totalPages;
      break;
    default:
      return null;
  }

  return Math.min(totalPages, Math.max(1, target));
}

export function SlideGridDialog({
  open,
  engine,
  docId,
  currentPage,
  hostPage,
  totalPages,
  onSelectPage,
  onClose,
}: SlideGridDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [anchorPage, setAnchorPage] = useState(currentPage);
  const currentPageRef = useRef(currentPage);
  currentPageRef.current = currentPage;

  const pages = useMemo(
    () => Array.from({ length: totalPages }, (_, index) => index + 1),
    [totalPages]
  );

  const { aspectRatio } = useLazySlideThumbnails({
    enabled: open,
    engine,
    docId,
    totalPages,
    rootRef: bodyRef,
    rootMargin: '280px 0px',
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      setAnchorPage(currentPageRef.current);
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Light-dismiss fallback for browsers without <dialog closedby="any"> (Safari)
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || 'closedBy' in HTMLDialogElement.prototype) return;

    const onClick = (event: MouseEvent) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      const isDialogContent =
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width;

      if (!isDialogContent) {
        dialog.close();
      }
    };

    dialog.addEventListener('click', onClick);
    return () => dialog.removeEventListener('click', onClick);
  }, []);

  useEffect(() => {
    if (!open) return;
    const targetPage = currentPageRef.current;
    const frameId = window.requestAnimationFrame(() => {
      const currentCard = bodyRef.current?.querySelector<HTMLButtonElement>(
        `button[data-page="${targetPage}"]`
      );
      if (currentCard) {
        currentCard.scrollIntoView({ block: 'center', behavior: 'instant' });
        currentCard.focus({ preventScroll: true });
      }
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [open]);

  const getColumnCount = () => {
    const grid = gridRef.current;
    if (!grid) return 1;
    return Math.max(
      1,
      getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length
    );
  };

  const handleDialogKeyDown = (e: React.KeyboardEvent<HTMLDialogElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.key === 'g' || e.key === 'G') {
      if (e.repeat) return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }

    const activeEl = document.activeElement as HTMLElement | null;
    const focusedPage = Number(activeEl?.dataset.page);
    if (!Number.isFinite(focusedPage)) return;

    const nextPage = resolveGridNavigationPage(
      focusedPage,
      e.key,
      getColumnCount(),
      totalPages
    );
    if (nextPage === null) return;

    e.preventDefault();
    const card = bodyRef.current?.querySelector<HTMLButtonElement>(
      `button[data-page="${nextPage}"]`
    );
    if (card) {
      card.focus();
      card.scrollIntoView({ block: 'nearest' });
    }
  };

  const handleSelect = (page: number) => {
    onSelectPage(page);
    onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      className="modal-dialog slide-grid-dialog"
      aria-labelledby="slide-grid-title"
      onClose={onClose}
      onKeyDown={handleDialogKeyDown}
      {...({ closedby: 'any' } as Record<string, string>)}
    >
      <div className="modal-header slide-grid-header">
        <div className="slide-grid-heading">
          <h1 id="slide-grid-title" className="modal-title modal-title-with-icon">
            <LayoutGrid size={18} aria-hidden="true" />
            <span>Grade de slides</span>
          </h1>
          <span className="slide-grid-counter">
            {currentPage} / {totalPages}
          </span>
        </div>

        <div className="slide-grid-header-actions">
          <span className="slide-grid-shortcut-hint" aria-hidden="true">
            <kbd translate="no">G</kbd> ou <kbd translate="no">Esc</kbd>
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            aria-label="Fechar grade de slides"
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div ref={bodyRef} className="slide-grid-body">
        {open && (
          <div ref={gridRef} className="slide-grid" role="list">
            {pages.map((page) => {
              const isCurrent = page === currentPage;
              const isHostPage =
                hostPage !== undefined && page === hostPage && !isCurrent;
              const shouldDefer =
                totalPages > DEFERRED_THRESHOLD_PAGES &&
                Math.abs(page - anchorPage) > IMMEDIATE_WINDOW_RADIUS;

              return (
                <div
                  key={page}
                  role="listitem"
                  className={
                    shouldDefer
                      ? 'slide-grid-item slide-grid-item-deferred'
                      : 'slide-grid-item'
                  }
                >
                  <button
                    type="button"
                    data-page={page}
                    className="slide-thumb-card"
                    data-current={isCurrent}
                    data-host-page={isHostPage || undefined}
                    aria-current={isCurrent ? 'page' : undefined}
                    aria-label={
                      isCurrent
                        ? `Slide ${page} de ${totalPages} (atual)`
                        : isHostPage
                          ? `Ir para slide ${page} de ${totalPages} (anfitrião)`
                          : `Ir para slide ${page} de ${totalPages}`
                    }
                    onClick={() => handleSelect(page)}
                  >
                    <span
                      className="slide-thumb-frame"
                      data-thumb-page={page}
                      style={{ aspectRatio: String(aspectRatio) }}
                    >
                      <canvas className="slide-thumb-canvas" aria-hidden="true" />
                    </span>

                    <span className="slide-thumb-meta">
                      <span className="slide-thumb-number">{page}</span>
                      {isCurrent && (
                        <span className="slide-thumb-current-tag">Atual</span>
                      )}
                      {isHostPage && (
                        <span className="slide-thumb-host-tag">Anfitrião</span>
                      )}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </dialog>
  );
}
