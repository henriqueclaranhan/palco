const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

const DEFAULT_PEER_ID_PREFIX = 'palco-v1-';
const DEFAULT_ICE_ENDPOINT = '/api/ice';
const DEFAULT_ICE_FETCH_TIMEOUT_MS = 4000;
const DEFAULT_MAX_PDF_MB = 100;
const DEFAULT_GUEST_CONNECT_TIMEOUT_MS = 14_000;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 4;
const DEFAULT_RECONNECT_DELAY_MS = 1800;

export function parseIceEndpoint(raw: string | undefined): string | null {
  if (raw === undefined) return DEFAULT_ICE_ENDPOINT;
  const trimmed = raw.trim();
  if (!trimmed) return DEFAULT_ICE_ENDPOINT;
  if (/^(false|off|none|0)$/i.test(trimmed)) return null;
  return trimmed;
}

export function parseIceServers(raw: string | undefined): RTCIceServer[] {
  const trimmed = raw?.trim();
  if (!trimmed) return DEFAULT_ICE_SERVERS;

  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        const valid = parsed.filter(isValidIceServer);
        if (valid.length > 0) return valid;
      }
    } catch {
      return DEFAULT_ICE_SERVERS;
    }
    return DEFAULT_ICE_SERVERS;
  }

  const urls = trimmed
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return urls.length > 0 ? urls.map((url) => ({ urls: url })) : DEFAULT_ICE_SERVERS;
}

export function isValidIceServer(value: unknown): value is RTCIceServer {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.urls === 'string' && candidate.urls.trim().length > 0) {
    return true;
  }
  return (
    Array.isArray(candidate.urls) &&
    candidate.urls.length > 0 &&
    candidate.urls.every((u) => typeof u === 'string' && u.trim().length > 0)
  );
}

export function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseOptionalPort(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseOptionalBoolean(raw: string | undefined): boolean | undefined {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return undefined;
}

const maxPdfMb = parsePositiveInt(import.meta.env.VITE_MAX_PDF_MB, DEFAULT_MAX_PDF_MB);

export const env = {
  iceEndpoint: parseIceEndpoint(import.meta.env.VITE_ICE_ENDPOINT),
  iceFetchTimeoutMs: parsePositiveInt(
    import.meta.env.VITE_ICE_FETCH_TIMEOUT_MS,
    DEFAULT_ICE_FETCH_TIMEOUT_MS
  ),
  iceServers: parseIceServers(import.meta.env.VITE_ICE_SERVERS),
  peerHost: import.meta.env.VITE_PEER_HOST?.trim() || undefined,
  peerPort: parseOptionalPort(import.meta.env.VITE_PEER_PORT),
  peerPath: import.meta.env.VITE_PEER_PATH?.trim() || undefined,
  peerSecure: parseOptionalBoolean(import.meta.env.VITE_PEER_SECURE),
  peerIdPrefix: import.meta.env.VITE_PEER_ID_PREFIX?.trim() || DEFAULT_PEER_ID_PREFIX,
  maxPdfMb,
  maxPdfBytes: maxPdfMb * 1024 * 1024,
  guestConnectTimeoutMs: parsePositiveInt(
    import.meta.env.VITE_GUEST_CONNECT_TIMEOUT_MS,
    DEFAULT_GUEST_CONNECT_TIMEOUT_MS
  ),
  maxReconnectAttempts: parsePositiveInt(
    import.meta.env.VITE_MAX_RECONNECT_ATTEMPTS,
    DEFAULT_MAX_RECONNECT_ATTEMPTS
  ),
  reconnectDelayMs: parsePositiveInt(
    import.meta.env.VITE_RECONNECT_DELAY_MS,
    DEFAULT_RECONNECT_DELAY_MS
  ),
} as const;
