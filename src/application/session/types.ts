import type { DataConnection } from 'peerjs';
import type { PeerMessage, SpectatorMode } from '@/domain/protocol';
import type { SessionState } from '@/domain/session';
import type { PdfLoadOptions } from '@/infrastructure/pdfEngine';

export interface PasswordRequest {
  fileName: string;
  errorMessage: string | null;
  submitting: boolean;
}

export interface RoomAuthRequest {
  roomCode: string;
  errorMessage: string | null;
  submitting: boolean;
}

export interface SessionEngine {
  load(bytes: Uint8Array, options?: PdfLoadOptions): Promise<number>;
  destroy(): void;
}

export interface HostTransportPort {
  readonly activeConnections: DataConnection[];
  readonly peerCount: number;
  broadcast(message: PeerMessage): void;
  sendTo?(peerId: string, message: PeerMessage): boolean;
  endSession(): void;
  destroy(): void;
}

export interface GuestTransportPort {
  send(message: PeerMessage): boolean;
  destroy(): void;
}

export interface SessionStore {
  getState(): SessionState;
  updateState(updater: (prev: SessionState) => SessionState): void;
  setPasswordRequest(
    next:
      | PasswordRequest
      | null
      | ((prev: PasswordRequest | null) => PasswordRequest | null)
  ): void;
  setRoomAuthRequest?(
    next:
      | RoomAuthRequest
      | null
      | ((prev: RoomAuthRequest | null) => RoomAuthRequest | null)
  ): void;
  notify(message: string): void;
}

export interface SessionController {
  start(): void;
  destroy(): void;
  endSession(): void;
  loadHostFile(file: File): Promise<void>;
  submitPdfPassword(password: string): Promise<void>;
  cancelPdfPassword(): void;
  submitCoPresenterPassword(password: string): void;
  cancelCoPresenterAuth(): void;
  regenerateCoPresenterPassword(): void;
  navigate(action: 'next' | 'prev' | 'goto', page?: number): void;
  setSpectatorMode(mode: SpectatorMode): void;
  followHost(): void;
}

export type PageHideRegistrar = (handler: () => void) => () => void;

export const defaultRegisterPageHide: PageHideRegistrar = (handler) => {
  if (typeof window === 'undefined') {
    return () => undefined;
  }
  window.addEventListener('pagehide', handler);
  return () => window.removeEventListener('pagehide', handler);
};
