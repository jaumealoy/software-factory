# MVP 2 Acceptance — Per-Task Model Selection and Autonomous Implementation

This document records the accepted MVP 2 vertical slice, its test harness, local setup,
and known constraints. It accompanies `apps/api/test/acceptance/mvp2.test.ts` and builds
on the MVP 1 slice (`docs/acceptance-mvp1.md`).

## Slice under test

```text
User picks a model per task (or project default)
  → tasks published to GitHub issues
  → runnableTasks selects READY, unblocked tasks in dependency order
  → runTaskWithResolvedModel (TDD → implementation → verification in an isolated worktree)
  → lifecycle + run results persisted (model recorded)
  → GitHub task issues refreshed; repeated failures escalate to a decision
```

## How to run

```bash
pnpm acceptance
```

Deterministic doubles stand in for the model worker and GitHub; real git worktrees and
migrations are exercised. (Real-Kilo smoke: run a `kilo`-backed task manually once `kilo
auth` is configured — the runner integrates `kilo run --model <provider/model>`.)

## The journey

1. **Model selection**: a task uses its own model, falling back to the project default,
   then the global default (`DEFAULT_TASK_MODEL`). Availability is validated against
   `kilo models`.
2. **Publish**: tasks are published as GitHub issues so results stay linked.
3. **Ordering**: `runnableTasks` only returns tasks that are READY with all dependencies
   DONE; execution follows the dependency DAG.
4. **Execution**: each task runs `tests-first` (a TEST_IMPLEMENTATION phase commits tests),
   then an IMPLEMENTATION phase, inside a `task/<change>-<id>` git worktree, with bounded
   rework on verification failures.
5. **Persistence**: each run records its events, the model used, and verification output as
   a run artifact; lifecycle transitions and completion are persisted.
6. **GitHub**: the linked task issue body is refreshed after a successful run.
7. **Escalation**: repeated verification failures (or worktree failures) raise an
   evidence-backed human decision; no silent scope expansion.

## Evidence produced

- Task status advanced to `DONE` and GitHub issue updated.
- Run artifacts (`run://tasks/<id>/result`) capturing status, model, tests created,
  changed files, verification command/output, and event types.
- Execution events (`task.run_*`, `task.execution_completed`) for dashboard inspection.
- Pending decisions on escalation (`WAITING_FOR_DECISION`).

## Local setup

1. `pnpm install && pnpm db:migrate && pnpm db:seed`
2. Configure the target product repository with an `openspec/config.yaml`.
3. For real model-backed execution: authenticate Kilo (`kilo auth`) and pick a model from
   `kilo models`. Without credentials the factory still runs fully offline with the
   deterministic runner/`RuleProvider`.

## Known constraints (MVP 2)

- Single repository, sequential (non-parallel) task execution.
- No automatic PR assembly or deployment yet.
- Run results are shown after the run completes; live event streaming is a follow-up.
- `kilo`-backed runs require the Kilo CLI and credentials on the host.
