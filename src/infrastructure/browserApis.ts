interface VendorFullscreenDocument extends Document {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
}

interface VendorFullscreenElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}

export function isNativeFullscreenSupported(): boolean {
  const el = document.documentElement as VendorFullscreenElement;
  return Boolean(el.requestFullscreen || el.webkitRequestFullscreen);
}

export function getNativeFullscreenElement(): Element | null {
  const doc = document as VendorFullscreenDocument;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

export async function requestNativeFullscreen(element: HTMLElement): Promise<boolean> {
  const el = element as VendorFullscreenElement;
  try {
    if (el.requestFullscreen) {
      await el.requestFullscreen();
      return true;
    }
    if (el.webkitRequestFullscreen) {
      await el.webkitRequestFullscreen();
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function exitNativeFullscreen(): Promise<void> {
  const doc = document as VendorFullscreenDocument;
  try {
    if (doc.fullscreenElement && doc.exitFullscreen) {
      await doc.exitFullscreen();
    } else if (doc.webkitFullscreenElement && doc.webkitExitFullscreen) {
      await doc.webkitExitFullscreen();
    }
  } catch {
    return;
  }
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function canNativeShare(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

export async function shareInviteLink(url: string, roomCode: string): Promise<boolean> {
  if (!canNativeShare()) return false;
  try {
    await navigator.share({
      title: 'Coapresentar no Palco',
      text: `Entre como coapresentador na sala ${roomCode}`,
      url,
    });
    return true;
  } catch {
    return false;
  }
}

export function acquireWakeLock(): () => void {
  let sentinel: WakeLockSentinel | null = null;
  let active = true;

  const request = async () => {
    if (!active || !('wakeLock' in navigator)) return;
    try {
      sentinel = await navigator.wakeLock.request('screen');
    } catch {
      // Battery saver or unsupported
    }
  };

  const handleVisibility = () => {
    if (document.visibilityState === 'visible') {
      void request();
    }
  };

  void request();
  document.addEventListener('visibilitychange', handleVisibility);

  return () => {
    active = false;
    document.removeEventListener('visibilitychange', handleVisibility);
    if (sentinel) {
      void sentinel.release();
      sentinel = null;
    }
  };
}
