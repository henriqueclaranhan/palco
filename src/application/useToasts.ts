import { useCallback, useEffect, useRef, useState } from 'react';
import type { ToastMessage } from '@/ui/components/ToastRegion';

const TOAST_LIFETIME_MS = 3600;
const MAX_VISIBLE_TOASTS = 3;

export function useToasts() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const nextIdRef = useRef(0);
  const timersRef = useRef<Map<number, number>>(new Map());

  const clearTimer = (id: number) => {
    const timer = timersRef.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
  };

  const dismissToast = useCallback((id: number) => {
    clearTimer(id);
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const pushToast = useCallback((text: string) => {
    const id = ++nextIdRef.current;

    setToasts((prev) => {
      const duplicate = prev.find((item) => item.text === text);
      if (duplicate) {
        clearTimer(duplicate.id);
      }
      const withoutDuplicate = prev.filter((item) => item.text !== text);
      return [...withoutDuplicate.slice(-(MAX_VISIBLE_TOASTS - 1)), { id, text }];
    });

    const timer = window.setTimeout(() => {
      timersRef.current.delete(id);
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, TOAST_LIFETIME_MS);
    timersRef.current.set(id, timer);
  }, []);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) {
        window.clearTimeout(timer);
      }
      timers.clear();
    };
  }, []);

  return { toasts, pushToast, dismissToast };
}
