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
  SessionEngine,
  SessionStore,
} from '../types';

function createTestStore(role: ParticipantRole, roomCode = 'K7M2-P9X4') {
  let state: SessionState = createInitialSessionState(role, roomCode);
  let passwordRequest: PasswordRequest | null = null;
  const notices: string[] = [];

  const store: SessionStore = {
    getState: () => state,
    updateState: (updater) => {
      state = updater(state);
    },
    setPasswordRequest: (next) => {
      passwordRequest = typeof next === 'function' ? next(passwordRequest) : next;
    },
    notify: (msg) => {
      notices.push(msg);
    },
  };

  return {
    store,
    getState: () => state,
    getPasswordRequest: () => passwordRequest,
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
});
