# ADR-0006 — Embedded code editor: Monaco (not full VS Code web)

## Status

Accepted

## Context

The Project files workspace should let users open source in the main pane with tabs and see
**actual compilation errors** inline (the "VS Code-like" experience). We considered whether to
bundle the real VS Code web (code-server) or keep the in-process Monaco editor that #32
introduced.

## Decision

**Keep Monaco** (`@monaco-editor/react`, in-process) as the embedded editor and get real
diagnostics from Monaco's bundled language services (notably the TypeScript worker, which runs
the actual TS language service in the browser and produces the same semantic errors the
compiler would). Tabs are built on Monaco's multiple models, not an external tab system.

Rejected: running **code-server** (full VS Code in the browser) as a bundled/featured editor.

## Alternatives considered

- **code-server / VS Code for the Web:** full VS Code (extensions, terminal, every language's
  LSP). Rejected because it is a standalone application, not an embeddable component — it would
  need its own always-running Node service, port + auth + security management, and a hard to
  reconcile embedding in the resizable main pane alongside the factory's own UI. Bundle/runtime
  cost is large.
- **Monaco + external LSP (monaco-languageclient):** richer diagnostics for non-TS languages.
  Deferred; re-evaluate if we need language servers beyond TypeScript.
- **Plain textarea / hand-rolled editor:** insufficient for tabs, syntax highlighting, and
  diagnostics.

Monaco gives real TypeScript compilation errors client-side with no extra service, matches the
existing lightweight, functional stack, and supports the multi-model tabs we need.

## Consequences

- The main-pane editor is Monaco; tabs are multi-model; TS/JS diagnostics come from Monaco's TS
  worker (a Problems panel surfaces them).
- No separate code-server process or port/auth surface is introduced.
- If a non-TS language needs full LSP, revisit Monaco-languageclient (ADR update required).
