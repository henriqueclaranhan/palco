import { describe, expect, it } from 'vitest';
import { handleIceRequest } from '../handleIceRequest';

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('https://palco.example.com/api/ice', {
    method: 'GET',
    headers,
  });
}

describe('/api/ice handler', () => {
  it('returns STUN-only fallback with no-store header when TURN is not configured', async () => {
    const response = await handleIceRequest(makeRequest(), {});

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');

    const body = (await response.json()) as {
      provider: string;
      ttl: number;
      iceServers: RTCIceServer[];
    };
    expect(body.provider).toBe('stun-only');
    expect(body.ttl).toBe(0);
    expect(body.iceServers.length).toBeGreaterThan(0);
  });

  it('mints ephemeral HMAC-SHA1 credentials for self-hosted TURN', async () => {
    const fixedNowMs = 1_700_000_000_000;

    const response = await handleIceRequest(
      makeRequest({ origin: 'https://palco.example.com' }),
      {
        TURN_URLS: 'turn:turn.example.com:3478, turns:turn.example.com:5349',
        TURN_AUTH_SECRET: 'shared-secret',
        TURN_CREDENTIAL_TTL_SECONDS: '600',
      },
      () => fixedNowMs
    );

    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      provider: string;
      ttl: number;
      iceServers: RTCIceServer[];
    };
    expect(body.provider).toBe('turn');
    expect(body.ttl).toBe(600);

    const turnEntry = body.iceServers.find((s) => s.username !== undefined);
    expect(turnEntry?.urls).toEqual([
      'turn:turn.example.com:3478',
      'turns:turn.example.com:5349',
    ]);
    expect(turnEntry?.username).toBe('1700000600:palco');
    expect(turnEntry?.credential).toMatch(/^[A-Za-z0-9+/]{27}=$/);
  });

  it('clamps TURN credential TTL within allowed bounds', async () => {
    const fixedNowMs = 1_700_000_000_000;

    const lowRes = await handleIceRequest(
      makeRequest(),
      {
        TURN_URLS: 'turn:turn.example.com:3478',
        TURN_AUTH_SECRET: 'shared-secret',
        TURN_CREDENTIAL_TTL_SECONDS: '10',
      },
      () => fixedNowMs
    );
    expect(((await lowRes.json()) as { ttl: number }).ttl).toBe(60);

    const highRes = await handleIceRequest(
      makeRequest(),
      {
        TURN_URLS: 'turn:turn.example.com:3478',
        TURN_AUTH_SECRET: 'shared-secret',
        TURN_CREDENTIAL_TTL_SECONDS: '999999',
      },
      () => fixedNowMs
    );
    expect(((await highRes.json()) as { ttl: number }).ttl).toBe(86_400);
  });

  it('rejects cross-origin requests unless explicitly allowlisted', async () => {
    const denied = await handleIceRequest(
      makeRequest({ origin: 'https://evil.example.com' }),
      {}
    );
    expect(denied.status).toBe(403);

    const crossSite = await handleIceRequest(
      makeRequest({ 'sec-fetch-site': 'cross-site' }),
      {}
    );
    expect(crossSite.status).toBe(403);

    const allowed = await handleIceRequest(
      makeRequest({ origin: 'https://preview.example.com' }),
      { ALLOWED_ORIGINS: 'https://preview.example.com' }
    );
    expect(allowed.status).toBe(200);
  });
});
