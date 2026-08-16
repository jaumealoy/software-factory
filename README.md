# Software Factory

An AI-native software factory for solo developers and small engineering teams: it takes a
feature request, then autonomously refines, specifies, analyzes, decomposes, tests,
implements, and verifies the resulting work — escalating genuine ambiguity and
consequential decisions to a human.

This repository is the **factory itself**. Issue #1 defines the full functional
specification; issues #2+ implement it in dependency-ordered MVP slices. The current
target is **MVP 1**: request → specification → task graph → GitHub issues, with a web
dashboard for visibility.

## Requirements

- Node.js >= 22
- pnpm 11

## Quickstart

```bash
pnpm install
pnpm dev
```

- Dashboard: <http://localhost:5173>
- API health check: <http://localhost:8080/api/health>

```bash
pnpm dev         # dashboard (:5173) + API (:8080), with watchers
pnpm test        # unit/integration tests across all workspaces
pnpm typecheck   # TypeScript type-checking across all workspaces
pnpm lint        # ESLint across the repository
pnpm build       # build API (dist) and dashboard (apps/web/dist)
pnpm db:generate # regenerate SQLite migrations from the schema
pnpm db:migrate  # apply pending migrations
```

## Repository layout

```text
apps/
  api/     Fastify API + orchestrator (single deployable), SQLite persistence
  web/     React + Vite dashboard
docs/architecture/   runtime architecture and ADRs
openspec/            OpenSpec specification layer
```

See [docs/architecture/README.md](docs/architecture/README.md) for the runtime
architecture, configuration model, and accepted ADRs.

## Configuration

The API reads configuration from the environment (see `apps/api/.env.example`). Copy it to
`apps/api/.env` to override defaults; the defaults work out of the box.
