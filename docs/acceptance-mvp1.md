# MVP 1 Acceptance — Request to GitHub Issues

This document records the accepted vertical slice for MVP 1, the test harness, known
constraints, and the evidence each flow produces. It accompanies
`apps/api/test/acceptance/mvp1.test.ts`.

## Slice under test

```text
Request (dashboard/API)
  → runWorkflow (refine, critique, [decision gate], OpenSpec, impact, decompose)
  → task DAG persisted
  → publishChangeIssues (GitHub adapter)
  → developer-readable, linked, idempotent task issues
```

The journey crosses the API, persistence, OpenSpec adapter (real `openspec` CLI), Code
Graph impact adapter (deterministic graph double in CI), and GitHub adapter (fake
executor in CI). Decision-gate flow: an ambiguous request pauses with a pending decision,
the decision is resolved, and `resumeWorkflow` completes the slice.

## Deterministic boundaries

The acceptance suite replaces the two external systems:

| Boundary                                    | Production path                                | Acceptance double                           |
| ------------------------------------------- | ---------------------------------------------- | ------------------------------------------- |
| Worker model (refine/critique/analyze/plan) | pluggable `WorkflowProvider` (e.g. LLM-backed) | `AcceptanceProvider` (deterministic)        |
| GitHub (`gh`)                               | `GitHubCliExecutor`                            | `RecordingIssueExecutor` (in-memory issues) |

The `openspec` CLI and SQLite (in-memory) are exercised for real in the suite.

## How to run

```bash
pnpm acceptance
```

Requires the `openspec` CLI on `PATH`; everything else is self-contained.

## Evidence produced by a completed run

- `changes` row with status `DECOMPOSING` and transition/event history.
- OpenSpec change directory on disk (`openspec/changes/<name>/`) with `proposal.md`,
  `design.md`, `tasks.md`, and `specs/<capability>/spec.md`, validated by
  `openspec validate <name>`.
- `impact_manifest` artifact containing affected modules, symbols, test suites,
  confidence, evidence, and an explicit fallback flag when the graph is unavailable.
- Capabilities and a persisted, acyclic task DAG (task dependencies).
- One GitHub issue per task, with Objective/Requirements/Scope/Inputs/Outputs/TDD/
  Verification/Dependencies/Factory metadata sections, parent-change link, capability
  label, and dependency issue references; issue numbers are stored on each task.
- Idempotent republishing: a second publish updates existing issues without creating
  duplicates.

## Local setup

1. `pnpm install`
2. `pnpm db:migrate && pnpm db:seed` (creates the demo project)
3. `pnpm dev` → dashboard at <http://localhost:5173>, API at <http://localhost:8080>
4. Configure the target product repository with an `openspec/config.yaml`.

The factory runs fully offline with the deterministic `RuleProvider` (no external
credentials). To use model-backed workers, plug a `WorkflowProvider` implementation
(define the adapter and supply credentials) — no orchestration changes are required.

## Known closures

- Single local repository per project; no multi-worktree or multi-repo execution yet.
- SQLite single-writer; later MVPs may move to a client-server database.
- PR creation, agent-driven implementation/verification, and deployment are outside
  MVP 1 (see issues #4–#7 and the MVP roadmap in #1).
