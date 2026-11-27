import Peer, { type DataConnection, type PeerOptions } from 'peerjs';
import { env } from '@/config/env';
import { resolveIceServers } from '@/infrastructure/iceServers';
import {
  PROTOCOL_VERSION,
  parsePeerMessage,
  roomCodeToPeerId,
  type PeerMessage,
} from '@/domain/protocol';
import { CHUNK_SIZE_BYTES, slicePdfIntoChunks } from '@/domain/chunker';

const BUFFER_HIGH_WATER_BYTES = 512 * 1024;
const BUFFER_LOW_WATER_BYTES = 128 * 1024;
const DRAIN_FALLBACK_TIMEOUT_MS = 120;
const HEARTBEAT_INTERVAL_MS = 4000;
const HEARTBEAT_STALE_MS = 10_000;

function safeInvoke(fn: () => void): void {
  try {
    fn();
  } catch {
    // peer/channel might already be closed
  }
}

function buildPeerOptions(iceServers: RTCIceServer[]): PeerOptions {
  const options: PeerOptions = {
    debug: 0,
    config: { iceServers },
  };

  if (env.peerHost) {
    options.host = env.peerHost;
    if (env.peerPort !== undefined) options.port = env.peerPort;
    if (env.peerPath) options.path = env.peerPath;
    if (env.peerSecure !== undefined) options.secure = env.peerSecure;
  }

  return options;
}

function waitForDataChannelDrain(conn: DataConnection): Promise<void> {
  const channel = conn.dataChannel;
  if (!channel || channel.bufferedAmount < BUFFER_HIGH_WATER_BYTES) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      channel.removeEventListener('bufferedamountlow', finish);
      resolve();
    };
    channel.bufferedAmountLowThreshold = BUFFER_LOW_WATER_BYTES;
    channel.addEventListener('bufferedamountlow', finish, { once: true });
    window.setTimeout(finish, DRAIN_FALLBACK_TIMEOUT_MS);
  });
}

export interface StreamableDocument {
  docId: string;
  fileName: string;
  bytes: Uint8Array;
  initialPage: number;
}

export async function streamDocumentToConnection(
  conn: DataConnection,
  doc: StreamableDocument,
  signal?: AbortSignal
): Promise<void> {
  if (!conn.open) return;

  const chunks = slicePdfIntoChunks(doc.bytes, CHUNK_SIZE_BYTES);
  conn.send({
    v: PROTOCOL_VERSION,
    type: 'DOC_META',
    docId: doc.docId,
    fileName: doc.fileName,
    byteLength: doc.bytes.byteLength,
    totalChunks: chunks.length,
    initialPage: doc.initialPage,
  } satisfies PeerMessage);

  for (let index = 0; index < chunks.length; index++) {
    if (!conn.open || signal?.aborted) return;
    await waitForDataChannelDrain(conn);
    if (!conn.open || signal?.aborted) return;

    conn.send({
      v: PROTOCOL_VERSION,
      type: 'DOC_CHUNK',
      docId: doc.docId,
      index,
      data: chunks[index],
    } satisfies PeerMessage);
  }

  if (!conn.open || signal?.aborted) return;
  conn.send({
    v: PROTOCOL_VERSION,
    type: 'DOC_END',
    docId: doc.docId,
  } satisfies PeerMessage);
}

export interface HostTransportCallbacks {
  onReady: (peerId: string) => void;
  onPeerConnected: (conn: DataConnection) => void;
  onPeerDisconnected: (peerId: string) => void;
  onMessage: (peerId: string, msg: PeerMessage) => void;
  onError: (message: string) => void;
}

interface TrackedConnection {
  conn: DataConnection;
  lastSeenAt: number;
  detach: () => void;
}

export class HostTransport {
  private peer: Peer | null = null;
  private readonly connections = new Map<string, TrackedConnection>();
  private readonly callbacks: HostTransportCallbacks;
  private readonly initAbort = new AbortController();
  private heartbeatTimer: number | null = null;
  private destroyed = false;

  constructor(roomCode: string, callbacks: HostTransportCallbacks) {
    this.callbacks = callbacks;
    void this.init(roomCode);
  }

  private async init(roomCode: string): Promise<void> {
    const iceServers = await resolveIceServers(this.initAbort.signal);
    if (this.destroyed) return;

    const peer = new Peer(roomCodeToPeerId(roomCode), buildPeerOptions(iceServers));
    this.peer = peer;

    peer.on('open', (id) => {
      if (!this.destroyed) {
        this.startHeartbeat();
        this.callbacks.onReady(id);
      }
    });
    peer.on('connection', (conn) => this.attachConnection(conn));
    peer.on('disconnected', () => this.attemptReconnect());
    peer.on('error', (err) => this.handlePeerError(err.type));
  }

  get activeConnections(): DataConnection[] {
    return Array.from(this.connections.values())
      .map((entry) => entry.conn)
      .filter((c) => c.open);
  }

  get peerCount(): number {
    return this.connections.size;
  }

  broadcast(message: PeerMessage): void {
    for (const { conn } of this.connections.values()) {
      if (conn.open) conn.send(message);
    }
  }

  endSession(): void {
    this.broadcast({
      v: PROTOCOL_VERSION,
      type: 'SESSION_END',
      reason: 'host_ended',
    });
    this.destroy();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.initAbort.abort();
    this.stopHeartbeat();

    for (const { conn } of this.connections.values()) {
      safeInvoke(() => conn.close());
    }
    this.connections.clear();

    if (this.peer) {
      const peerToDestroy = this.peer;
      this.peer = null;
      safeInvoke(() => peerToDestroy.destroy());
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      const now = Date.now();
      for (const entry of Array.from(this.connections.values())) {
        if (!entry.conn.open || now - entry.lastSeenAt > HEARTBEAT_STALE_MS) {
          entry.detach();
          continue;
        }
        safeInvoke(() =>
          entry.conn.send({
            v: PROTOCOL_VERSION,
            type: 'PING',
            ts: now,
          } satisfies PeerMessage)
        );
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private attachConnection(conn: DataConnection): void {
    if (this.destroyed) {
      conn.close();
      return;
    }

    const peerId = conn.peer;
    let detached = false;

    const detach = () => {
      if (detached) return;
      detached = true;
      safeInvoke(() => conn.close());
      if (this.connections.delete(peerId) && !this.destroyed) {
        this.callbacks.onPeerDisconnected(peerId);
      }
    };

    const onIceStateChange = () => {
      const iceState = conn.peerConnection?.iceConnectionState;
      if (iceState === 'failed' || iceState === 'closed') {
        detach();
      }
    };

    conn.on('open', () => {
      if (this.destroyed || detached) {
        conn.close();
        return;
      }
      this.connections.set(peerId, { conn, lastSeenAt: Date.now(), detach });
      conn.dataChannel?.addEventListener('close', detach, { once: true });
      conn.peerConnection?.addEventListener(
        'iceconnectionstatechange',
        onIceStateChange
      );
      this.callbacks.onPeerConnected(conn);
    });

    conn.on('data', (raw) => {
      const tracked = this.connections.get(peerId);
      if (tracked) tracked.lastSeenAt = Date.now();

      const msg = parsePeerMessage(raw);
      if (!msg) return;

      if (msg.type === 'PEER_LEAVE') {
        detach();
        return;
      }
      if (msg.type === 'PONG') {
        return;
      }
      if (msg.type === 'PING') {
        conn.send({
          v: PROTOCOL_VERSION,
          type: 'PONG',
          ts: msg.ts,
        } satisfies PeerMessage);
        return;
      }
      this.callbacks.onMessage(peerId, msg);
    });

    conn.on('close', detach);
    conn.on('error', detach);
  }

  private attemptReconnect(): void {
    if (!this.destroyed && this.peer && !this.peer.destroyed) {
      this.peer.reconnect();
    }
  }

  private handlePeerError(errorType: string): void {
    if (this.destroyed) return;
    if (errorType === 'unavailable-id') {
      this.callbacks.onError('Este código de sala já está em uso. Crie uma nova sala.');
    } else if (errorType === 'network' || errorType === 'server-error') {
      this.callbacks.onError(
        'Falha ao conectar ao serviço de sinalização. Verifique sua internet.'
      );
    } else {
      this.callbacks.onError('Erro na conexão P2P. Tente recarregar a sala.');
    }
  }
}

export interface GuestTransportCallbacks {
  onConnected: () => void;
  onMessage: (msg: PeerMessage) => void;
  onDisconnected: () => void;
  onError: (message: string) => void;
}

export class GuestTransport {
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private readonly callbacks: GuestTransportCallbacks;
  private readonly initAbort = new AbortController();
  private destroyed = false;
  private connectTimeoutId: number | null = null;

  constructor(roomCode: string, callbacks: GuestTransportCallbacks) {
    this.callbacks = callbacks;

    this.connectTimeoutId = window.setTimeout(() => {
      if (!this.destroyed && (!this.conn || !this.conn.open)) {
        this.callbacks.onError(
          'Não foi possível encontrar o anfitrião. Confirme se a apresentação ainda está aberta.'
        );
      }
    }, env.guestConnectTimeoutMs);

    void this.init(roomCode);
  }

  private async init(roomCode: string): Promise<void> {
    const iceServers = await resolveIceServers(this.initAbort.signal);
    if (this.destroyed) return;

    const hostPeerId = roomCodeToPeerId(roomCode);
    const peer = new Peer(buildPeerOptions(iceServers));
    this.peer = peer;

    peer.on('open', () => this.connectToHost(peer, hostPeerId));
    peer.on('error', (err) => this.handlePeerError(err.type));
  }

  send(message: PeerMessage): boolean {
    if (!this.conn || !this.conn.open) return false;
    this.conn.send(message);
    return true;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.initAbort.abort();
    this.clearConnectTimeout();

    if (this.conn) {
      const connToClose = this.conn;
      this.conn = null;
      if (connToClose.open) {
        safeInvoke(() =>
          connToClose.send({
            v: PROTOCOL_VERSION,
            type: 'PEER_LEAVE',
          } satisfies PeerMessage)
        );
      }
      safeInvoke(() => connToClose.close());
    }
    if (this.peer) {
      const peerToDestroy = this.peer;
      this.peer = null;
      safeInvoke(() => peerToDestroy.destroy());
    }
  }

  private connectToHost(peer: Peer, hostPeerId: string): void {
    if (this.destroyed) return;
    const conn = peer.connect(hostPeerId, {
      reliable: true,
      serialization: 'binary',
    });
    this.conn = conn;

    conn.on('open', () => {
      if (this.destroyed) return;
      this.clearConnectTimeout();
      this.callbacks.onConnected();
    });

    conn.on('data', (raw) => {
      if (this.destroyed) return;
      const msg = parsePeerMessage(raw);
      if (!msg) return;
      if (msg.type === 'PING') {
        safeInvoke(() =>
          conn.send({
            v: PROTOCOL_VERSION,
            type: 'PONG',
            ts: msg.ts,
          } satisfies PeerMessage)
        );
        return;
      }
      this.callbacks.onMessage(msg);
    });

    conn.on('close', () => {
      if (this.destroyed) return;
      this.clearConnectTimeout();
      this.callbacks.onDisconnected();
    });

    conn.on('error', () => {
      if (this.destroyed) return;
      this.clearConnectTimeout();
      this.callbacks.onError('A conexão com o anfitrião foi interrompida.');
    });
  }

  private handlePeerError(errorType: string): void {
    if (this.destroyed) return;
    this.clearConnectTimeout();
    if (errorType === 'peer-unavailable') {
      this.callbacks.onError(
        'Esta sala não existe mais ou o anfitrião já encerrou a apresentação.'
      );
    } else {
      this.callbacks.onError(
        'Não foi possível conectar ao anfitrião. Verifique sua conexão e tente novamente.'
      );
    }
  }

  private clearConnectTimeout(): void {
    if (this.connectTimeoutId !== null) {
      window.clearTimeout(this.connectTimeoutId);
      this.connectTimeoutId = null;
    }
  }
}
