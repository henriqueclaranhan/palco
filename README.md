# Palco

Real-time PDF co-presentation over WebRTC, with no login and no server-side file storage.

## How it works

The host opens a PDF locally and shares a temporary link (or QR code). The file streams directly from the host's browser to co-presenters over a WebRTC DataChannel in 64 KB chunks.

- The link only works while the room is open; ending the room or closing the tab revokes access.
- Reloading the page (F5) keeps the same link, document, and current page, and co-presenters reconnect automatically.
- Only the host can load or replace the PDF; both sides can step through pages, jump to any slide, and enter fullscreen.
- Fullscreen hides all chrome for clean screen sharing (navigate via keyboard, edge taps, or mobile swipe).

## Structure

```text
api/                     # Thin Vercel Serverless Function entrypoints
server/                  # Server-side handlers, credentials, guards, and tests
src/
├── config/              # Environment variable parsing and validation
├── domain/              # Message protocol, binary chunker, file validation, session state
├── infrastructure/      # PeerJS (WebRTC), ICE/TURN resolver, pdf.js (Web Worker + LRU cache), ephemeral reload store
├── application/         # Session, fullscreen, theme, keyboard/swipe, and toast hooks
└── ui/                  # Pages, components, and styles
```

## Development

```bash
pnpm install
pnpm dev
```

Checks and production build:

```bash
pnpm typecheck
pnpm test
pnpm format:check
pnpm build
```

## Environment variables

All configuration options (ICE servers, TURN credentials, max PDF size, timeouts, and optional self-hosted PeerServer) are optional and documented in [.env.example](./.env.example). Copy it to `.env` if you want to override the defaults.

### TURN support on Vercel (`/api/ice`)

By default, Palco uses public STUN servers, which work on most home networks. For restrictive corporate firewalls or 4G/5G symmetric NAT, configure a self-hosted TURN server (such as `coturn` with `use-auth-secret`) using server-side Environment Variables in Vercel:

- `TURN_URLS`: comma-separated TURN/TURNS URLs (e.g. `turn:turn.yourdomain.com:3478,turns:turn.yourdomain.com:5349`)
- `TURN_AUTH_SECRET`: shared secret used to sign temporary HMAC-SHA1 credentials

The `/api/ice` Vercel Function mints short-lived credentials without exposing the secret to the frontend, and the client automatically falls back to STUN if `/api/ice` is unavailable or unconfigured.
