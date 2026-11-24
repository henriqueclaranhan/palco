import { useCallback, useEffect, useState } from 'react';

export type ResolvedScheme = 'light' | 'dark';
type StoredScheme = ResolvedScheme | null;

const STORAGE_KEY = 'color-scheme';

function readStoredScheme(): StoredScheme {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function getSystemScheme(): ResolvedScheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function syncColorSchemeMeta(stored: StoredScheme): void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
  if (meta) {
    meta.content = stored ?? 'light dark';
  }
}

export function useColorScheme() {
  const [stored, setStored] = useState<StoredScheme>(readStoredScheme);
  const [systemScheme, setSystemScheme] = useState<ResolvedScheme>(getSystemScheme);

  const resolvedScheme: ResolvedScheme = stored ?? systemScheme;

  useEffect(() => {
    syncColorSchemeMeta(stored);
  }, [stored]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onMediaChange = () => setSystemScheme(media.matches ? 'dark' : 'light');
    media.addEventListener('change', onMediaChange);

    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        setStored(readStoredScheme());
      }
    };
    window.addEventListener('storage', onStorage);

    return () => {
      media.removeEventListener('change', onMediaChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const toggleScheme = useCallback(() => {
    const currentSystem = getSystemScheme();
    const currentRendered: ResolvedScheme = stored ?? currentSystem;
    const target: ResolvedScheme = currentRendered === 'dark' ? 'light' : 'dark';
    const nextStored: StoredScheme = target === currentSystem ? null : target;

    try {
      if (nextStored === null) {
        localStorage.removeItem(STORAGE_KEY);
      } else {
        localStorage.setItem(STORAGE_KEY, nextStored);
      }
    } catch {
      // keep working in memory if storage is blocked
    }

    setStored(nextStored);
    syncColorSchemeMeta(nextStored);
  }, [stored]);

  return { resolvedScheme, toggleScheme };
}
