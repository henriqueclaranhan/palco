import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import {
  PROTOCOL_VERSION,
  canPerformAction,
  generateDocumentId,
  type NavigationAction,
  type ParticipantRole,
  type PeerMessage,
} from '@/domain/protocol';
import { validatePdfFile } from '@/domain/pdfValidation';
import {
  PdfLoadError,
  classifyPdfLoadError,
  getGuestPdfErrorMessage,
  getHostPdfErrorMessage,
} from '@/domain/pdfErrors';
import { PdfChunkAssembler } from '@/domain/chunker';
import {
  clampPage,
  computeTargetPage,
  createInitialSessionState,
  type SessionState,
} from '@/domain/session';
import {
  GuestTransport,
  HostTransport,
  streamDocumentToConnection,
} from '@/infrastructure/peerTransport';
import { PdfEngine } from '@/infrastructure/pdfEngine';
import { acquireWakeLock } from '@/infrastructure/browserApis';
import { env } from '@/config/env';
import {
  clearHostReloadState,
  loadHostReloadState,
  saveHostReloadState,
  updateHostReloadPage,
} from '@/infrastructure/ephemeralHostStore';

const MAX_RECONNECT_ATTEMPTS = env.maxReconnectAttempts;
const RECONNECT_DELAY_MS = env.reconnectDelayMs;

interface HostDocumentBuffer {
  docId: string;
  fileName: string;
  bytes: Uint8Array;
  totalPages: number;
}

export interface PasswordRequest {
  fileName: string;
  errorMessage: string | null;
  submitting: boolean;
}

type PendingPasswordDoc =
  | {
      source: 'host';
      fileName: string;
      bytes: Uint8Array;
      startPage: number;
      showToast: boolean;
    }
  | {
      source: 'guest';
      header: {
        docId: string;
        fileName: string;
        byteLength: number;
        initialPage: number;
      };
      bytes: Uint8Array;
    };

export interface UsePresentationSessionOptions {
  role: ParticipantRole;
  roomCode: string;
  initialFile?: File | null;
  onNotice?: (message: string) => void;
}

export function usePresentationSession({
  role,
  roomCode,
  initialFile,
  onNotice,
}: UsePresentationSessionOptions) {
  const [state, setState] = useState<SessionState>(() =>
    createInitialSessionState(role, roomCode)
  );
  const [passwordRequest, setPasswordRequest] = useState<PasswordRequest | null>(null);

  const engineRef = useRef<PdfEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new PdfEngine();
  }

  const hostTransportRef = useRef<HostTransport | null>(null);
  const guestTransportRef = useRef<GuestTransport | null>(null);
  const hostDocRef = useRef<HostDocumentBuffer | null>(null);
  const pendingPasswordDocRef = useRef<PendingPasswordDoc | null>(null);
  const assemblerRef = useRef<PdfChunkAssembler | null>(null);
  const transferAbortRef = useRef<AbortController | null>(null);
  const fileLoadSeqRef = useRef(0);
  const stateRef = useRef<SessionState>(state);
  stateRef.current = state;

  const noticeRef = useRef(onNotice);
  noticeRef.current = onNotice;
  const notify = useCallback((msg: string) => noticeRef.current?.(msg), []);

  useEffect(() => acquireWakeLock(), []);

  const broadcastDocumentToPeers = useCallback(
    async (doc: HostDocumentBuffer, page: number) => {
      const transport = hostTransportRef.current;
      if (!transport) return;

      transferAbortRef.current?.abort();
      const controller = new AbortController();
      transferAbortRef.current = controller;

      await Promise.all(
        transport.activeConnections.map((conn) =>
          streamDocumentToConnection(
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
    },
    []
  );

  const loadHostBytes = useCallback(
    async (
      fileName: string,
      bytes: Uint8Array,
      startPage: number,
      showToast: boolean,
      password?: string
    ) => {
      const loadSeq = ++fileLoadSeqRef.current;
      try {
        const totalPages = await engineRef.current!.load(bytes, { password });
        if (loadSeq !== fileLoadSeqRef.current) return;

        pendingPasswordDocRef.current = null;
        setPasswordRequest(null);

        const docId = generateDocumentId();
        const safePage = clampPage(startPage, totalPages);
        const docBuffer: HostDocumentBuffer = {
          docId,
          fileName,
          bytes,
          totalPages,
        };
        hostDocRef.current = docBuffer;

        void saveHostReloadState(roomCode, fileName, safePage, bytes);

        setState((prev) => ({
          ...prev,
          status: prev.status === 'initializing' ? 'initializing' : 'ready',
          document: {
            docId,
            fileName,
            byteLength: bytes.byteLength,
            totalPages,
          },
          currentPage: safePage,
          revision: prev.revision + 1,
          lastUpdatedBy: 'host',
          errorMessage: null,
        }));

        await broadcastDocumentToPeers(docBuffer, safePage);
        if (showToast && loadSeq === fileLoadSeqRef.current) {
          notify(`Documento carregado: ${fileName}`);
        }
      } catch (err) {
        if (loadSeq !== fileLoadSeqRef.current) return;
        const classified = classifyPdfLoadError(err);

        if (
          classified.code === 'password_required' ||
          classified.code === 'password_incorrect'
        ) {
          pendingPasswordDocRef.current = {
            source: 'host',
            fileName,
            bytes,
            startPage,
            showToast,
          };
          setPasswordRequest({
            fileName,
            errorMessage:
              classified.code === 'password_incorrect' ? classified.message : null,
            submitting: false,
          });
          return;
        }

        pendingPasswordDocRef.current = null;
        setPasswordRequest(null);
        notify(getHostPdfErrorMessage(classified));
      }
    },
    [roomCode, broadcastDocumentToPeers, notify]
  );

  const submitPdfPassword = useCallback(
    async (password: string) => {
      const pending = pendingPasswordDocRef.current;
      if (!pending) return;

      setPasswordRequest((prev) =>
        prev ? { ...prev, errorMessage: null, submitting: true } : null
      );

      if (pending.source === 'host') {
        await loadHostBytes(
          pending.fileName,
          pending.bytes,
          pending.startPage,
          pending.showToast,
          password
        );
        return;
      }

      const loadSeq = ++fileLoadSeqRef.current;
      try {
        const totalPages = await engineRef.current!.load(pending.bytes, { password });
        if (loadSeq !== fileLoadSeqRef.current) return;

        pendingPasswordDocRef.current = null;
        setPasswordRequest(null);

        setState((prev) => ({
          ...prev,
          status: 'synced',
          transferProgress: 1,
          document: {
            docId: pending.header.docId,
            fileName: pending.header.fileName,
            byteLength: pending.header.byteLength,
            totalPages,
          },
          currentPage: clampPage(pending.header.initialPage, totalPages),
          revision: prev.revision + 1,
          lastUpdatedBy: 'host',
          errorMessage: null,
        }));
        notify(`PDF sincronizado: ${pending.header.fileName}`);
      } catch (err) {
        if (loadSeq !== fileLoadSeqRef.current) return;
        const classified = classifyPdfLoadError(err);

        if (
          classified.code === 'password_required' ||
          classified.code === 'password_incorrect'
        ) {
          setPasswordRequest({
            fileName: pending.header.fileName,
            errorMessage:
              classified.code === 'password_incorrect'
                ? classified.message
                : 'Digite a senha para desbloquear este PDF.',
            submitting: false,
          });
          return;
        }

        pendingPasswordDocRef.current = null;
        setPasswordRequest(null);
        setState((prev) => ({
          ...prev,
          status: 'error',
          errorMessage: getGuestPdfErrorMessage(classified),
        }));
      }
    },
    [loadHostBytes, notify]
  );

  const cancelPdfPassword = useCallback(() => {
    const pending = pendingPasswordDocRef.current;
    pendingPasswordDocRef.current = null;
    setPasswordRequest(null);
    if (!pending) return;

    const passwordError = new PdfLoadError('password_required', '');
    if (pending.source === 'host') {
      notify(getHostPdfErrorMessage(passwordError));
      return;
    }

    setState((prev) => ({
      ...prev,
      status: 'error',
      errorMessage: getGuestPdfErrorMessage(passwordError),
    }));
  }, [notify]);

  const loadHostFile = useCallback(
    async (file: File) => {
      if (!canPerformAction(role, 'replace_document')) return;

      const validationError = validatePdfFile(file);
      if (validationError) {
        notify(validationError);
        return;
      }

      const bytes = new Uint8Array(await file.arrayBuffer());
      await loadHostBytes(file.name, bytes, 1, true);
    },
    [role, loadHostBytes, notify]
  );

  const applyHostNavigation = useCallback(
    (nav: NavigationAction, initiator: ParticipantRole) => {
      const current = stateRef.current;
      const doc = current.document;
      if (!doc || doc.docId !== nav.docId) return;

      const targetPage = computeTargetPage(current.currentPage, doc.totalPages, nav);
      if (targetPage === current.currentPage) return;

      const nextRevision = current.revision + 1;
      updateHostReloadPage(roomCode, targetPage);

      setState((prev) => ({
        ...prev,
        currentPage: targetPage,
        revision: nextRevision,
        lastUpdatedBy: initiator,
      }));

      hostTransportRef.current?.broadcast({
        v: PROTOCOL_VERSION,
        type: 'SYNC_PAGE',
        docId: doc.docId,
        page: targetPage,
        revision: nextRevision,
        by: initiator,
      });
    },
    [roomCode]
  );

  const navigate = useCallback(
    (action: 'next' | 'prev' | 'goto', page?: number) => {
      const current = stateRef.current;
      const doc = current.document;
      if (!doc) return;

      const nav: NavigationAction =
        action === 'goto'
          ? { action: 'goto', page: page ?? 1, docId: doc.docId }
          : { action, docId: doc.docId };

      if (role === 'host') {
        applyHostNavigation(nav, 'host');
        return;
      }

      const targetPage = computeTargetPage(current.currentPage, doc.totalPages, nav);
      if (targetPage === current.currentPage) return;

      setState((prev) => ({
        ...prev,
        currentPage: targetPage,
        lastUpdatedBy: 'co-presenter',
      }));

      guestTransportRef.current?.send({
        v: PROTOCOL_VERSION,
        type: 'NAVIGATE',
        docId: doc.docId,
        action: nav.action,
        ...(nav.action === 'goto' ? { page: nav.page } : {}),
      });
    },
    [role, applyHostNavigation]
  );

  const nextPage = useCallback(() => navigate('next'), [navigate]);
  const prevPage = useCallback(() => navigate('prev'), [navigate]);
  const goToPage = useCallback((page: number) => navigate('goto', page), [navigate]);

  const endSession = useCallback(() => {
    fileLoadSeqRef.current += 1;
    pendingPasswordDocRef.current = null;
    setPasswordRequest(null);
    transferAbortRef.current?.abort();
    hostTransportRef.current?.endSession();
    hostTransportRef.current = null;
    guestTransportRef.current?.destroy();
    guestTransportRef.current = null;
    hostDocRef.current = null;
    assemblerRef.current = null;
    engineRef.current?.destroy();
    if (role === 'host') {
      clearHostReloadState();
    }

    setState((prev) => ({ ...prev, status: 'ended', connectedPeers: 0 }));
  }, [role]);

  useEffect(() => {
    const engine = engineRef.current!;

    if (role === 'host') {
      if (initialFile) {
        void loadHostFile(initialFile);
      } else {
        void loadHostReloadState(roomCode).then((saved) => {
          if (saved) {
            void loadHostBytes(saved.fileName, saved.bytes, saved.currentPage, false);
          }
        });
      }

      const cleanupHost = startHostLifecycle({
        roomCode,
        engine,
        hostTransportRef,
        hostDocRef,
        transferAbortRef,
        stateRef,
        setState,
        applyHostNavigation,
        notify,
      });
      return () => {
        fileLoadSeqRef.current += 1;
        cleanupHost();
      };
    }

    return startGuestLifecycle({
      roomCode,
      engine,
      guestTransportRef,
      assemblerRef,
      pendingPasswordDocRef,
      setPasswordRequest,
      setState,
      notify,
    });
  }, [
    role,
    roomCode,
    initialFile,
    loadHostFile,
    loadHostBytes,
    applyHostNavigation,
    notify,
  ]);

  return {
    state,
    engine: engineRef.current,
    passwordRequest,
    loadHostFile,
    submitPdfPassword,
    cancelPdfPassword,
    nextPage,
    prevPage,
    goToPage,
    endSession,
  };
}

interface HostLifecycleDeps {
  roomCode: string;
  engine: PdfEngine;
  hostTransportRef: React.RefObject<HostTransport | null>;
  hostDocRef: React.RefObject<HostDocumentBuffer | null>;
  transferAbortRef: React.RefObject<AbortController | null>;
  stateRef: React.RefObject<SessionState>;
  setState: Dispatch<SetStateAction<SessionState>>;
  applyHostNavigation: (nav: NavigationAction, initiator: ParticipantRole) => void;
  notify: (msg: string) => void;
}

function startHostLifecycle(deps: HostLifecycleDeps): () => void {
  let active = true;

  const transport = new HostTransport(deps.roomCode, {
    onReady: () => {
      if (!active) return;
      deps.setState((prev) => ({ ...prev, status: 'ready', errorMessage: null }));
    },
    onPeerConnected: (conn) => {
      if (!active) return;
      deps.setState((prev) => ({ ...prev, connectedPeers: transport.peerCount }));
      deps.notify('Coapresentador conectado.');

      const doc = deps.hostDocRef.current;
      if (doc) {
        void streamDocumentToConnection(conn, {
          docId: doc.docId,
          fileName: doc.fileName,
          bytes: doc.bytes,
          initialPage: deps.stateRef.current.currentPage,
        });
      }
    },
    onPeerDisconnected: () => {
      if (!active) return;
      deps.setState((prev) => ({ ...prev, connectedPeers: transport.peerCount }));
      deps.notify('Um coapresentador saiu da sala.');
    },
    onMessage: (_peerId, msg) => {
      if (!active || msg.type !== 'NAVIGATE') return;
      const nav: NavigationAction =
        msg.action === 'goto'
          ? { action: 'goto', page: msg.page ?? 1, docId: msg.docId }
          : { action: msg.action, docId: msg.docId };
      deps.applyHostNavigation(nav, 'co-presenter');
    },
    onError: (message) => {
      if (!active) return;
      deps.setState((prev) => ({ ...prev, status: 'error', errorMessage: message }));
    },
  });

  deps.hostTransportRef.current = transport;

  const handlePageHide = () => {
    deps.hostTransportRef.current?.destroy();
  };
  window.addEventListener('pagehide', handlePageHide);

  return () => {
    active = false;
    window.removeEventListener('pagehide', handlePageHide);
    deps.transferAbortRef.current?.abort();
    transport.destroy();
    deps.hostTransportRef.current = null;
    deps.engine.destroy();
  };
}

interface GuestLifecycleDeps {
  roomCode: string;
  engine: PdfEngine;
  guestTransportRef: React.RefObject<GuestTransport | null>;
  assemblerRef: React.RefObject<PdfChunkAssembler | null>;
  pendingPasswordDocRef: React.RefObject<PendingPasswordDoc | null>;
  setPasswordRequest: Dispatch<SetStateAction<PasswordRequest | null>>;
  setState: Dispatch<SetStateAction<SessionState>>;
  notify: (msg: string) => void;
}

function startGuestLifecycle(deps: GuestLifecycleDeps): () => void {
  let active = true;
  let endedExplicitly = false;
  let hadConnectedOnce = false;
  let reconnectAttempts = 0;
  let reconnectTimer: number | null = null;

  const isActive = () => active;

  const clearReconnectTimer = () => {
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const scheduleReconnect = () => {
    if (!active || endedExplicitly) return;
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      deps.engine.destroy();
      deps.setState((prev) => ({ ...prev, status: 'ended', document: null }));
      return;
    }

    reconnectAttempts += 1;
    deps.setState((prev) => ({ ...prev, status: 'reconnecting', errorMessage: null }));
    clearReconnectTimer();
    reconnectTimer = window.setTimeout(() => {
      if (active && !endedExplicitly) {
        connect();
      }
    }, RECONNECT_DELAY_MS);
  };

  const connect = () => {
    deps.guestTransportRef.current?.destroy();

    const guest = new GuestTransport(deps.roomCode, {
      onConnected: () => {
        if (!active) return;
        hadConnectedOnce = true;
        reconnectAttempts = 0;
        deps.setState((prev) => ({
          ...prev,
          status: 'transferring',
          transferProgress: 0,
          errorMessage: null,
        }));
      },
      onMessage: (msg) => {
        if (!active) return;
        if (msg.type === 'SESSION_END') {
          endedExplicitly = true;
          clearReconnectTimer();
        }
        handleGuestMessage(msg, deps, isActive);
      },
      onDisconnected: () => {
        if (!active || endedExplicitly) return;
        scheduleReconnect();
      },
      onError: (message) => {
        if (!active || endedExplicitly) return;
        if (hadConnectedOnce) {
          scheduleReconnect();
          return;
        }
        deps.setState((prev) => ({ ...prev, status: 'error', errorMessage: message }));
      },
    });

    deps.guestTransportRef.current = guest;
  };

  connect();

  const handlePageHide = () => {
    deps.guestTransportRef.current?.destroy();
  };
  window.addEventListener('pagehide', handlePageHide);

  return () => {
    active = false;
    window.removeEventListener('pagehide', handlePageHide);
    clearReconnectTimer();
    deps.guestTransportRef.current?.destroy();
    deps.guestTransportRef.current = null;
    deps.assemblerRef.current = null;
    deps.pendingPasswordDocRef.current = null;
    deps.setPasswordRequest(null);
    deps.engine.destroy();
  };
}

function handleGuestMessage(
  msg: PeerMessage,
  deps: GuestLifecycleDeps,
  isActive: () => boolean
): void {
  switch (msg.type) {
    case 'DOC_META':
      handleIncomingDocMeta(msg, deps);
      break;
    case 'DOC_CHUNK':
      handleIncomingDocChunk(msg, deps);
      break;
    case 'DOC_END':
      handleIncomingDocEnd(msg.docId, deps, isActive);
      break;
    case 'SYNC_PAGE':
      deps.setState((prev) => {
        if (!prev.document || prev.document.docId !== msg.docId) return prev;
        return {
          ...prev,
          currentPage: clampPage(msg.page, prev.document.totalPages),
          revision: Math.max(prev.revision, msg.revision),
          lastUpdatedBy: msg.by,
        };
      });
      break;
    case 'SESSION_END':
      deps.engine.destroy();
      deps.assemblerRef.current = null;
      deps.pendingPasswordDocRef.current = null;
      deps.setPasswordRequest(null);
      deps.setState((prev) => ({ ...prev, status: 'ended', document: null }));
      break;
    default:
      break;
  }
}

function handleIncomingDocMeta(
  msg: Extract<PeerMessage, { type: 'DOC_META' }>,
  deps: GuestLifecycleDeps
): void {
  deps.pendingPasswordDocRef.current = null;
  deps.setPasswordRequest(null);

  try {
    deps.assemblerRef.current = new PdfChunkAssembler({
      docId: msg.docId,
      fileName: msg.fileName,
      byteLength: msg.byteLength,
      totalChunks: msg.totalChunks,
      initialPage: msg.initialPage,
    });
    deps.setState((prev) => ({
      ...prev,
      status: 'transferring',
      transferProgress: 0,
      errorMessage: null,
    }));
  } catch {
    deps.setState((prev) => ({
      ...prev,
      status: 'error',
      errorMessage: 'Metadados do PDF inválidos.',
    }));
  }
}

function handleIncomingDocChunk(
  msg: Extract<PeerMessage, { type: 'DOC_CHUNK' }>,
  deps: GuestLifecycleDeps
): void {
  const assembler = deps.assemblerRef.current;
  if (!assembler || assembler.header.docId !== msg.docId) return;
  const progress = assembler.addChunk(msg.index, msg.data);
  deps.setState((prev) => ({ ...prev, transferProgress: progress }));
}

function handleIncomingDocEnd(
  docId: string,
  deps: GuestLifecycleDeps,
  isActive: () => boolean
): void {
  const assembler = deps.assemblerRef.current;
  if (!assembler || assembler.header.docId !== docId) return;

  try {
    const bytes = assembler.assemble();
    const header = assembler.header;
    deps.assemblerRef.current = null;

    void deps.engine
      .load(bytes)
      .then((totalPages) => {
        if (!isActive()) return;
        deps.setState((prev) => ({
          ...prev,
          status: 'synced',
          transferProgress: 1,
          document: {
            docId: header.docId,
            fileName: header.fileName,
            byteLength: header.byteLength,
            totalPages,
          },
          currentPage: clampPage(header.initialPage, totalPages),
          revision: prev.revision + 1,
          lastUpdatedBy: 'host',
        }));
        deps.notify(`PDF sincronizado: ${header.fileName}`);
      })
      .catch((err: unknown) => {
        if (!isActive()) return;
        const classified = classifyPdfLoadError(err);

        if (
          classified.code === 'password_required' ||
          classified.code === 'password_incorrect'
        ) {
          deps.pendingPasswordDocRef.current = {
            source: 'guest',
            header: {
              docId: header.docId,
              fileName: header.fileName,
              byteLength: header.byteLength,
              initialPage: header.initialPage,
            },
            bytes,
          };
          deps.setPasswordRequest({
            fileName: header.fileName,
            errorMessage: null,
            submitting: false,
          });
          return;
        }

        deps.setState((prev) => ({
          ...prev,
          status: 'error',
          errorMessage: getGuestPdfErrorMessage(classified),
        }));
      });
  } catch {
    deps.setState((prev) => ({
      ...prev,
      status: 'error',
      errorMessage: 'A transferência do PDF falhou. Recarregue para tentar novamente.',
    }));
  }
}
