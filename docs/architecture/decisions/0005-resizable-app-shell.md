# ADR-0005 — Resizable multi-pane app shell

## Status

Accepted

## Context

MVP 3 redesigns the dashboard around a persistent icon sidebar and a resizable, split-pane
workspace: a left pane (project files / product repo), a central content pane (routed
screens), and a right pane (live agent chat). Panes must be draggable and the layout must
persist across reloads.

## Decision

Use **react-resizable-panels** (v4 API: `Group` / `Panel` / `Separator`) in `apps/web` for
the pane layout, combined with a **lucide-react** icon sidebar and the existing shadcn/ui +
Tailwind v4 styling. The sidebar collapse state and the pane layout are persisted to
`localStorage`. Pane order/sizes are declared in `App.tsx`; pane content remains owned by
their respective screen components (file browser, chat, etc.).

## Alternatives considered

- **MUI / Ant Design splitter components:** heavier, and inconsistent with the lightweight
  custom look and existing shadcn stack.
- **Hand-rolled grid + drag handles:** more code to maintain (pointer math, constraints,
  resize hit-testing, persistence) with no real benefit.
- **CSS `resize` or flex-only:** cannot persist or enforce min/max sizes or collapse.

react-resizable-panels was chosen because it is a small, React-native, accessible (WAI-ARIA
separator role, keyboard resizing) library that provides min/max sizes, collapse, and
persisted layouts with minimal code, matching the existing functional, unstyled primitives
approach.

## Consequences

- `apps/web` now depends on `react-resizable-panels`.
- Active-project scoping (#27) and pane content (#25, #26, #31) mount into the placeholder
  panes defined here.
- The sidebar is the single navigation surface for routed screens (Requests, Changes, Runs,
  Configuration, Settings); the previous top-nav shell is removed.
