import { env } from '@/config/env';

export const PROTOCOL_VERSION = 1 as const;
export const PEER_ID_PREFIX = env.peerIdPrefix;
export const MAX_PDF_BYTES = env.maxPdfBytes;

const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 8;
const ROOM_CODE_GROUP_SIZE = 4;
const DOC_ID_BYTE_LENGTH = 6;
const MAX_FILENAME_LENGTH = 200;

export type ParticipantRole = 'host' | 'co-presenter';

export type NavigationAction =
  | { action: 'next'; docId: string }
  | { action: 'prev'; docId: string }
  | { action: 'goto'; page: number; docId: string };

export type PeerMessage =
  | {
      v: typeof PROTOCOL_VERSION;
      type: 'DOC_META';
      docId: string;
      fileName: string;
      byteLength: number;
      totalChunks: number;
      initialPage: number;
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: 'DOC_CHUNK';
      docId: string;
      index: number;
      data: ArrayBuffer | Uint8Array;
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: 'DOC_END';
      docId: string;
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: 'SYNC_PAGE';
      docId: string;
      page: number;
      revision: number;
      by: ParticipantRole;
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: 'NAVIGATE';
      docId: string;
      action: 'next' | 'prev' | 'goto';
      page?: number;
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: 'SESSION_END';
      reason: 'host_ended';
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: 'PEER_LEAVE';
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: 'PING';
      ts: number;
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: 'PONG';
      ts: number;
    };

export type PrivilegedAction =
  | 'replace_document'
  | 'end_session'
  | 'invite_copresenter'
  | 'navigate'
  | 'toggle_fullscreen';

// only the host can swap the PDF, invite, or close the room
export function canPerformAction(
  role: ParticipantRole,
  action: PrivilegedAction
): boolean {
  switch (action) {
    case 'replace_document':
    case 'end_session':
    case 'invite_copresenter':
      return role === 'host';
    case 'navigate':
    case 'toggle_fullscreen':
      return true;
  }
}

export function generateRoomCode(): string {
  const bytes = new Uint8Array(ROOM_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let raw = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    raw += ROOM_ALPHABET[bytes[i] % ROOM_ALPHABET.length];
  }
  return formatRoomCode(raw);
}

export function normalizeRoomCode(input: string): string {
  const cleaned = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (cleaned.length !== ROOM_CODE_LENGTH) return cleaned;
  return formatRoomCode(cleaned);
}

export function isValidRoomCode(code: string): boolean {
  return /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(normalizeRoomCode(code));
}

export function roomCodeToPeerId(roomCode: string): string {
  const compact = normalizeRoomCode(roomCode).replace('-', '').toLowerCase();
  return `${PEER_ID_PREFIX}${compact}`;
}

export function generateDocumentId(): string {
  const bytes = new Uint8Array(DOC_ID_BYTE_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function parsePeerMessage(raw: unknown): PeerMessage | null {
  if (!isRecord(raw) || raw.v !== PROTOCOL_VERSION || typeof raw.type !== 'string') {
    return null;
  }

  switch (raw.type) {
    case 'DOC_META':
      return parseDocMeta(raw);
    case 'DOC_CHUNK':
      return parseDocChunk(raw);
    case 'DOC_END':
      return parseDocEnd(raw);
    case 'SYNC_PAGE':
      return parseSyncPage(raw);
    case 'NAVIGATE':
      return parseNavigate(raw);
    case 'SESSION_END':
      return parseSessionEnd(raw);
    case 'PEER_LEAVE':
      return { v: PROTOCOL_VERSION, type: 'PEER_LEAVE' };
    case 'PING':
    case 'PONG':
      return parseHeartbeat(raw, raw.type);
    default:
      return null;
  }
}

function formatRoomCode(raw: string): string {
  return `${raw.slice(0, ROOM_CODE_GROUP_SIZE)}-${raw.slice(ROOM_CODE_GROUP_SIZE)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isParticipantRole(value: unknown): value is ParticipantRole {
  return value === 'host' || value === 'co-presenter';
}

function parseDocMeta(raw: Record<string, unknown>): PeerMessage | null {
  if (
    typeof raw.docId !== 'string' ||
    typeof raw.fileName !== 'string' ||
    !isPositiveNumber(raw.byteLength) ||
    raw.byteLength > MAX_PDF_BYTES ||
    !isPositiveNumber(raw.totalChunks) ||
    !isPositiveNumber(raw.initialPage)
  ) {
    return null;
  }

  return {
    v: PROTOCOL_VERSION,
    type: 'DOC_META',
    docId: raw.docId,
    fileName: raw.fileName.slice(0, MAX_FILENAME_LENGTH),
    byteLength: raw.byteLength,
    totalChunks: Math.floor(raw.totalChunks),
    initialPage: Math.floor(raw.initialPage),
  };
}

function parseDocChunk(raw: Record<string, unknown>): PeerMessage | null {
  const isBinary = raw.data instanceof ArrayBuffer || raw.data instanceof Uint8Array;
  if (typeof raw.docId !== 'string' || !isNonNegativeNumber(raw.index) || !isBinary) {
    return null;
  }

  return {
    v: PROTOCOL_VERSION,
    type: 'DOC_CHUNK',
    docId: raw.docId,
    index: Math.floor(raw.index),
    data: raw.data as ArrayBuffer | Uint8Array,
  };
}

function parseDocEnd(raw: Record<string, unknown>): PeerMessage | null {
  if (typeof raw.docId !== 'string') return null;
  return { v: PROTOCOL_VERSION, type: 'DOC_END', docId: raw.docId };
}

function parseSyncPage(raw: Record<string, unknown>): PeerMessage | null {
  if (
    typeof raw.docId !== 'string' ||
    !isPositiveNumber(raw.page) ||
    !isNonNegativeNumber(raw.revision) ||
    !isParticipantRole(raw.by)
  ) {
    return null;
  }

  return {
    v: PROTOCOL_VERSION,
    type: 'SYNC_PAGE',
    docId: raw.docId,
    page: Math.floor(raw.page),
    revision: Math.floor(raw.revision),
    by: raw.by,
  };
}

function parseNavigate(raw: Record<string, unknown>): PeerMessage | null {
  if (typeof raw.docId !== 'string') return null;

  if (raw.action === 'next' || raw.action === 'prev') {
    return {
      v: PROTOCOL_VERSION,
      type: 'NAVIGATE',
      docId: raw.docId,
      action: raw.action,
    };
  }

  if (raw.action === 'goto' && isPositiveNumber(raw.page)) {
    return {
      v: PROTOCOL_VERSION,
      type: 'NAVIGATE',
      docId: raw.docId,
      action: 'goto',
      page: Math.floor(raw.page),
    };
  }

  return null;
}

function parseSessionEnd(raw: Record<string, unknown>): PeerMessage | null {
  if (raw.reason !== 'host_ended') return null;
  return { v: PROTOCOL_VERSION, type: 'SESSION_END', reason: 'host_ended' };
}

function parseHeartbeat(
  raw: Record<string, unknown>,
  type: 'PING' | 'PONG'
): PeerMessage | null {
  if (typeof raw.ts !== 'number' || !Number.isFinite(raw.ts)) return null;
  return { v: PROTOCOL_VERSION, type, ts: raw.ts };
}
