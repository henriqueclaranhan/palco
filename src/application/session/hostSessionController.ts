import {
  PROTOCOL_VERSION,
  canPerformAction,
  generateDocumentId,
  type NavigationAction,
  type ParticipantRole,
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

export interface HostReloadStore {
  load(roomCode: string): Promise<SavedHostSession | null>;
  save(
    roomCode: string,
    fileName: string,
    currentPage: number,
    bytes: Uint8Array
  ): Promise<void>;
  updatePage(roomCode: string, currentPage: number): void;
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
    this.engine.destroy();
    this.reloadStore.clear();
    this.store.updateState((prev) => ({
      ...prev,
      status: 'ended',
      connectedPeers: 0,
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

  navigate(action: 'next' | 'prev' | 'goto', page?: number): void {
    const doc = this.store.getState().document;
    if (!doc) return;

    const nav: NavigationAction =
      action === 'goto'
        ? { action: 'goto', page: page ?? 1, docId: doc.docId }
        : { action, docId: doc.docId };

    this.applyNavigation(nav, 'host');
  }

  private loadInitialDocument(): void {
    if (this.initialFile) {
      void this.loadHostFile(this.initialFile);
      return;
    }

    void this.reloadStore.load(this.roomCode).then((saved) => {
      if (!this.active || !saved) return;
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
      onPeerConnected: (conn) => {
        if (!this.active) return;
        this.store.updateState((prev) => ({
          ...prev,
          connectedPeers: transport.peerCount,
        }));
        this.store.notify('Coapresentador conectado.');

        const doc = this.currentDoc;
        if (doc) {
          void this.streamDocument(conn, {
            docId: doc.docId,
            fileName: doc.fileName,
            bytes: doc.bytes,
            initialPage: this.store.getState().currentPage,
          });
        }
      },
      onPeerDisconnected: () => {
        if (!this.active) return;
        this.store.updateState((prev) => ({
          ...prev,
          connectedPeers: transport.peerCount,
        }));
        this.store.notify('Um coapresentador saiu da sala.');
      },
      onMessage: (_peerId, msg) => {
        if (!this.active || msg.type !== 'NAVIGATE') return;
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

    void this.reloadStore.save(this.roomCode, meta.fileName, safePage, bytes);

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

    await Promise.all(
      transport.activeConnections.map((conn) =>
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
