# ADR-0001 — Monorepo and TypeScript toolchain

## Status

Accepted

## Context

The factory is a multi-application system (dashboard, API/orchestrator, and later agent
workers) intended for a small team. The repository is initially empty, so the foundation
should make adding applications and shared code easy.

## Decision

Use a pnpm workspace with `apps/api` and `apps/web` under a shared TypeScript
configuration. TypeScript is the runtime language across the repository. Vitest is the test
runner. ESLint 9 (flat config) and Prettier handle linting/formatting. Commands are
normalized through workspace scripts at the repository root.

## Rationale

One language and one tool per concern reduces context switching, allows typing to flow
between applications, and keeps the quality toolchain consistent.

## Consequences

- Workspace-private packages must follow the `@software-factory/*` naming convention.
- A shared `packages/` workspace appears only when a second consumer of shared code exists.
