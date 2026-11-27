import { isSpectatorMode, type SpectatorMode } from '@/domain/protocol';

export interface SavedHostSession {
  roomCode: string;
  fileName: string;
  currentPage: number;
  spectatorMode?: SpectatorMode;
  coPresenterPassword?: string;
  bytes: Uint8Array;
}

interface StoredHostMeta {
  roomCode: string;
  fileName: string;
  currentPage: number;
  spectatorMode?: SpectatorMode;
  coPresenterPassword?: string;
  token: string;
}

const SESSION_META_KEY = 'palco:host-session';
const DB_NAME = 'palco-ephemeral-reload';
const STORE_NAME = 'pdf-blobs';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putBytes(token: string, bytes: Uint8Array): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(bytes, token);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function getBytes(token: string): Promise<Uint8Array | null> {
  const db = await openDb();
  try {
    return await new Promise<Uint8Array | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(token);
      req.onsuccess = () => {
        const result = req.result;
        if (result instanceof Uint8Array) resolve(result);
        else if (result instanceof ArrayBuffer) resolve(new Uint8Array(result));
        else resolve(null);
      };
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function deleteAllBytes(): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

function readMeta(): StoredHostMeta | null {
  try {
    const raw = sessionStorage.getItem(SESSION_META_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredHostMeta>;
    if (
      typeof parsed.roomCode === 'string' &&
      typeof parsed.fileName === 'string' &&
      typeof parsed.currentPage === 'number' &&
      typeof parsed.token === 'string'
    ) {
      return parsed as StoredHostMeta;
    }
    return null;
  } catch {
    return null;
  }
}

function writeMeta(meta: StoredHostMeta): void {
  try {
    sessionStorage.setItem(SESSION_META_KEY, JSON.stringify(meta));
  } catch {
    // storage can be blocked in private mode
  }
}

export function isHostTabForRoom(roomCode: string): boolean {
  const meta = readMeta();
  return meta !== null && meta.roomCode === roomCode;
}

export async function saveHostReloadState(
  roomCode: string,
  fileName: string,
  currentPage: number,
  bytes: Uint8Array,
  coPresenterPassword?: string
): Promise<void> {
  const existing = readMeta();
  const token =
    existing?.roomCode === roomCode
      ? existing.token
      : `${roomCode}-${Date.now().toString(36)}`;

  const spectatorMode =
    existing?.roomCode === roomCode && isSpectatorMode(existing.spectatorMode)
      ? existing.spectatorMode
      : 'follow';

  const resolvedPassword =
    coPresenterPassword ??
    (existing?.roomCode === roomCode ? existing.coPresenterPassword : undefined);

  writeMeta({
    roomCode,
    fileName,
    currentPage,
    spectatorMode,
    coPresenterPassword: resolvedPassword,
    token,
  });

  try {
    await putBytes(token, bytes);
  } catch {
    // skip caching if IndexedDB is unavailable
  }
}

export function updateHostReloadPage(roomCode: string, currentPage: number): void {
  const existing = readMeta();
  if (!existing || existing.roomCode !== roomCode) return;
  writeMeta({ ...existing, currentPage });
}

export function updateHostReloadSpectatorMode(
  roomCode: string,
  spectatorMode: SpectatorMode
): void {
  const existing = readMeta();
  if (!existing || existing.roomCode !== roomCode) return;
  writeMeta({ ...existing, spectatorMode });
}

export function updateHostReloadPassword(
  roomCode: string,
  coPresenterPassword: string
): void {
  const existing = readMeta();
  if (!existing || existing.roomCode !== roomCode) return;
  writeMeta({ ...existing, coPresenterPassword });
}

export async function loadHostReloadState(
  roomCode: string
): Promise<SavedHostSession | null> {
  const meta = readMeta();
  if (!meta || meta.roomCode !== roomCode) return null;

  try {
    const bytes = await getBytes(meta.token);
    if (!bytes) return null;
    return {
      roomCode: meta.roomCode,
      fileName: meta.fileName,
      currentPage: meta.currentPage,
      spectatorMode: isSpectatorMode(meta.spectatorMode)
        ? meta.spectatorMode
        : 'follow',
      coPresenterPassword:
        typeof meta.coPresenterPassword === 'string' &&
        meta.coPresenterPassword.length > 0
          ? meta.coPresenterPassword
          : undefined,
      bytes,
    };
  } catch {
    return null;
  }
}

export function clearHostReloadState(): void {
  try {
    sessionStorage.removeItem(SESSION_META_KEY);
  } catch {
    // storage unavailable
  }
  void deleteAllBytes().catch(() => undefined);
}
