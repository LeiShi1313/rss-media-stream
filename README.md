# RSS Media Stream

Local self-hosted dashboard for private RSS media feeds, TMDB enrichment, subscription rules, and qBittorrent/Transmission dispatch.

## Monorepo Layout

- `apps/web`: React dashboard, Fastify API, worker, Prisma schema, and app tests.
- `packages/shared`: RSS title parsing, passkey redaction, shared types, and subscription rule evaluation.

## Run Locally

1. Copy `.env.example` to `.env` and fill `APP_SECRET`, `JWT_SECRET`, and optionally `TMDB_API_KEY`.
2. Start Postgres with Docker Compose or provide your own `DATABASE_URL`.
3. Install and prepare the app:

```bash
npm install
npm run prisma:generate
npm run prisma:push
npm run dev
```

The dashboard runs at `http://localhost:5173`; the API runs at `http://localhost:4000`.

## Docker

```bash
cp .env.example .env
docker compose up --build
```

The dashboard and API are both served through `nginxproxy/nginx-proxy` on
`http://localhost:8090` by default. Compose runs Vite, the Fastify API, the
worker, Postgres, and a one-shot setup task inside containers. The proxy routes
`/` to the frontend dev server and `/api` plus `/events` to the API dev server.
Override the host port with `APP_PORT=80 docker compose up --build`.

## Workspace Commands

```bash
npm run build
npm test
npm run dev
npm run worker
```

## Safety Defaults

- RSS URLs, torrent download URLs, and downloader passwords are encrypted at rest.
- Passkeys and tokens are redacted from API previews and logs.
- Series auto-downloads require strict season and episode parsing.
- TMDB is the first metadata provider; Douban and direct IMDb adapters can be added behind the same media search/match interface.
