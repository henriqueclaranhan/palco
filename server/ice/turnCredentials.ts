import {
  DEFAULT_STUN_SERVERS,
  type EnvRecord,
  type IceServerEntry,
  type TurnConfig,
} from './types';

const DEFAULT_TTL_SECONDS = 3600;
const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 86_400;

export function resolveTurnConfig(env: EnvRecord): TurnConfig | null {
  const urls = parseUrlList(env.TURN_URLS);
  const secret = env.TURN_AUTH_SECRET?.trim();
  if (urls.length === 0 || !secret) {
    return null;
  }
  return { urls, secret };
}

export function parseTtl(raw: string | undefined): number {
  if (!raw) return DEFAULT_TTL_SECONDS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_TTL_SECONDS;
  return Math.min(MAX_TTL_SECONDS, Math.max(MIN_TTL_SECONDS, parsed));
}

export async function generateTurnIceServers(
  config: TurnConfig,
  ttl: number,
  now: () => number = Date.now
): Promise<IceServerEntry[]> {
  const expiresAt = Math.floor(now() / 1000) + ttl;
  const username = `${expiresAt}:palco`;
  const credential = await signHmacSha1Base64(config.secret, username);

  return [...DEFAULT_STUN_SERVERS, { urls: config.urls, username, credential }];
}

async function signHmacSha1Base64(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return bytesToBase64(new Uint8Array(signature));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function parseUrlList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}
