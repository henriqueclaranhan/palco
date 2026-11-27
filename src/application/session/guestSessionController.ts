import { env } from '@/config/env';
import {
  PROTOCOL_VERSION,
  type GuestRole,
  type NavigationAction,
  type PeerMessage,
  type SpectatorMode,
} from '@/domain/protocol';
import { PdfLoadError, getGuestPdfErrorMessage } from '@/domain/pdfErrors';
import { PdfChunkAssembler } from '@/domain/chunker';
import { clampPage, computeTargetPage } from '@/domain/session';
import {
  GuestTransport,
  type GuestTransportCallbacks,
} from '@/infrastructure/peerTransport';
import { PdfDocumentLoader, type PdfLoadOutcome } from './pdfDocumentLoader';
import {
  defaultRegisterPageHide,
  type GuestTransportPort,
  type PageHideRegistrar,
  type SessionController,
  type SessionEngine,
  type SessionStore,
} from './types';

interface GuestDocumentMeta {
  docId: string;
  fileName: string;
  byteLength: number;
  initialPage: number;
}

export interface GuestSessionControllerOptions {
  roomCode: string;
  role?: GuestRole;
  engine: SessionEngine;
  store: SessionStore;
  createTransport?: (
    roomCode: string,
    callbacks: GuestTransportCallbacks,
    role: GuestRole
  ) => GuestTransportPort;
  maxReconnectAttempts?: number;
  reconnectDelayMs?: number;
  scheduleTimeout?: (
    callback: () => void,
    delayMs: number
  ) => ReturnType<typeof setTimeout>;
  cancelTimeout?: (timerId: ReturnType<typeof setTimeout>) => void;
  registerPageHide?: PageHideRegistrar;
}

export class GuestSessionController implements SessionController {
  private readonly roomCode: string;
  private readonly role: GuestRole;
  private readonly engine: SessionEngine;
  private readonly store: SessionStore;
  private readonly createTransport: (
    roomCode: string,
    callbacks: GuestTransportCallbacks,
    role: GuestRole
  ) => GuestTransportPort;
  private readonly maxReconnectAttempts: number;
  private readonly reconnectDelayMs: number;
  private readonly scheduleTimeout: (
    callback: () => void,
    delayMs: number
  ) => ReturnType<typeof setTimeout>;
  private readonly cancelTimeout: (timerId: ReturnType<typeof setTimeout>) => void;
  private readonly registerPageHide: PageHideRegistrar;
  private readonly loader: PdfDocumentLoader<GuestDocumentMeta>;

  private transport: GuestTransportPort | null = null;
  private assembler: PdfChunkAssembler | null = null;
  private unregisterPageHide: (() => void) | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private hadConnectedOnce = false;
  private endedExplicitly = false;
  private active = false;
  private pendingPassword: string | null = null;
  private verifiedPassword: string | null = null;

  constructor(options: GuestSessionControllerOptions) {
    this.roomCode = options.roomCode;
    this.role = options.role ?? 'co-presenter';
    this.engine = options.engine;
    this.store = options.store;
    this.createTransport =
      options.createTransport ??
      ((roomCode, callbacks, role) => new GuestTransport(roomCode, callbacks, role));
    this.maxReconnectAttempts =
      options.maxReconnectAttempts ?? env.maxReconnectAttempts;
    this.reconnectDelayMs = options.reconnectDelayMs ?? env.reconnectDelayMs;
    this.scheduleTimeout =
      options.scheduleTimeout ?? ((cb, ms) => globalThis.setTimeout(cb, ms));
    this.cancelTimeout = options.cancelTimeout ?? ((id) => globalThis.clearTimeout(id));
    this.registerPageHide = options.registerPageHide ?? defaultRegisterPageHide;
    this.loader = new PdfDocumentLoader<GuestDocumentMeta>(
      this.engine,
      this.store.setPasswordRequest
    );
  }

  start(): void {
    this.active = true;
    this.connect();
    this.unregisterPageHide = this.registerPageHide(() => {
      this.transport?.destroy();
    });
  }

  destroy(): void {
    this.active = false;
    this.unregisterPageHide?.();
    this.unregisterPageHide = null;
    this.clearReconnectTimer();
    this.transport?.destroy();
    this.transport = null;
    this.assembler = null;
    this.loader.invalidate();
    this.store.setRoomAuthRequest?.(null);
    this.engine.destroy();
  }

  endSession(): void {
    this.endedExplicitly = true;
    this.destroy();
    this.store.updateState((prev) => ({
      ...prev,
      status: 'ended',
      connectedPeers: 0,
    }));
  }

  async loadHostFile(_file: File): Promise<void> {
    // Co-presenters cannot replace the presentation document.
  }

  async submitPdfPassword(password: string): Promise<void> {
    const outcome = await this.loader.submitPassword(password);
    if (!outcome) return;
    this.handleLoadOutcome(outcome);
  }

  cancelPdfPassword(): void {
    const cancelled = this.loader.cancelPassword();
    if (!cancelled) return;

    const passwordError = new PdfLoadError('password_required', '');
    this.store.updateState((prev) => ({
      ...prev,
      status: 'error',
      errorMessage: getGuestPdfErrorMessage(passwordError),
    }));
  }

  submitCoPresenterPassword(password: string): void {
    if (this.role !== 'co-presenter') return;
    const trimmed = password.trim();
    if (!trimmed) return;

    this.pendingPassword = trimmed;
    this.store.setRoomAuthRequest?.((prev) =>
      prev
        ? { ...prev, errorMessage: null, submitting: true }
        : { roomCode: this.roomCode, errorMessage: null, submitting: true }
    );

    const sent = this.transport?.send({
      v: PROTOCOL_VERSION,
      type: 'AUTH_SUBMIT',
      password: trimmed,
    });
    if (!sent) {
      this.store.setRoomAuthRequest?.({
        roomCode: this.roomCode,
        errorMessage: 'Conexão com o anfitrião indisponível. Tente novamente.',
        submitting: false,
      });
    }
  }

  cancelCoPresenterAuth(): void {
    this.store.setRoomAuthRequest?.(null);
    this.endSession();
  }

  regenerateCoPresenterPassword(): void {
    // Only the host can regenerate the co-presenter password.
  }

  navigate(action: 'next' | 'prev' | 'goto', page?: number): void {
    const current = this.store.getState();
    const doc = current.document;
    if (!doc) return;

    const nav: NavigationAction =
      action === 'goto'
        ? { action: 'goto', page: page ?? 1, docId: doc.docId }
        : { action, docId: doc.docId };

    if (this.role === 'spectator') {
      if (current.spectatorMode !== 'free') return;
      const targetPage = computeTargetPage(current.currentPage, doc.totalPages, nav);
      if (targetPage === current.currentPage) return;

      this.store.updateState((prev) => ({
        ...prev,
        currentPage: targetPage,
        isFollowingHost: targetPage === prev.hostPage,
      }));
      return;
    }

    const targetPage = computeTargetPage(current.currentPage, doc.totalPages, nav);
    if (targetPage === current.currentPage) return;

    this.store.updateState((prev) => ({
      ...prev,
      currentPage: targetPage,
      hostPage: targetPage,
      lastUpdatedBy: 'co-presenter',
    }));

    this.transport?.send({
      v: PROTOCOL_VERSION,
      type: 'NAVIGATE',
      docId: doc.docId,
      action: nav.action,
      ...(nav.action === 'goto' ? { page: nav.page } : {}),
    });
  }

  setSpectatorMode(_mode: SpectatorMode): void {
    // Only the host can configure spectator mode.
  }

  followHost(): void {
    if (this.role !== 'spectator') return;
    this.store.updateState((prev) => {
      if (!prev.document) return prev;
      const targetPage = clampPage(prev.hostPage, prev.document.totalPages);
      if (prev.isFollowingHost && prev.currentPage === targetPage) return prev;
      return {
        ...prev,
        currentPage: targetPage,
        isFollowingHost: true,
      };
    });
  }

  private connect(): void {
    this.transport?.destroy();

    this.transport = this.createTransport(
      this.roomCode,
      {
        onConnected: () => {
          if (!this.active) return;
          this.hadConnectedOnce = true;
          this.reconnectAttempts = 0;
          this.store.updateState((prev) => ({
            ...prev,
            status: 'transferring',
            transferProgress: 0,
            errorMessage: null,
          }));
        },
        onMessage: (msg) => {
          if (!this.active) return;
          this.handleMessage(msg);
        },
        onDisconnected: () => {
          if (!this.active || this.endedExplicitly) return;
          this.scheduleReconnect();
        },
        onError: (message) => {
          if (!this.active || this.endedExplicitly) return;
          if (this.hadConnectedOnce) {
            this.scheduleReconnect();
            return;
          }
          this.store.updateState((prev) => ({
            ...prev,
            status: 'error',
            errorMessage: message,
          }));
        },
      },
      this.role
    );
  }

  private scheduleReconnect(): void {
    if (!this.active || this.endedExplicitly) return;

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.engine.destroy();
      this.store.updateState((prev) => ({
        ...prev,
        status: 'ended',
        document: null,
      }));
      return;
    }

    this.reconnectAttempts += 1;
    this.store.updateState((prev) => ({
      ...prev,
      status: 'reconnecting',
      errorMessage: null,
    }));

    this.clearReconnectTimer();
    this.reconnectTimer = this.scheduleTimeout(() => {
      this.reconnectTimer = null;
      if (this.active && !this.endedExplicitly) {
        this.connect();
      }
    }, this.reconnectDelayMs);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      this.cancelTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private handleMessage(msg: PeerMessage): void {
    switch (msg.type) {
      case 'DOC_META':
        this.handleIncomingDocMeta(msg);
        break;
      case 'DOC_CHUNK':
        this.handleIncomingDocChunk(msg);
        break;
      case 'DOC_END':
        this.handleIncomingDocEnd(msg.docId);
        break;
      case 'SYNC_PAGE':
        this.handleSyncPage(msg);
        break;
      case 'ROOM_CONFIG':
        this.handleRoomConfig(msg);
        break;
      case 'AUTH_REQUIRED':
        this.handleAuthRequired(msg);
        break;
      case 'AUTH_OK':
        this.handleAuthOk();
        break;
      case 'SESSION_END':
        this.handleSessionEnd();
        break;
      default:
        break;
    }
  }

  private handleIncomingDocMeta(msg: Extract<PeerMessage, { type: 'DOC_META' }>): void {
    this.loader.invalidate();

    try {
      this.assembler = new PdfChunkAssembler({
        docId: msg.docId,
        fileName: msg.fileName,
        byteLength: msg.byteLength,
        totalChunks: msg.totalChunks,
        initialPage: msg.initialPage,
      });
      this.store.updateState((prev) => ({
        ...prev,
        status: 'transferring',
        transferProgress: 0,
        errorMessage: null,
      }));
    } catch {
      this.store.updateState((prev) => ({
        ...prev,
        status: 'error',
        errorMessage: 'Metadados do PDF inválidos.',
      }));
    }
  }

  private handleIncomingDocChunk(
    msg: Extract<PeerMessage, { type: 'DOC_CHUNK' }>
  ): void {
    if (!this.assembler || this.assembler.header.docId !== msg.docId) return;
    const progress = this.assembler.addChunk(msg.index, msg.data);
    this.store.updateState((prev) => ({ ...prev, transferProgress: progress }));
  }

  private handleIncomingDocEnd(docId: string): void {
    const assembler = this.assembler;
    if (!assembler || assembler.header.docId !== docId) return;

    try {
      const bytes = assembler.assemble();
      const meta: GuestDocumentMeta = {
        docId: assembler.header.docId,
        fileName: assembler.header.fileName,
        byteLength: assembler.header.byteLength,
        initialPage: assembler.header.initialPage,
      };
      this.assembler = null;

      void this.loader.load(meta, bytes).then((outcome) => {
        this.handleLoadOutcome(outcome);
      });
    } catch {
      this.store.updateState((prev) => ({
        ...prev,
        status: 'error',
        errorMessage:
          'A transferência do PDF falhou. Recarregue para tentar novamente.',
      }));
    }
  }

  private handleLoadOutcome(outcome: PdfLoadOutcome<GuestDocumentMeta>): void {
    if (!this.active || outcome.status === 'stale') return;

    if (outcome.status === 'error') {
      this.store.updateState((prev) => ({
        ...prev,
        status: 'error',
        errorMessage: getGuestPdfErrorMessage(outcome.error),
      }));
      return;
    }

    if (outcome.status !== 'loaded') return;

    const { meta, totalPages } = outcome;
    const initialPage = clampPage(meta.initialPage, totalPages);
    this.store.updateState((prev) => ({
      ...prev,
      status: 'synced',
      transferProgress: 1,
      document: {
        docId: meta.docId,
        fileName: meta.fileName,
        byteLength: meta.byteLength,
        totalPages,
      },
      currentPage: initialPage,
      hostPage: initialPage,
      isFollowingHost: true,
      revision: prev.revision + 1,
      lastUpdatedBy: 'host',
      errorMessage: null,
    }));
    this.store.notify(`PDF sincronizado: ${meta.fileName}`);
  }

  private handleSyncPage(msg: Extract<PeerMessage, { type: 'SYNC_PAGE' }>): void {
    this.store.updateState((prev) => {
      if (!prev.document || prev.document.docId !== msg.docId) return prev;
      const nextHostPage = clampPage(msg.page, prev.document.totalPages);
      const shouldUpdateCurrent =
        this.role !== 'spectator' ||
        prev.spectatorMode === 'follow' ||
        prev.isFollowingHost;

      return {
        ...prev,
        hostPage: nextHostPage,
        currentPage: shouldUpdateCurrent ? nextHostPage : prev.currentPage,
        isFollowingHost:
          this.role === 'spectator'
            ? shouldUpdateCurrent
              ? true
              : prev.isFollowingHost
            : true,
        revision: Math.max(prev.revision, msg.revision),
        lastUpdatedBy: msg.by,
      };
    });
  }

  private handleRoomConfig(msg: Extract<PeerMessage, { type: 'ROOM_CONFIG' }>): void {
    const previous = this.store.getState();
    const changed = previous.spectatorMode !== msg.spectatorMode;

    this.store.updateState((prev) => {
      if (this.role === 'spectator' && msg.spectatorMode === 'follow') {
        const syncedPage = prev.document
          ? clampPage(prev.hostPage, prev.document.totalPages)
          : prev.hostPage;
        return {
          ...prev,
          spectatorMode: msg.spectatorMode,
          currentPage: syncedPage,
          isFollowingHost: true,
        };
      }
      return {
        ...prev,
        spectatorMode: msg.spectatorMode,
      };
    });

    if (this.role === 'spectator' && changed && previous.document) {
      this.store.notify(
        msg.spectatorMode === 'follow'
          ? 'O anfitrião ativou o acompanhamento obrigatório.'
          : 'Navegação livre liberada pelo anfitrião.'
      );
    }
  }

  private handleAuthRequired(
    msg: Extract<PeerMessage, { type: 'AUTH_REQUIRED' }>
  ): void {
    if (this.role !== 'co-presenter') return;

    if (msg.reason === 'required' && this.verifiedPassword) {
      this.pendingPassword = this.verifiedPassword;
      this.transport?.send({
        v: PROTOCOL_VERSION,
        type: 'AUTH_SUBMIT',
        password: this.verifiedPassword,
      });
      return;
    }

    if (msg.reason === 'invalid_password') {
      this.verifiedPassword = null;
      this.pendingPassword = null;
    }

    this.store.updateState((prev) => ({
      ...prev,
      status: 'authenticating',
      errorMessage: null,
    }));
    this.store.setRoomAuthRequest?.({
      roomCode: this.roomCode,
      errorMessage:
        msg.reason === 'invalid_password'
          ? 'Senha incorreta. Peça a senha ao anfitrião e tente novamente.'
          : null,
      submitting: false,
    });
  }

  private handleAuthOk(): void {
    if (this.pendingPassword) {
      this.verifiedPassword = this.pendingPassword;
      this.pendingPassword = null;
    }
    this.store.setRoomAuthRequest?.(null);
    this.store.updateState((prev) => ({
      ...prev,
      status: prev.document ? 'synced' : 'transferring',
      transferProgress: prev.document ? 1 : 0,
      errorMessage: null,
    }));
  }

  private handleSessionEnd(): void {
    this.endedExplicitly = true;
    this.clearReconnectTimer();
    this.engine.destroy();
    this.assembler = null;
    this.loader.invalidate();
    this.store.setRoomAuthRequest?.(null);
    this.store.updateState((prev) => ({
      ...prev,
      status: 'ended',
      document: null,
    }));
  }
}
