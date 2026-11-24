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
src/
├── config/          # Environment variable parsing and validation
├── domain/          # Message protocol, binary chunker, file validation, session state
├── infrastructure/  # PeerJS (WebRTC), pdf.js (Web Worker + LRU cache), ephemeral reload store
├── application/     # Session, fullscreen, theme, keyboard/swipe, and toast hooks
└── ui/              # Pages, components, and styles
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

All configuration options (ICE servers, max PDF size, timeouts, and optional self-hosted PeerServer) are optional and documented in [.env.example](./.env.example). Copy it to `.env` if you want to override the defaults.
