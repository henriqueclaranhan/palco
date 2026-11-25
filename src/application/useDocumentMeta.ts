import { useEffect } from 'react';

export const DEFAULT_DOCUMENT_TITLE = 'Palco | Coapresentação de PDFs em tempo real';

export type RobotsDirective = 'index, follow' | 'noindex, nofollow';

export function formatRoomTitle(roomCode: string, fileName?: string | null): string {
  const cleanName = fileName?.trim();
  return cleanName
    ? `${cleanName} - Sala ${roomCode} | Palco`
    : `Sala ${roomCode} | Palco`;
}

export function useDocumentMeta(title: string, robots: RobotsDirective) {
  useEffect(() => {
    document.title = title;

    let meta = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'robots';
      document.head.appendChild(meta);
    }
    meta.content = robots;
  }, [title, robots]);
}
