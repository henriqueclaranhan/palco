import type { EnvRecord } from './types';

export function isOriginAllowed(request: Request, env: EnvRecord): boolean {
  const origin = request.headers.get('origin');
  if (origin) {
    return isListedOrigin(origin, env) || isSameOrigin(origin, request.url);
  }
  return request.headers.get('sec-fetch-site') !== 'cross-site';
}

function isListedOrigin(origin: string, env: EnvRecord): boolean {
  return (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((item) => item.trim())
    .includes(origin);
}

function isSameOrigin(origin: string, requestUrl: string): boolean {
  try {
    return origin === new URL(requestUrl).origin;
  } catch {
    return false;
  }
}
