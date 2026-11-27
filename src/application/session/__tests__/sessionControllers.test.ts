import { describe, expect, it, vi } from 'vitest';
import type { DataConnection } from 'peerjs';
import {
  PROTOCOL_VERSION,
  type ParticipantRole,
  type PeerMessage,
} from '@/domain/protocol';
import { PdfLoadError } from '@/domain/pdfErrors';
import { createInitialSessionState, type SessionState } from '@/domain/session';
import type {
  GuestTransportCallbacks,
  HostTransportCallbacks,
} from '@/infrastructure/peerTransport';
import { HostSessionController, type HostReloadStore } from '../hostSessionController';
import { GuestSessionController } from '../guestSessionController';
import type {
  GuestTransportPort,
  HostTransportPort,
  PasswordRequest,
  RoomAuthRequest,
  SessionEngine,
  SessionStore,
} from '../types';

function createTestStore(role: ParticipantRole, roomCode = 'K7M2-P9X4') {
  let state: SessionState = createInitialSessionState(role, roomCode);
  let passwordRequest: PasswordRequest | null = null;
  let roomAuthRequest: RoomAuthRequest | null = null;
  const notices: string[] = [];

  const store: SessionStore = {
    getState: () => state,
    updateState: (updater) => {
      state = updater(state);
    },
    setPasswordRequest: (next) => {
      passwordRequest = typeof next === 'function' ? next(passwordRequest) : next;
    },
    setRoomAuthRequest: (next) => {
      roomAuthRequest = typeof next === 'function' ? next(roomAuthRequest) : next;
    },
    notify: (msg) => {
      notices.push(msg);
    },
  };

  return {
    store,
    getState: () => state,
    getPasswordRequest: () => passwordRequest,
    getRoomAuthRequest: () => roomAuthRequest,
    notices,
  };
}

function createFakePdfFile(name = 'deck.pdf', content = '%PDF-1.7 test'): File {
  const bytes = new TextEncoder().encode(content);
  return {
    name,
    size: bytes.byteLength,
    type: 'application/pdf',
    arrayBuffer: async () => bytes.buffer,
  } as unknown as File;
}

describe('HostSessionController', () => {
  it('loads a PDF, streams it to peers, and broadcasts authoritative navigation', async () => {
    const testStore = createTestStore('host');
    const engine: SessionEngine = {
      load: vi.fn().mockResolvedValue(10),
      destroy: vi.fn(),
    };
    const fakeConn = { open: true } as DataConnection;
    const broadcasted: PeerMessage[] = [];
    let hostCallbacks!: HostTransportCallbacks;

    const transport: HostTransportPort = {
      activeConnections: [fakeConn],
      peerCount: 1,
      broadcast: vi.fn((msg) => broadcasted.push(msg)),
      endSession: vi.fn(),
      destroy: vi.fn(),
    };

    const reloadStore: HostReloadStore = {
      load: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockResolvedValue(undefined),
      updatePage: vi.fn(),
      clear: vi.fn(),
    };

    const streamDocument = vi.fn().mockResolvedValue(undefined);

    const controller = new HostSessionController({
      roomCode: 'K7M2-P9X4',
      engine,
      store: testStore.store,
      createTransport: (_room, cb) => {
        hostCallbacks = cb;
        return transport;
      },
      streamDocument,
      reloadStore,
      registerPageHide: () => () => undefined,
    });

    controller.start();
    hostCallbacks.onReady('peer-host');
    expect(testStore.getState().status).toBe('ready');

    await controller.loadHostFile(createFakePdfFile('talk.pdf'));
    const docId = testStore.getState().document?.docId;
    expect(docId).toBeTruthy();
    expect(testStore.getState().document?.totalPages).toBe(10);
    expect(streamDocument).toHaveBeenCalledTimes(1);
    expect(reloadStore.save).toHaveBeenCalledTimes(1);
    expect(testStore.notices).toContain('Documento carregado: talk.pdf');

    // Host navigates forward
    controller.navigate('next');
    expect(testStore.getState().currentPage).toBe(2);
    expect(reloadStore.updatePage).toHaveBeenCalledWith('K7M2-P9X4', 2);
    expect(broadcasted.at(-1)).toMatchObject({
      type: 'SYNC_PAGE',
      docId,
      page: 2,
      by: 'host',
    });

    // Co-presenter requests navigation via transport message
    hostCallbacks.onMessage('peer-guest', {
      v: PROTOCOL_VERSION,
      type: 'NAVIGATE',
      docId: docId!,
      action: 'goto',
      page: 5,
    });
    expect(testStore.getState().currentPage).toBe(5);
    expect(testStore.getState().lastUpdatedBy).toBe('co-presenter');
    expect(broadcasted.at(-1)).toMatchObject({
      type: 'SYNC_PAGE',
      docId,
      page: 5,
      by: 'co-presenter',
    });

    controller.endSession();
    expect(transport.endSession).toHaveBeenCalledTimes(1);
    expect(reloadStore.clear).toHaveBeenCalledTimes(1);
    expect(testStore.getState().status).toBe('ended');
  });

  it('tracks spectators separately, broadcasts ROOM_CONFIG, and ignores spectator NAVIGATE', async () => {
    const testStore = createTestStore('host');
    const engine: SessionEngine = {
      load: vi.fn().mockResolvedValue(8),
      destroy: vi.fn(),
    };
    const broadcasted: PeerMessage[] = [];
    const directSent: PeerMessage[] = [];
    let hostCallbacks!: HostTransportCallbacks;

    const transport: HostTransportPort = {
      activeConnections: [],
      peerCount: 0,
      broadcast: vi.fn((msg) => broadcasted.push(msg)),
      endSession: vi.fn(),
      destroy: vi.fn(),
    };

    const reloadStore: HostReloadStore = {
      load: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockResolvedValue(undefined),
      updatePage: vi.fn(),
      updateSpectatorMode: vi.fn(),
      clear: vi.fn(),
    };

    const controller = new HostSessionController({
      roomCode: 'K7M2-P9X4',
      engine,
      store: testStore.store,
      createTransport: (_room, cb) => {
        hostCallbacks = cb;
        return transport;
      },
      streamDocument: vi.fn().mockResolvedValue(undefined),
      reloadStore,
      registerPageHide: () => () => undefined,
    });

    controller.start();
    hostCallbacks.onReady('peer-host');
    await controller.loadHostFile(createFakePdfFile('slides.pdf'));
    const docId = testStore.getState().document!.docId;

    const spectatorConn = {
      peer: 'peer-spectator-1',
      open: true,
      send: vi.fn((msg: PeerMessage) => directSent.push(msg)),
    } as unknown as DataConnection;

    hostCallbacks.onPeerConnected(spectatorConn, 'spectator');
    expect(testStore.getState().connectedSpectators).toBe(1);
    expect(testStore.getState().connectedCoPresenters).toBe(0);
    expect(directSent).toContainEqual({
      v: PROTOCOL_VERSION,
      type: 'ROOM_CONFIG',
      spectatorMode: 'follow',
    });

    // Spectator attempts to navigate — host must ignore
    hostCallbacks.onMessage('peer-spectator-1', {
      v: PROTOCOL_VERSION,
      type: 'NAVIGATE',
      docId,
      action: 'next',
    });
    expect(testStore.getState().currentPage).toBe(1);

    // Host toggles spectator mode to free
    controller.setSpectatorMode('free');
    expect(testStore.getState().spectatorMode).toBe('free');
    expect(reloadStore.updateSpectatorMode).toHaveBeenCalledWith('K7M2-P9X4', 'free');
    expect(broadcasted.at(-1)).toEqual({
      v: PROTOCOL_VERSION,
      type: 'ROOM_CONFIG',
      spectatorMode: 'free',
    });

    hostCallbacks.onPeerDisconnected('peer-spectator-1', 'spectator');
    expect(testStore.getState().connectedSpectators).toBe(0);

    controller.destroy();
  });

  it('requires password authentication before authorizing a co-presenter', async () => {
    const testStore = createTestStore('host');
    const engine: SessionEngine = {
      load: vi.fn().mockResolvedValue(6),
      destroy: vi.fn(),
    };
    const streamDocument = vi.fn().mockResolvedValue(undefined);
    let hostCallbacks!: HostTransportCallbacks;

    const controller = new HostSessionController({
      roomCode: 'K7M2-P9X4',
      engine,
      store: testStore.store,
      createTransport: (_room, cb) => {
        hostCallbacks = cb;
        return {
          activeConnections: [],
          peerCount: 0,
          broadcast: vi.fn(),
          endSession: vi.fn(),
          destroy: vi.fn(),
        };
      },
      streamDocument,
      reloadStore: {
        load: vi.fn().mockResolvedValue(null),
        save: vi.fn().mockResolvedValue(undefined),
        updatePage: vi.fn(),
        updatePassword: vi.fn(),
        clear: vi.fn(),
      },
      registerPageHide: () => () => undefined,
    });

    controller.start();
    hostCallbacks.onReady('peer-host');
    await controller.loadHostFile(createFakePdfFile('deck.pdf'));
    const docId = testStore.getState().document!.docId;
    const roomPassword = testStore.getState().coPresenterPassword!;
    expect(roomPassword).toMatch(/^[A-Z0-9]{6}$/);

    const sentToCoPresenter: PeerMessage[] = [];
    const coPresenterConn = {
      peer: 'peer-co-1',
      open: true,
      send: vi.fn((msg: PeerMessage) => sentToCoPresenter.push(msg)),
    } as unknown as DataConnection;

    // Connects as co-presenter -> host requests auth and does NOT stream PDF yet
    hostCallbacks.onPeerConnected(coPresenterConn, 'co-presenter');
    expect(testStore.getState().connectedCoPresenters).toBe(0);
    expect(streamDocument).not.toHaveBeenCalled();
    expect(sentToCoPresenter.at(-1)).toEqual({
      v: PROTOCOL_VERSION,
      type: 'AUTH_REQUIRED',
      reason: 'required',
    });

    // Unauthenticated co-presenter tries to navigate -> ignored
    hostCallbacks.onMessage('peer-co-1', {
      v: PROTOCOL_VERSION,
      type: 'NAVIGATE',
      docId,
      action: 'next',
    });
    expect(testStore.getState().currentPage).toBe(1);

    // Wrong password -> rejected
    hostCallbacks.onMessage('peer-co-1', {
      v: PROTOCOL_VERSION,
      type: 'AUTH_SUBMIT',
      password: 'WRONG1',
    });
    expect(sentToCoPresenter.at(-1)).toEqual({
      v: PROTOCOL_VERSION,
      type: 'AUTH_REQUIRED',
      reason: 'invalid_password',
    });
    expect(testStore.getState().connectedCoPresenters).toBe(0);

    // Correct password (case-insensitive) -> authorized, PDF streamed, can navigate
    hostCallbacks.onMessage('peer-co-1', {
      v: PROTOCOL_VERSION,
      type: 'AUTH_SUBMIT',
      password: roomPassword.toLowerCase(),
    });
    expect(sentToCoPresenter).toContainEqual({
      v: PROTOCOL_VERSION,
      type: 'AUTH_OK',
    });
    expect(testStore.getState().connectedCoPresenters).toBe(1);
    expect(streamDocument).toHaveBeenCalledTimes(1);

    hostCallbacks.onMessage('peer-co-1', {
      v: PROTOCOL_VERSION,
      type: 'NAVIGATE',
      docId,
      action: 'next',
    });
    expect(testStore.getState().currentPage).toBe(2);

    controller.destroy();
  });
});

describe('GuestSessionController', () => {
  it('reassembles incoming PDF chunks, supports password unlock, and sends optimistic navigation', async () => {
    const testStore = createTestStore('co-presenter');
    const load = vi
      .fn()
      .mockRejectedValueOnce(new PdfLoadError('password_required', 'Senha necessária.'))
      .mockResolvedValueOnce(6);
    const engine: SessionEngine = { load, destroy: vi.fn() };

    const sent: PeerMessage[] = [];
    let guestCallbacks!: GuestTransportCallbacks;
    const transport: GuestTransportPort = {
      send: vi.fn((msg) => {
        sent.push(msg);
        return true;
      }),
      destroy: vi.fn(),
    };

    const controller = new GuestSessionController({
      roomCode: 'K7M2-P9X4',
      engine,
      store: testStore.store,
      createTransport: (_room, cb) => {
        guestCallbacks = cb;
        return transport;
      },
      registerPageHide: () => () => undefined,
    });

    controller.start();
    guestCallbacks.onConnected();
    expect(testStore.getState().status).toBe('transferring');

    const payload = new Uint8Array([37, 80, 68, 70]);
    guestCallbacks.onMessage({
      v: PROTOCOL_VERSION,
      type: 'DOC_META',
      docId: 'doc-1',
      fileName: 'protected.pdf',
      byteLength: payload.byteLength,
      totalChunks: 1,
      initialPage: 2,
    });
    guestCallbacks.onMessage({
      v: PROTOCOL_VERSION,
      type: 'DOC_CHUNK',
      docId: 'doc-1',
      index: 0,
      data: payload,
    });
    guestCallbacks.onMessage({
      v: PROTOCOL_VERSION,
      type: 'DOC_END',
      docId: 'doc-1',
    });

    await vi.waitFor(() => {
      expect(testStore.getPasswordRequest()?.fileName).toBe('protected.pdf');
    });

    await controller.submitPdfPassword('secret123');
    expect(testStore.getState().status).toBe('synced');
    expect(testStore.getState().currentPage).toBe(2);
    expect(testStore.getState().document?.totalPages).toBe(6);

    controller.navigate('next');
    expect(testStore.getState().currentPage).toBe(3);
    expect(sent).toContainEqual({
      v: PROTOCOL_VERSION,
      type: 'NAVIGATE',
      docId: 'doc-1',
      action: 'next',
    });

    controller.destroy();
  });

  it('retries up to maxReconnectAttempts and then ends the session', () => {
    const testStore = createTestStore('co-presenter');
    const engine: SessionEngine = { load: vi.fn(), destroy: vi.fn() };
    const callbacksList: GuestTransportCallbacks[] = [];
    const scheduled: Array<() => void> = [];

    const controller = new GuestSessionController({
      roomCode: 'K7M2-P9X4',
      engine,
      store: testStore.store,
      maxReconnectAttempts: 2,
      reconnectDelayMs: 100,
      createTransport: (_room, cb) => {
        callbacksList.push(cb);
        return { send: () => true, destroy: vi.fn() };
      },
      scheduleTimeout: (fn) => {
        scheduled.push(fn);
        return scheduled.length as unknown as ReturnType<typeof setTimeout>;
      },
      cancelTimeout: vi.fn(),
      registerPageHide: () => () => undefined,
    });

    controller.start();
    callbacksList[0].onConnected();

    // Attempt 1
    callbacksList[0].onDisconnected();
    expect(testStore.getState().status).toBe('reconnecting');
    scheduled.shift()?.();

    // Attempt 2
    callbacksList[1].onDisconnected();
    expect(testStore.getState().status).toBe('reconnecting');
    scheduled.shift()?.();

    // Exhausted
    callbacksList[2].onDisconnected();
    expect(testStore.getState().status).toBe('ended');
    expect(engine.destroy).toHaveBeenCalledTimes(1);

    controller.destroy();
  });

  it('does not reconnect after receiving explicit SESSION_END', () => {
    const testStore = createTestStore('co-presenter');
    const engine: SessionEngine = { load: vi.fn(), destroy: vi.fn() };
    let guestCallbacks!: GuestTransportCallbacks;
    const scheduleTimeout = vi.fn();

    const controller = new GuestSessionController({
      roomCode: 'K7M2-P9X4',
      engine,
      store: testStore.store,
      createTransport: (_room, cb) => {
        guestCallbacks = cb;
        return { send: () => true, destroy: vi.fn() };
      },
      scheduleTimeout,
      cancelTimeout: vi.fn(),
      registerPageHide: () => () => undefined,
    });

    controller.start();
    guestCallbacks.onConnected();
    guestCallbacks.onMessage({
      v: PROTOCOL_VERSION,
      type: 'SESSION_END',
      reason: 'host_ended',
    });
    guestCallbacks.onDisconnected();

    expect(testStore.getState().status).toBe('ended');
    expect(scheduleTimeout).not.toHaveBeenCalled();

    controller.destroy();
  });

  it('enforces spectator follow mode, supports free local navigation, and returns to host', async () => {
    const testStore = createTestStore('spectator');
    const engine: SessionEngine = {
      load: vi.fn().mockResolvedValue(10),
      destroy: vi.fn(),
    };
    const sent: PeerMessage[] = [];
    let guestCallbacks!: GuestTransportCallbacks;
    let connectedRole: string | undefined;

    const controller = new GuestSessionController({
      roomCode: 'K7M2-P9X4',
      role: 'spectator',
      engine,
      store: testStore.store,
      createTransport: (_room, cb, role) => {
        guestCallbacks = cb;
        connectedRole = role;
        return {
          send: vi.fn((msg) => {
            sent.push(msg);
            return true;
          }),
          destroy: vi.fn(),
        };
      },
      registerPageHide: () => () => undefined,
    });

    controller.start();
    expect(connectedRole).toBe('spectator');
    guestCallbacks.onConnected();

    const payload = new Uint8Array([37, 80, 68, 70]);
    guestCallbacks.onMessage({
      v: PROTOCOL_VERSION,
      type: 'DOC_META',
      docId: 'doc-1',
      fileName: 'deck.pdf',
      byteLength: payload.byteLength,
      totalChunks: 1,
      initialPage: 2,
    });
    guestCallbacks.onMessage({
      v: PROTOCOL_VERSION,
      type: 'DOC_CHUNK',
      docId: 'doc-1',
      index: 0,
      data: payload,
    });
    guestCallbacks.onMessage({
      v: PROTOCOL_VERSION,
      type: 'DOC_END',
      docId: 'doc-1',
    });

    await vi.waitFor(() => {
      expect(testStore.getState().status).toBe('synced');
    });
    expect(testStore.getState().currentPage).toBe(2);
    expect(testStore.getState().hostPage).toBe(2);
    expect(testStore.getState().spectatorMode).toBe('follow');

    // In follow mode, local navigation is blocked and nothing is sent to host
    controller.navigate('next');
    expect(testStore.getState().currentPage).toBe(2);
    expect(sent).toHaveLength(0);

    // Host advances to page 4 -> spectator follows
    guestCallbacks.onMessage({
      v: PROTOCOL_VERSION,
      type: 'SYNC_PAGE',
      docId: 'doc-1',
      page: 4,
      revision: 2,
      by: 'host',
    });
    expect(testStore.getState().currentPage).toBe(4);
    expect(testStore.getState().hostPage).toBe(4);
    expect(testStore.getState().isFollowingHost).toBe(true);

    // Host enables free navigation
    guestCallbacks.onMessage({
      v: PROTOCOL_VERSION,
      type: 'ROOM_CONFIG',
      spectatorMode: 'free',
    });
    expect(testStore.getState().spectatorMode).toBe('free');

    // Spectator browses locally to page 7 without sending NAVIGATE
    controller.navigate('goto', 7);
    expect(testStore.getState().currentPage).toBe(7);
    expect(testStore.getState().hostPage).toBe(4);
    expect(testStore.getState().isFollowingHost).toBe(false);
    expect(sent).toHaveLength(0);

    // Host advances to page 5 -> hostPage updates, spectator stays on page 7
    guestCallbacks.onMessage({
      v: PROTOCOL_VERSION,
      type: 'SYNC_PAGE',
      docId: 'doc-1',
      page: 5,
      revision: 3,
      by: 'host',
    });
    expect(testStore.getState().currentPage).toBe(7);
    expect(testStore.getState().hostPage).toBe(5);
    expect(testStore.getState().isFollowingHost).toBe(false);

    // Spectator clicks "Voltar ao anfitrião"
    controller.followHost();
    expect(testStore.getState().currentPage).toBe(5);
    expect(testStore.getState().isFollowingHost).toBe(true);

    // Spectator detaches again, then host forces follow mode back on
    controller.navigate('goto', 9);
    expect(testStore.getState().currentPage).toBe(9);
    expect(testStore.getState().isFollowingHost).toBe(false);

    guestCallbacks.onMessage({
      v: PROTOCOL_VERSION,
      type: 'ROOM_CONFIG',
      spectatorMode: 'follow',
    });
    expect(testStore.getState().spectatorMode).toBe('follow');
    expect(testStore.getState().currentPage).toBe(5);
    expect(testStore.getState().isFollowingHost).toBe(true);

    controller.destroy();
  });

  it('prompts co-presenter for room password and clears prompt on AUTH_OK', () => {
    const testStore = createTestStore('co-presenter');
    const engine: SessionEngine = { load: vi.fn(), destroy: vi.fn() };
    const sent: PeerMessage[] = [];
    let guestCallbacks!: GuestTransportCallbacks;

    const controller = new GuestSessionController({
      roomCode: 'K7M2-P9X4',
      role: 'co-presenter',
      engine,
      store: testStore.store,
      createTransport: (_room, cb) => {
        guestCallbacks = cb;
        return {
          send: vi.fn((msg) => {
            sent.push(msg);
            return true;
          }),
          destroy: vi.fn(),
        };
      },
      registerPageHide: () => () => undefined,
    });

    controller.start();
    guestCallbacks.onConnected();
    guestCallbacks.onMessage({
      v: PROTOCOL_VERSION,
      type: 'AUTH_REQUIRED',
      reason: 'required',
    });
    expect(testStore.getState().status).toBe('authenticating');
    expect(testStore.getRoomAuthRequest()?.errorMessage).toBeNull();

    controller.submitCoPresenterPassword('ABC123');
    expect(testStore.getRoomAuthRequest()?.submitting).toBe(true);
    expect(sent.at(-1)).toEqual({
      v: PROTOCOL_VERSION,
      type: 'AUTH_SUBMIT',
      password: 'ABC123',
    });

    guestCallbacks.onMessage({
      v: PROTOCOL_VERSION,
      type: 'AUTH_REQUIRED',
      reason: 'invalid_password',
    });
    expect(testStore.getRoomAuthRequest()?.submitting).toBe(false);
    expect(testStore.getRoomAuthRequest()?.errorMessage).toBeTruthy();

    controller.submitCoPresenterPassword('RIGHT1');
    guestCallbacks.onMessage({
      v: PROTOCOL_VERSION,
      type: 'AUTH_OK',
    });
    expect(testStore.getRoomAuthRequest()).toBeNull();
    expect(testStore.getState().status).toBe('transferring');

    controller.destroy();
  });
});
