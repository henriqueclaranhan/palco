export interface IceServerEntry {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface IceResponseBody {
  iceServers: IceServerEntry[];
  provider: 'turn' | 'stun-only';
  ttl: number;
}

export interface TurnConfig {
  urls: string[];
  secret: string;
}

export type EnvRecord = Record<string, string | undefined>;

export const DEFAULT_STUN_SERVERS: IceServerEntry[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];
