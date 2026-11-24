import type { NavigationAction, ParticipantRole } from './protocol';

export type SessionStatus =
  | 'initializing'
  | 'ready'
  | 'connecting'
  | 'reconnecting'
  | 'transferring'
  | 'synced'
  | 'ended'
  | 'error';

export interface DocumentDescriptor {
  docId: string;
  fileName: string;
  byteLength: number;
  totalPages: number;
}

export interface SessionState {
  role: ParticipantRole;
  roomCode: string;
  status: SessionStatus;
  document: DocumentDescriptor | null;
  currentPage: number;
  revision: number;
  connectedPeers: number;
  transferProgress: number;
  lastUpdatedBy: ParticipantRole | null;
  errorMessage: string | null;
}

export function createInitialSessionState(
  role: ParticipantRole,
  roomCode: string
): SessionState {
  return {
    role,
    roomCode,
    status: role === 'host' ? 'initializing' : 'connecting',
    document: null,
    currentPage: 1,
    revision: 0,
    connectedPeers: 0,
    transferProgress: 0,
    lastUpdatedBy: null,
    errorMessage: null,
  };
}

export function clampPage(page: number, totalPages: number): number {
  if (totalPages <= 0) return 1;
  return Math.max(1, Math.min(totalPages, Math.floor(page)));
}

export function computeTargetPage(
  currentPage: number,
  totalPages: number,
  nav: NavigationAction
): number {
  if (totalPages <= 0) return 1;
  switch (nav.action) {
    case 'next':
      return clampPage(currentPage + 1, totalPages);
    case 'prev':
      return clampPage(currentPage - 1, totalPages);
    case 'goto':
      return clampPage(nav.page, totalPages);
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}\u00A0B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1).replace('.', ',')}\u00A0KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1).replace('.', ',')}\u00A0MB`;
}
