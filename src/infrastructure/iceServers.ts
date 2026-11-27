import { env, isValidIceServer } from '@/config/env';

const STUN_ONLY_CACHE_MS = 60_000;
const TURN_REFRESH_MARGIN_SECONDS = 60;

export interface IceServerResolverOptions {
  endpoint?: string | null;
  fallbackServers?: RTCIceServer[];
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

interface CachedIceEntry {
  iceServers: RTCIceServer[];
  expiresAt: number;
}

interface RemoteIceResult {
  iceServers: RTCIceServer[];
  cacheDurationMs: number;
}

export class IceServerResolver {
  private readonly endpoint: string | null;
  private readonly fallbackServers: RTCIceServer[];
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly now: () => number;

  private cached: CachedIceEntry | null = null;
  private inFlight: Promise<RTCIceServer[]> | null = null;

  constructor(options: IceServerResolverOptions = {}) {
    this.endpoint = options.endpoint !== undefined ? options.endpoint : env.iceEndpoint;
    this.fallbackServers = options.fallbackServers ?? env.iceServers;
    this.timeoutMs = options.timeoutMs ?? env.iceFetchTimeoutMs;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
  }

  async resolve(signal?: AbortSignal): Promise<RTCIceServer[]> {
    if (!this.endpoint || typeof this.fetchImpl !== 'function' || signal?.aborted) {
      return this.fallbackServers;
    }

    const freshCached = this.readValidCache();
    if (freshCached) {
      return freshCached;
    }

    const promise = this.getOrStartFetch();
    return signal ? raceWithAbort(promise, signal, this.fallbackServers) : promise;
  }

  clearCache(): void {
    this.cached = null;
    this.inFlight = null;
  }

  private readValidCache(): RTCIceServer[] | null {
    if (!this.cached) return null;
    if (this.now() < this.cached.expiresAt) {
      return this.cached.iceServers;
    }
    this.cached = null;
    return null;
  }

  private getOrStartFetch(): Promise<RTCIceServer[]> {
    if (this.inFlight) return this.inFlight;

    const request = this.fetchAndCache().finally(() => {
      if (this.inFlight === request) {
        this.inFlight = null;
      }
    });
    this.inFlight = request;
    return request;
  }

  private async fetchAndCache(): Promise<RTCIceServer[]> {
    const result = await fetchRemoteIceServers({
      endpoint: this.endpoint!,
      timeoutMs: this.timeoutMs,
      fetchImpl: this.fetchImpl!,
    });

    if (!result) {
      return this.fallbackServers;
    }

    const servers = ensureStunPresent(result.iceServers, this.fallbackServers);
    if (result.cacheDurationMs > 0) {
      this.cached = {
        iceServers: servers,
        expiresAt: this.now() + result.cacheDurationMs,
      };
    }
    return servers;
  }
}

const defaultResolver = new IceServerResolver();

export function resolveIceServers(signal?: AbortSignal): Promise<RTCIceServer[]> {
  return defaultResolver.resolve(signal);
}

export function clearIceServerCache(): void {
  defaultResolver.clearCache();
}

async function fetchRemoteIceServers(params: {
  endpoint: string;
  timeoutMs: number;
  fetchImpl: typeof fetch;
}): Promise<RemoteIceResult | null> {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), params.timeoutMs);

  try {
    const response = await params.fetchImpl(params.endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    });

    if (!response.ok || !isJsonResponse(response)) {
      return null;
    }

    return extractIcePayload(await response.json());
  } catch {
    return null;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

function isJsonResponse(response: Response): boolean {
  const contentType = response.headers.get('content-type') ?? '';
  return contentType.toLowerCase().includes('application/json');
}

function extractIcePayload(payload: unknown): RemoteIceResult | null {
  if (Array.isArray(payload)) {
    const valid = payload.filter(isValidIceServer);
    return valid.length > 0 ? { iceServers: valid, cacheDurationMs: 0 } : null;
  }

  if (typeof payload !== 'object' || payload === null) {
    return null;
  }

  const record = payload as Record<string, unknown>;
  if (!Array.isArray(record.iceServers)) {
    return null;
  }

  const valid = record.iceServers.filter(isValidIceServer);
  if (valid.length === 0) {
    return null;
  }

  const ttlSeconds =
    typeof record.ttl === 'number' && Number.isFinite(record.ttl) && record.ttl > 0
      ? record.ttl
      : 0;
  const provider = typeof record.provider === 'string' ? record.provider : undefined;

  return {
    iceServers: valid,
    cacheDurationMs: computeCacheDurationMs(ttlSeconds, provider),
  };
}

function computeCacheDurationMs(ttlSeconds: number, provider?: string): number {
  if (provider === 'stun-only') {
    return STUN_ONLY_CACHE_MS;
  }
  if (ttlSeconds > TURN_REFRESH_MARGIN_SECONDS) {
    return (ttlSeconds - TURN_REFRESH_MARGIN_SECONDS) * 1000;
  }
  return 0;
}

function ensureStunPresent(
  servers: RTCIceServer[],
  fallbackServers: RTCIceServer[]
): RTCIceServer[] {
  const hasStun = servers.some((server) => {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    return urls.some((url) => url.toLowerCase().startsWith('stun:'));
  });
  return hasStun ? servers : [...fallbackServers, ...servers];
}

function raceWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  fallbackValue: T
): Promise<T> {
  return new Promise<T>((resolve) => {
    const onAbort = () => resolve(fallbackValue);
    signal.addEventListener('abort', onAbort, { once: true });
    void promise.then((value) => {
      signal.removeEventListener('abort', onAbort);
      resolve(value);
    });
  });
}
