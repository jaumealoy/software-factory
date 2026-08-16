# ADR-0002 — Single deployable with API/UI boundary

## Status

Accepted

## Context

MVP 1 must ship a dashboard and an API/orchestrator. Small-team and low operational
overhead are explicit goals, so running many services is discouraged.

## Decision

One deployable: a Fastify server that serves the dashboard's built static files and the
`/api` surface. In development, Vite serves the dashboard and proxies `/api` to the API
server; there is no CORS configuration. Multi-repository and multi-tenant support are out
of scope for MVP 1.

## Consequences

- Dashboard and API live in the same repository and share one process at runtime.
- The API must expose a SPA-fallback handler so non-API `GET` routes serve
  `index.html` when the built dashboard is present.
- A later split into separate services remains possible because the API/UI boundary is
  HTTP-only.
