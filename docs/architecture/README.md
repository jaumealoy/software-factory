# Runtime Architecture — MVP 1

## Purpose

This document describes the runtime architecture, project layout, configuration model, and
identity model of the Software Factory for MVP 1. It is the reference for how the pieces
fit together and where future MVP work is expected to land.

## Deployment topology

MVP 1 defines a **single deployable application boundary**:

```text
┌──────────────────────────────────────────────────────────┐
│                       one server                          │
│  ┌──────────────────────┐        ┌─────────────────────┐  │
│  │  Web dashboard       │        │  Factory API /      │  │
│  │  (React + Vite)      │───────▶│  Orchestrator       │  │
│  │  apps/web            │  HTTP  │  (Fastify)          │  │
│  └──────────────────────┘        │  apps/api           │  │
│       static assets               │        │            │  │
│       served at "/"    ◀──────────┘        ▼            │  │
│                                          SQLite         │  │
│                                   (Drizzle + better-sqlite3)│
└──────────────────────────────────────────────────────────┘
```

- The API server (`apps/api`) is the only long-running process. It exposes the `/api`
  surface and, in production, serves the built dashboard assets from `apps/web/dist` with
  SPA fallback for non-API `GET` routes.
- In development, Vite serves the dashboard on its own port and proxies `/api` to the API
  server at `localhost:8080`, so no CORS configuration is required.
- This keeps MVP 1 to one deployable while preserving a clean **API/UI boundary** for later
  MVPs that add worker processes and parallel execution.
- Multi-repository and multi-tenant support at agent execution time is out of scope for
  MVP 1.

## Repository layout

```text
software-factory/
├── apps/
│   ├── api/                  # Fastify API + orchestrator process (single deployable)
│   │   ├── src/
│   │   │   ├── app.ts        # Fastify application factory (testable)
│   │   │   ├── config.ts     # typed environment configuration
│   │   │   ├── db/           # Drizzle schema, client, migrations runner
│   │   │   ├── routes/       # Fastify route plugins (e.g. health)
│   │   │   └── scripts/      # operational scripts (e.g. migrate)
│   │   ├── drizzle/          # generated SQL migrations
│   │   └── test/             # unit/integration tests (Vitest)
│   └── web/                  # React + Vite dashboard
├── docs/architecture/        # architecture overview and ADRs
├── openspec/                 # OpenSpec specification layer for this repository
├── tsconfig.base.json        # shared TypeScript compiler options
├── eslint.config.mjs         # shared linting
└── package.json              # workspace scripts and quality commands
```

No shared `packages/` directory is introduced in MVP 1. Code shared across future
applications should be extracted into a `packages/` workspace once a second consumer
exists.

## Application boundaries

| Boundary              | Owner      | Path                   | Notes                                            |
| --------------------- | ---------- | ---------------------- | ------------------------------------------------ |
| Factory API           | `apps/api` | `/api/*`               | Fastify; JSON over HTTP; health at `/api/health` |
| Dashboard             | `apps/web` | `/`                    | React SPA; in dev proxied to the API             |
| API ↔ dashboard (dev) | `apps/web` | `/api` proxy → `:8080` | No CORS required                                 |

The only endpoint defined in MVP 1 is `GET /api/health`, which reports application and
database status. Feature behavior (request intake, task graph) is deliberately excluded
from this issue.

## Persistence strategy

- **SQLite** via `better-sqlite3`, accessed through **Drizzle ORM**.
- The default database file is `apps/api/data/factory.db` (gitignored).
- Schema is declared in `apps/api/src/db/schema.ts`; changes are generated with
  `drizzle-kit generate` and applied at process start via migrations in
  `apps/api/drizzle/`.
- WAL journal mode is enabled for file-backed databases; in-memory SQLite is used in tests.
- Future data model work (projects, changes, tasks, decisions) will extend this schema.

## Configuration model

Configuration is environment-driven and validated at process start with `zod`:

| Variable        | Default                    | Description                             |
| --------------- | -------------------------- | --------------------------------------- |
| `NODE_ENV`      | `development`              | `development` \| `test` \| `production` |
| `HOST`          | `0.0.0.0`                  | Bind address                            |
| `PORT`          | `8080`                     | API server port                         |
| `DATABASE_PATH` | `apps/api/data/factory.db` | SQLite file location                    |
| `LOG_LEVEL`     | `info`                     | Pino log level                          |

See `apps/api/.env.example`. A `.env` file is optional locally; defaults are suitable for a
fresh clone.

## Identity model

MVP 1 models **local developer identity only**. There is no account-management subsystem,
no authentication, and no multi-tenancy. Existing developer identity through GitHub and
local/runtime credentials is sufficient for this phase.

## Quality and development

Commands run from a fresh clone:

```bash
pnpm install
pnpm dev         # dashboard (:5173) + API (:8080), with watchers
pnpm test        # unit/integration tests across all workspaces
pnpm typecheck   # TypeScript type-checking across all workspaces
pnpm lint        # ESLint across the repository
pnpm build       # build API (dist) and dashboard (apps/web/dist)
pnpm db:generate # regenerate SQLite migrations from the schema
pnpm db:migrate  # apply pending migrations
```

The API returns `GET /api/health` with `{"status":"ok","database":"connected"}` when
running and migrations applied, which proves the application starts and the API/UI boundary
is reachable.

## Architecture decision records

- [ADR-0001: Monorepo and TypeScript toolchain](decisions/0001-monorepo-and-toolchain.md)
- [ADR-0002: Single deployable with API/UI boundary](decisions/0002-single-deployable.md)
- [ADR-0003: Local-first persistence with SQLite and Drizzle](decisions/0003-persistence.md)
- [ADR-0004: Dashboard UI with shadcn/ui](decisions/0004-dashboard-ui-framework.md)
