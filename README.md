# OpenClaw Chat

A personal chat application (PWA) for communicating with OpenClaw AI agents. Built as a Telegram replacement for the CEO.

## Features

- 🤖 **Agent List** — Browse and select from all OpenClaw agents
- 💬 **Chat Interface** — Telegram-style bubble UI with real-time streaming
- 📱 **PWA Support** — Install on mobile, full-screen standalone mode
- 🌙 **Dark Theme** — Sleek dark UI with blue accents
- 📱 **Responsive** — Mobile-first design, two-column on desktop
- 🔐 **Password Auth** — Simple password protection (Cloudflare Zero Trust ready)

## Tech Stack

- **Framework:** Next.js 16 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **API:** OpenClaw Gateway WebSocket Protocol v3
- **Deploy:** Coolify (Docker)

## Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

Copy `.env.example` to `.env.local` and fill in:

- `OPENCLAW_GATEWAY_URL` — WebSocket URL to OpenClaw Gateway
- `OPENCLAW_GATEWAY_TOKEN` — Gateway auth token
- `APP_PASSWORD` — Login password

## Deployment

Deployed via Coolify on `app.pomandi.com`.

```bash
npm run build
```

Uses `output: "standalone"` for Docker-optimized builds.

## Architecture

```
Browser ↔ Next.js API Routes ↔ OpenClaw Gateway (WS)
```

The Next.js server acts as a proxy, maintaining a persistent WebSocket connection to the OpenClaw Gateway. Browser clients communicate via REST API + SSE for real-time updates.
