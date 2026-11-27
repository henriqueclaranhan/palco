import { isOriginAllowed } from './originGuard';
import { generateTurnIceServers, parseTtl, resolveTurnConfig } from './turnCredentials';
import { DEFAULT_STUN_SERVERS, type EnvRecord, type IceResponseBody } from './types';

export async function handleIceRequest(
  request: Request,
  env: EnvRecord = readEnv(),
  now: () => number = Date.now
): Promise<Response> {
  if (!isOriginAllowed(request, env)) {
    return jsonResponse({ error: 'Forbidden origin' }, 403);
  }

  const turnConfig = resolveTurnConfig(env);
  if (!turnConfig) {
    return jsonResponse(buildStunOnlyBody(), 200);
  }

  const ttl = parseTtl(env.TURN_CREDENTIAL_TTL_SECONDS);
  const iceServers = await generateTurnIceServers(turnConfig, ttl, now);
  const body: IceResponseBody = { iceServers, provider: 'turn', ttl };
  return jsonResponse(body, 200);
}

function buildStunOnlyBody(): IceResponseBody {
  return {
    iceServers: DEFAULT_STUN_SERVERS,
    provider: 'stun-only',
    ttl: 0,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
    },
  });
}

function readEnv(): EnvRecord {
  const proc = (globalThis as { process?: { env?: EnvRecord } }).process;
  return proc?.env ?? {};
}
