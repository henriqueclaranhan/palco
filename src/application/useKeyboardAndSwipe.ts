import { useEffect, useRef } from 'react';

interface UseKeyboardAndSwipeOptions {
  enabled: boolean;
  totalPages: number;
  onNext: () => void;
  onPrev: () => void;
  onFirst: () => void;
  onLast: () => void;
  onToggleFullscreen: () => void;
  onToggleSlideGrid?: () => void;
}

const SWIPE_THRESHOLD_PX = 48;

function isEditableElement(target: HTMLElement | null): boolean {
  if (!target) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  );
}

function isModalDialogOpen(): boolean {
  return Boolean(document.querySelector('dialog[open]'));
}

export type PresentationShortcutAction =
  'next' | 'prev' | 'first' | 'last' | 'toggle_fullscreen' | 'toggle_slide_grid';

export function resolvePresentationShortcut(
  key: string,
  options: { repeat: boolean; totalPages: number }
): PresentationShortcutAction | null {
  switch (key) {
    case 'ArrowRight':
    case 'PageDown':
    case ' ':
      return 'next';
    case 'ArrowLeft':
    case 'PageUp':
    case 'Backspace':
      return 'prev';
    case 'Home':
      return options.totalPages > 0 ? 'first' : null;
    case 'End':
      return options.totalPages > 0 ? 'last' : null;
    case 'f':
    case 'F':
      return options.repeat ? null : 'toggle_fullscreen';
    case 'g':
    case 'G':
      return options.repeat ? null : 'toggle_slide_grid';
    default:
      return null;
  }
}

export function useKeyboardAndSwipe({
  enabled,
  totalPages,
  onNext,
  onPrev,
  onFirst,
  onLast,
  onToggleFullscreen,
  onToggleSlideGrid,
}: UseKeyboardAndSwipeOptions) {
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (isEditableElement(target) || isModalDialogOpen()) {
        return;
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const action = resolvePresentationShortcut(e.key, {
        repeat: e.repeat,
        totalPages,
      });
      if (!action) return;

      switch (action) {
        case 'next':
          e.preventDefault();
          onNext();
          break;
        case 'prev':
          e.preventDefault();
          onPrev();
          break;
        case 'first':
          e.preventDefault();
          onFirst();
          break;
        case 'last':
          e.preventDefault();
          onLast();
          break;
        case 'toggle_fullscreen':
          e.preventDefault();
          onToggleFullscreen();
          break;
        case 'toggle_slide_grid':
          if (onToggleSlideGrid) {
            e.preventDefault();
            onToggleSlideGrid();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    enabled,
    totalPages,
    onNext,
    onPrev,
    onFirst,
    onLast,
    onToggleFullscreen,
    onToggleSlideGrid,
  ]);

  const swipeHandlers = {
    onTouchStart: (e: React.TouchEvent) => {
      if (e.touches.length !== 1) return;
      touchStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
      };
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const start = touchStartRef.current;
      touchStartRef.current = null;
      if (!start || e.changedTouches.length !== 1) return;

      const dx = e.changedTouches[0].clientX - start.x;
      const dy = e.changedTouches[0].clientY - start.y;

      if (Math.abs(dx) >= SWIPE_THRESHOLD_PX && Math.abs(dx) > Math.abs(dy) * 1.4) {
        if (dx < 0) {
          onNext();
        } else {
          onPrev();
        }
      }
    },
  };

  return { swipeHandlers };
}
