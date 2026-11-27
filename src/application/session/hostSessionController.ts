import {
  PROTOCOL_VERSION,
  canPerformAction,
  generateCoPresenterPassword,
  generateDocumentId,
  normalizeCoPresenterPassword,
  type GuestRole,
  type NavigationAction,
  type ParticipantRole,
  type PeerMessage,
  type SpectatorMode,
} from '@/domain/protocol';
import { validatePdfFile } from '@/domain/pdfValidation';
import { PdfLoadError, getHostPdfErrorMessage } from '@/domain/pdfErrors';
import { clampPage, computeTargetPage } from '@/domain/session';
import {
  HostTransport,
  streamDocumentToConnection,
  type HostTransportCallbacks,
} from '@/infrastructure/peerTransport';
import {
  clearHostReloadState,
  loadHostReloadState,
  saveHostReloadState,
  updateHostReloadPage,
  updateHostReloadPassword,
  updateHostReloadSpectatorMode,
  type SavedHostSession,
} from '@/infrastructure/ephemeralHostStore';
import { PdfDocumentLoader, type PdfLoadOutcome } from './pdfDocumentLoader';
import {
  defaultRegisterPageHide,
  type HostTransportPort,
  type PageHideRegistrar,
  type SessionController,
  type SessionEngine,
  type SessionStore,
} from './types';

import type { DataConnection } from 'peerjs';

interface HostDocumentBuffer {
  docId: string;
  fileName: string;
  bytes: Uint8Array;
  totalPages: number;
}

interface HostLoadMeta {
  fileName: string;
  startPage: number;
  showToast: boolean;
}

interface ConnectedPeerRecord {
  conn: DataConnection;
  role: GuestRole;
  authenticated: boolean;
}

export interface HostReloadStore {
  load(roomCode: string): Promise<SavedHostSession | null>;
  save(
    roomCode: string,
    fileName: string,
    currentPage: number,
    bytes: Uint8Array,
    coPresenterPassword?: string
  ): Promise<void>;
  updatePage(roomCode: string, currentPage: number): void;
  updateSpectatorMode?(roomCode: string, spectatorMode: SpectatorMode): void;
  updatePassword?(roomCode: string, coPresenterPassword: string): void;
  clear(): void;
}

export interface HostSessionControllerOptions {
  roomCode: string;
  initialFile?: File | null;
  engine: SessionEngine;
  store: SessionStore;
  createTransport?: (
    roomCode: string,
    callbacks: HostTransportCallbacks
  ) => HostTransportPort;
  streamDocument?: typeof streamDocumentToConnection;
  reloadStore?: HostReloadStore;
  registerPageHide?: PageHideRegistrar;
}

const defaultReloadStore: HostReloadStore = {
  load: loadHostReloadState,
  save: saveHostReloadState,
  updatePage: updateHostReloadPage,
  updateSpectatorMode: updateHostReloadSpectatorMode,
  updatePassword: updateHostReloadPassword,
  clear: clearHostReloadState,
};

export class HostSessionController implements SessionController {
  private readonly roomCode: string;
  private readonly initialFile: File | null;
  private readonly engine: SessionEngine;
  private readonly store: SessionStore;
  private readonly createTransport: (
    roomCode: string,
    callbacks: HostTransportCallbacks
  ) => HostTransportPort;
  private readonly streamDocument: typeof streamDocumentToConnection;
  private readonly reloadStore: HostReloadStore;
  private readonly registerPageHide: PageHideRegistrar;
  private readonly loader: PdfDocumentLoader<HostLoadMeta>;

  private transport: HostTransportPort | null = null;
  private currentDoc: HostDocumentBuffer | null = null;
  private transferAbort: AbortController | null = null;
  private unregisterPageHide: (() => void) | null = null;
  private readonly peers = new Map<string, ConnectedPeerRecord>();
  private active = false;

  constructor(options: HostSessionControllerOptions) {
    this.roomCode = options.roomCode;
    this.initialFile = options.initialFile ?? null;
    this.engine = options.engine;
    this.store = options.store;
    this.createTransport =
      options.createTransport ??
      ((roomCode, callbacks) => new HostTransport(roomCode, callbacks));
    this.streamDocument = options.streamDocument ?? streamDocumentToConnection;
    this.reloadStore = options.reloadStore ?? defaultReloadStore;
    this.registerPageHide = options.registerPageHide ?? defaultRegisterPageHide;
    this.loader = new PdfDocumentLoader<HostLoadMeta>(
      this.engine,
      this.store.setPasswordRequest
    );
  }

  start(): void {
    this.active = true;
    this.loadInitialDocument();
    this.startTransport();
    this.unregisterPageHide = this.registerPageHide(() => {
      this.transport?.destroy();
    });
  }

  destroy(): void {
    this.active = false;
    this.unregisterPageHide?.();
    this.unregisterPageHide = null;
    this.loader.invalidate();
    this.transferAbort?.abort();
    this.transferAbort = null;
    this.transport?.destroy();
    this.transport = null;
    this.currentDoc = null;
    this.peers.clear();
    this.engine.destroy();
  }

  endSession(): void {
    this.active = false;
    this.unregisterPageHide?.();
    this.unregisterPageHide = null;
    this.loader.invalidate();
    this.transferAbort?.abort();
    this.transferAbort = null;
    this.transport?.endSession();
    this.transport = null;
    this.currentDoc = null;
    this.peers.clear();
    this.engine.destroy();
    this.reloadStore.clear();
    this.store.updateState((prev) => ({
      ...prev,
      status: 'ended',
      connectedPeers: 0,
      connectedCoPresenters: 0,
      connectedSpectators: 0,
    }));
  }

  async loadHostFile(file: File): Promise<void> {
    if (!canPerformAction('host', 'replace_document')) return;

    const validationError = validatePdfFile(file);
    if (validationError) {
      this.store.notify(validationError);
      return;
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    await this.loadBytes({ fileName: file.name, startPage: 1, showToast: true }, bytes);
  }

  async submitPdfPassword(password: string): Promise<void> {
    const outcome = await this.loader.submitPassword(password);
    if (!outcome) return;
    await this.handleLoadOutcome(outcome, this.loader.currentSequence);
  }

  cancelPdfPassword(): void {
    const cancelled = this.loader.cancelPassword();
    if (!cancelled) return;

    const passwordError = new PdfLoadError('password_required', '');
    this.store.notify(getHostPdfErrorMessage(passwordError));
  }

  submitCoPresenterPassword(_password: string): void {
    // Host does not authenticate as a guest.
  }

  cancelCoPresenterAuth(): void {
    // Host does not authenticate as a guest.
  }

  regenerateCoPresenterPassword(): void {
    const nextPassword = generateCoPresenterPassword();
    this.reloadStore.updatePassword?.(this.roomCode, nextPassword);
    this.store.updateState((prev) => ({
      ...prev,
      coPresenterPassword: nextPassword,
    }));
    this.store.notify('Nova senha de coapresentador gerada.');
  }

  navigate(action: 'next' | 'prev' | 'goto', page?: number): void {
    const doc = this.store.getState().document;
    if (!doc) return;

    const nav: NavigationAction =
      action === 'goto'
        ? { action: 'goto', page: page ?? 1, docId: doc.docId }
        : { action, docId: doc.docId };

    this.applyNavigation(nav, 'host');
  }

  setSpectatorMode(mode: SpectatorMode): void {
    if (!canPerformAction('host', 'configure_spectators')) return;
    const current = this.store.getState();
    if (current.spectatorMode === mode) return;

    this.reloadStore.updateSpectatorMode?.(this.roomCode, mode);
    this.store.updateState((prev) => ({
      ...prev,
      spectatorMode: mode,
    }));

    this.transport?.broadcast({
      v: PROTOCOL_VERSION,
      type: 'ROOM_CONFIG',
      spectatorMode: mode,
    });
  }

  followHost(): void {
    // Host is always authoritative; no-op.
  }

  private loadInitialDocument(): void {
    if (this.initialFile) {
      void this.loadHostFile(this.initialFile);
      return;
    }

    void this.reloadStore.load(this.roomCode).then((saved) => {
      if (!this.active || !saved) return;
      if (saved.spectatorMode || saved.coPresenterPassword) {
        this.store.updateState((prev) => ({
          ...prev,
          spectatorMode: saved.spectatorMode ?? prev.spectatorMode,
          coPresenterPassword: saved.coPresenterPassword ?? prev.coPresenterPassword,
        }));
      }
      void this.loadBytes(
        {
          fileName: saved.fileName,
          startPage: saved.currentPage,
          showToast: false,
        },
        saved.bytes
      );
    });
  }

  private startTransport(): void {
    const transport = this.createTransport(this.roomCode, {
      onReady: () => {
        if (!this.active) return;
        this.store.updateState((prev) => ({
          ...prev,
          status: 'ready',
          errorMessage: null,
        }));
      },
      onPeerConnected: (conn, peerRole = 'co-presenter') => {
        if (!this.active) return;
        const requiresAuth = peerRole === 'co-presenter';
        const record: ConnectedPeerRecord = {
          conn,
          role: peerRole,
          authenticated: !requiresAuth,
        };
        this.peers.set(conn.peer, record);

        if (requiresAuth) {
          this.sendToConnection(conn, {
            v: PROTOCOL_VERSION,
            type: 'AUTH_REQUIRED',
            reason: 'required',
          });
          return;
        }

        this.syncPeerCounts();
        this.store.notify('Espectador conectado.');
        this.onPeerAuthorized(conn);
      },
      onPeerDisconnected: (peerId, peerRole) => {
        if (!this.active) return;
        const existing = this.peers.get(peerId);
        this.peers.delete(peerId);
        this.syncPeerCounts();

        if (existing && !existing.authenticated) {
          return;
        }

        const resolvedRole = peerRole ?? existing?.role ?? 'co-presenter';
        this.store.notify(
          resolvedRole === 'spectator'
            ? 'Um espectador saiu da sala.'
            : 'Um coapresentador saiu da sala.'
        );
      },
      onMessage: (peerId, msg) => {
        if (!this.active) return;
        if (msg.type === 'AUTH_SUBMIT') {
          this.handleAuthSubmit(peerId, msg.password);
          return;
        }
        if (msg.type !== 'NAVIGATE') return;

        const record = this.peers.get(peerId);
        if (record && (record.role === 'spectator' || !record.authenticated)) {
          return;
        }

        const nav: NavigationAction =
          msg.action === 'goto'
            ? { action: 'goto', page: msg.page ?? 1, docId: msg.docId }
            : { action: msg.action, docId: msg.docId };
        this.applyNavigation(nav, 'co-presenter');
      },
      onError: (message) => {
        if (!this.active) return;
        this.store.updateState((prev) => ({
          ...prev,
          status: 'error',
          errorMessage: message,
        }));
      },
    });

    this.transport = transport;
  }

  private handleAuthSubmit(peerId: string, submittedPassword: string): void {
    const record = this.peers.get(peerId);
    if (!record || record.role !== 'co-presenter' || record.authenticated) return;

    const expected = this.store.getState().coPresenterPassword;
    if (
      !expected ||
      normalizeCoPresenterPassword(submittedPassword) !==
        normalizeCoPresenterPassword(expected)
    ) {
      this.sendToConnection(record.conn, {
        v: PROTOCOL_VERSION,
        type: 'AUTH_REQUIRED',
        reason: 'invalid_password',
      });
      return;
    }

    record.authenticated = true;
    this.syncPeerCounts();
    this.store.notify('Coapresentador conectado.');
    this.sendToConnection(record.conn, {
      v: PROTOCOL_VERSION,
      type: 'AUTH_OK',
    });
    this.onPeerAuthorized(record.conn);
  }

  private onPeerAuthorized(conn: DataConnection): void {
    this.sendToConnection(conn, {
      v: PROTOCOL_VERSION,
      type: 'ROOM_CONFIG',
      spectatorMode: this.store.getState().spectatorMode,
    });

    const doc = this.currentDoc;
    if (doc) {
      void this.streamDocument(conn, {
        docId: doc.docId,
        fileName: doc.fileName,
        bytes: doc.bytes,
        initialPage: this.store.getState().currentPage,
      });
    }
  }

  private sendToConnection(conn: DataConnection, message: PeerMessage): void {
    if (conn.open && typeof conn.send === 'function') {
      conn.send(message);
    } else if (conn.peer) {
      this.transport?.sendTo?.(conn.peer, message);
    }
  }

  private syncPeerCounts(): void {
    let coPresenters = 0;
    let spectators = 0;
    for (const record of this.peers.values()) {
      if (!record.authenticated) continue;
      if (record.role === 'spectator') spectators += 1;
      else coPresenters += 1;
    }
    this.store.updateState((prev) => ({
      ...prev,
      connectedPeers: coPresenters + spectators,
      connectedCoPresenters: coPresenters,
      connectedSpectators: spectators,
    }));
  }

  private async loadBytes(meta: HostLoadMeta, bytes: Uint8Array): Promise<void> {
    const outcome = await this.loader.load(meta, bytes);
    await this.handleLoadOutcome(outcome, this.loader.currentSequence);
  }

  private async handleLoadOutcome(
    outcome: PdfLoadOutcome<HostLoadMeta>,
    expectedSequence: number
  ): Promise<void> {
    if (!this.active || outcome.status === 'stale') return;

    if (outcome.status === 'error') {
      this.store.notify(getHostPdfErrorMessage(outcome.error));
      return;
    }

    if (outcome.status !== 'loaded') return;

    const { meta, bytes, totalPages } = outcome;
    const docId = generateDocumentId();
    const safePage = clampPage(meta.startPage, totalPages);
    const docBuffer: HostDocumentBuffer = {
      docId,
      fileName: meta.fileName,
      bytes,
      totalPages,
    };
    this.currentDoc = docBuffer;

    void this.reloadStore.save(
      this.roomCode,
      meta.fileName,
      safePage,
      bytes,
      this.store.getState().coPresenterPassword ?? undefined
    );

    this.store.updateState((prev) => ({
      ...prev,
      status: prev.status === 'initializing' ? 'initializing' : 'ready',
      document: {
        docId,
        fileName: meta.fileName,
        byteLength: bytes.byteLength,
        totalPages,
      },
      currentPage: safePage,
      hostPage: safePage,
      revision: prev.revision + 1,
      lastUpdatedBy: 'host',
      errorMessage: null,
    }));

    await this.broadcastDocumentToPeers(docBuffer, safePage);
    if (meta.showToast && this.active && this.loader.isCurrent(expectedSequence)) {
      this.store.notify(`Documento carregado: ${meta.fileName}`);
    }
  }

  private async broadcastDocumentToPeers(
    doc: HostDocumentBuffer,
    page: number
  ): Promise<void> {
    const transport = this.transport;
    if (!transport) return;

    this.transferAbort?.abort();
    const controller = new AbortController();
    this.transferAbort = controller;

    const authorizedConnections = transport.activeConnections.filter((conn) => {
      const record = this.peers.get(conn.peer);
      return !record || record.authenticated;
    });

    await Promise.all(
      authorizedConnections.map((conn) =>
        this.streamDocument(
          conn,
          {
            docId: doc.docId,
            fileName: doc.fileName,
            bytes: doc.bytes,
            initialPage: page,
          },
          controller.signal
        )
      )
    );
  }

  private applyNavigation(nav: NavigationAction, initiator: ParticipantRole): void {
    const current = this.store.getState();
    const doc = current.document;
    if (!doc || doc.docId !== nav.docId) return;

    const targetPage = computeTargetPage(current.currentPage, doc.totalPages, nav);
    if (targetPage === current.currentPage) return;

    const nextRevision = current.revision + 1;
    this.reloadStore.updatePage(this.roomCode, targetPage);

    this.store.updateState((prev) => ({
      ...prev,
      currentPage: targetPage,
      hostPage: targetPage,
      revision: nextRevision,
      lastUpdatedBy: initiator,
    }));

    this.transport?.broadcast({
      v: PROTOCOL_VERSION,
      type: 'SYNC_PAGE',
      docId: doc.docId,
      page: targetPage,
      revision: nextRevision,
      by: initiator,
    });
  }
}
