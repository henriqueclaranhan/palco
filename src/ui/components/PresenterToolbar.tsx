import { useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  Maximize2,
  Minimize2,
} from 'lucide-react';

interface PresenterToolbarProps {
  currentPage: number;
  totalPages: number;
  isFullscreen: boolean;
  isSlideGridOpen: boolean;
  onPrev: () => void;
  onNext: () => void;
  onGoToPage: (page: number) => void;
  onToggleSlideGrid: () => void;
  onToggleFullscreen: () => void;
}

export function PresenterToolbar({
  currentPage,
  totalPages,
  isFullscreen,
  isSlideGridOpen,
  onPrev,
  onNext,
  onGoToPage,
  onToggleSlideGrid,
  onToggleFullscreen,
}: PresenterToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [draftPage, setDraftPage] = useState(String(currentPage));

  useEffect(() => {
    setDraftPage(String(currentPage));
  }, [currentPage]);

  // roving tabindex fallback when native focusgroup isn't supported
  useEffect(() => {
    const bar = toolbarRef.current;
    if (!bar || 'focusGroup' in HTMLElement.prototype) return;

    const getItems = () =>
      Array.from(bar.querySelectorAll<HTMLElement>('button, input'));

    const items = getItems();
    items.forEach((el, idx) => {
      el.tabIndex = idx === 0 ? 0 : -1;
    });

    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement | null;
      const currentItems = getItems();
      if (target && currentItems.includes(target)) {
        currentItems.forEach((el) => {
          el.tabIndex = el === target ? 0 : -1;
        });
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.tagName === 'INPUT') return;
      const currentItems = getItems();
      const idx = target ? currentItems.indexOf(target) : -1;
      if (idx === -1) return;

      const rtl = getComputedStyle(bar).direction === 'rtl';
      let nextIdx: number | null = null;
      if (e.key === 'ArrowRight')
        nextIdx = (idx + (rtl ? -1 : 1) + currentItems.length) % currentItems.length;
      else if (e.key === 'ArrowLeft')
        nextIdx = (idx + (rtl ? 1 : -1) + currentItems.length) % currentItems.length;
      else if (e.key === 'Home') nextIdx = 0;
      else if (e.key === 'End') nextIdx = currentItems.length - 1;

      if (nextIdx !== null) {
        e.preventDefault();
        currentItems[nextIdx]?.focus();
      }
    };

    bar.addEventListener('focusin', onFocusIn);
    bar.addEventListener('keydown', onKeyDown);
    return () => {
      bar.removeEventListener('focusin', onFocusIn);
      bar.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const canPrev = currentPage > 1;
  const canNext = currentPage < totalPages;

  const commitPage = () => {
    const parsed = Number.parseInt(draftPage, 10);
    if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= totalPages) {
      onGoToPage(parsed);
    } else {
      setDraftPage(String(currentPage));
    }
  };

  return (
    <div className="dock-wrap">
      <div
        ref={toolbarRef}
        role="toolbar"
        aria-label="Controles da apresentação"
        className="presenter-toolbar"
        {...({ focusgroup: 'toolbar wrap' } as Record<string, string>)}
      >
        <div role="group" aria-label="Navegação de páginas" className="toolbar-group">
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            aria-label="Página anterior"
            aria-disabled={!canPrev}
            title="Página anterior (Seta esquerda)"
            onClick={() => {
              if (canPrev) onPrev();
            }}
          >
            <ChevronLeft size={20} aria-hidden="true" />
          </button>

          <form
            className="page-jump-form"
            onSubmit={(e) => {
              e.preventDefault();
              commitPage();
            }}
          >
            <label htmlFor="slide-page-input" className="sr-only">
              Ir para a página
            </label>
            <input
              id="slide-page-input"
              name="page"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              spellCheck={false}
              className="page-jump-input"
              value={draftPage}
              onChange={(e) => setDraftPage(e.target.value.replace(/\D/g, ''))}
              onBlur={commitPage}
              aria-label={`Página atual ${currentPage} de ${totalPages}`}
            />
            <span aria-hidden="true">/ {totalPages}</span>
          </form>

          <button
            type="button"
            className="btn btn-ghost btn-icon"
            aria-label="Próxima página"
            aria-disabled={!canNext}
            title="Próxima página (Seta direita)"
            onClick={() => {
              if (canNext) onNext();
            }}
          >
            <ChevronRight size={20} aria-hidden="true" />
          </button>
        </div>

        <span
          role="separator"
          aria-orientation="vertical"
          className="toolbar-separator"
        />

        <div role="group" aria-label="Exibição" className="toolbar-group">
          <button
            type="button"
            className="btn btn-surface toolbar-fs-btn"
            aria-label="Grade de slides"
            aria-haspopup="dialog"
            aria-expanded={isSlideGridOpen}
            title="Grade de slides (G)"
            onClick={onToggleSlideGrid}
          >
            <LayoutGrid size={17} aria-hidden="true" />
            <span className="topbar-label-desktop">Slides</span>
          </button>

          <button
            type="button"
            className="btn btn-surface toolbar-fs-btn"
            aria-label={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
            aria-pressed={isFullscreen}
            title={isFullscreen ? 'Sair da tela cheia (F)' : 'Tela cheia (F)'}
            onClick={onToggleFullscreen}
          >
            {isFullscreen ? (
              <Minimize2 size={17} aria-hidden="true" />
            ) : (
              <Maximize2 size={17} aria-hidden="true" />
            )}
            <span className="topbar-label-desktop">Tela cheia</span>
          </button>
        </div>
      </div>
    </div>
  );
}
