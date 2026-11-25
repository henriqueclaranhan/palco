/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SITE_URL?: string;
  readonly VITE_ICE_SERVERS?: string;
  readonly VITE_PEER_HOST?: string;
  readonly VITE_PEER_PORT?: string;
  readonly VITE_PEER_PATH?: string;
  readonly VITE_PEER_SECURE?: string;
  readonly VITE_PEER_ID_PREFIX?: string;
  readonly VITE_MAX_PDF_MB?: string;
  readonly VITE_GUEST_CONNECT_TIMEOUT_MS?: string;
  readonly VITE_MAX_RECONNECT_ATTEMPTS?: string;
  readonly VITE_RECONNECT_DELAY_MS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
