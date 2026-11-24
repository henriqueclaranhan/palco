import { useCallback, useEffect, useState, type RefObject } from 'react';
import {
  exitNativeFullscreen,
  getNativeFullscreenElement,
  isNativeFullscreenSupported,
  requestNativeFullscreen,
} from '@/infrastructure/browserApis';

export function useFullscreen(targetRef: RefObject<HTMLElement | null>) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPseudoFullscreen, setIsPseudoFullscreen] = useState(false);

  useEffect(() => {
    const onFullscreenChange = () => {
      const active = Boolean(getNativeFullscreenElement());
      setIsFullscreen(active || isPseudoFullscreen);
    };

    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
    };
  }, [isPseudoFullscreen]);

  useEffect(() => {
    if (!isPseudoFullscreen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsPseudoFullscreen(false);
        setIsFullscreen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isPseudoFullscreen]);

  const enterFullscreen = useCallback(async () => {
    const el = targetRef.current ?? document.documentElement;
    if (isNativeFullscreenSupported()) {
      const ok = await requestNativeFullscreen(el);
      if (ok) {
        setIsFullscreen(true);
        return;
      }
    }
    // iOS Safari blocks requestFullscreen on non-video elements
    setIsPseudoFullscreen(true);
    setIsFullscreen(true);
  }, [targetRef]);

  const exitFullscreen = useCallback(async () => {
    if (getNativeFullscreenElement()) {
      await exitNativeFullscreen();
    }
    setIsPseudoFullscreen(false);
    setIsFullscreen(false);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (isFullscreen) {
      void exitFullscreen();
    } else {
      void enterFullscreen();
    }
  }, [isFullscreen, enterFullscreen, exitFullscreen]);

  return {
    isFullscreen,
    isPseudoFullscreen,
    toggleFullscreen,
    exitFullscreen,
  };
}
