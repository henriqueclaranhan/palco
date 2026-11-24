import { useEffect, useRef } from 'react';

interface UseKeyboardAndSwipeOptions {
  enabled: boolean;
  totalPages: number;
  onNext: () => void;
  onPrev: () => void;
  onFirst: () => void;
  onLast: () => void;
  onToggleFullscreen: () => void;
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

export function useKeyboardAndSwipe({
  enabled,
  totalPages,
  onNext,
  onPrev,
  onFirst,
  onLast,
  onToggleFullscreen,
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

      switch (e.key) {
        case 'ArrowRight':
        case 'PageDown':
        case ' ':
          e.preventDefault();
          onNext();
          break;
        case 'ArrowLeft':
        case 'PageUp':
        case 'Backspace':
          e.preventDefault();
          onPrev();
          break;
        case 'Home':
          if (totalPages > 0) {
            e.preventDefault();
            onFirst();
          }
          break;
        case 'End':
          if (totalPages > 0) {
            e.preventDefault();
            onLast();
          }
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          onToggleFullscreen();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, totalPages, onNext, onPrev, onFirst, onLast, onToggleFullscreen]);

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
