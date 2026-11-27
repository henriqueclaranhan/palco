import { describe, expect, it, vi } from 'vitest';
import { IceServerResolver } from '../iceServers';

const FALLBACK_STUN: RTCIceServer[] = [{ urls: 'stun:fallback.example:3478' }];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('IceServerResolver', () => {
  it('returns fallback servers immediately when endpoint is disabled', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const resolver = new IceServerResolver({
      endpoint: null,
      fallbackServers: FALLBACK_STUN,
      fetchImpl: fetchMock,
    });

    expect(await resolver.resolve()).toEqual(FALLBACK_STUN);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns STUN + TURN servers from /api/ice', async () => {
    const remoteServers: RTCIceServer[] = [
      { urls: 'stun:stun.cloudflare.com:3478' },
      {
        urls: ['turn:turn.cloudflare.com:3478?transport=udp'],
        username: 'u1',
        credential: 'c1',
      },
    ];
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ iceServers: remoteServers, provider: 'turn', ttl: 3600 })
      );

    const resolver = new IceServerResolver({
      endpoint: '/api/ice',
      fallbackServers: FALLBACK_STUN,
      fetchImpl: fetchMock,
    });

    expect(await resolver.resolve()).toEqual(remoteServers);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('prepends fallback STUN when endpoint returns only TURN servers', async () => {
    const turnOnly: RTCIceServer[] = [
      { urls: 'turn:relay.example:3478', username: 'u', credential: 'p' },
    ];
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ iceServers: turnOnly, ttl: 600 }));

    const resolver = new IceServerResolver({
      endpoint: '/api/ice',
      fallbackServers: FALLBACK_STUN,
      fetchImpl: fetchMock,
    });

    expect(await resolver.resolve()).toEqual([...FALLBACK_STUN, ...turnOnly]);
  });

  it('falls back to STUN on HTTP errors, HTML responses, or network failures', async () => {
    const notFound = new IceServerResolver({
      endpoint: '/api/ice',
      fallbackServers: FALLBACK_STUN,
      fetchImpl: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response('', { status: 404 })),
    });
    expect(await notFound.resolve()).toEqual(FALLBACK_STUN);

    const htmlResponse = new IceServerResolver({
      endpoint: '/api/ice',
      fallbackServers: FALLBACK_STUN,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
        new Response('<html></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        })
      ),
    });
    expect(await htmlResponse.resolve()).toEqual(FALLBACK_STUN);

    const networkError = new IceServerResolver({
      endpoint: '/api/ice',
      fallbackServers: FALLBACK_STUN,
      fetchImpl: vi.fn<typeof fetch>().mockRejectedValue(new Error('network down')),
    });
    expect(await networkError.resolve()).toEqual(FALLBACK_STUN);
  });

  it('caches credentials until TTL margin expires and deduplicates in-flight calls', async () => {
    let now = 1_000_000;
    const remoteServers: RTCIceServer[] = [
      { urls: 'stun:stun.cloudflare.com:3478' },
      { urls: 'turn:turn.cloudflare.com:3478', username: 'u1', credential: 'c1' },
    ];

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(() =>
        Promise.resolve(
          jsonResponse({ iceServers: remoteServers, provider: 'turn', ttl: 300 })
        )
      );

    const resolver = new IceServerResolver({
      endpoint: '/api/ice',
      fallbackServers: FALLBACK_STUN,
      fetchImpl: fetchMock,
      now: () => now,
    });

    const [first, second] = await Promise.all([resolver.resolve(), resolver.resolve()]);
    expect(first).toEqual(remoteServers);
    expect(second).toEqual(remoteServers);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const withinCacheWindowMs = 200_000;
    now += withinCacheWindowMs;
    await resolver.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const pastCacheWindowMs = 50_000;
    now += pastCacheWindowMs;
    await resolver.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
