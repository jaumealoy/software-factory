# ADR-0006 — Embedded code editor: Monaco + LSP bridge (not full VS Code web)

## Status

Accepted (revised)

## Context

The Project files workspace should open files in the main pane with tabs and show **actual
compilation errors** inline — the "VS Code-like" experience — across the languages the factory
may build (TypeScript/JavaScript, C#, Dart, Rust), not just TS/JS.

The earlier version of this ADR chose Monaco's bundled TypeScript worker for diagnostics. That
is insufficient: it only covers TS/JS and gives no real diagnostics for C#, Dart, or Rust.

We also considered bundling the real VS Code web (code-server), which would provide full IDEs
(extensions, terminals, per-language LSP) out of the box.

## Decision

**Keep Monaco** (`@monaco-editor/react`, in-process) as the embedded editor, and power its
diagnostics with a **backend LSP bridge** using `monaco-languageclient`. The bridge hosts one
real language server per supported language for the active project folder and streams typed
diagnostics to Monaco over a JSON-RPC transport (WebSocket):

- TypeScript/JavaScript — TypeScript language server (`tsserver`)
- C# — Roslyn / OmniSharp
- Rust — `rust-analyzer`
- Dart — Dart analysis server

The language registry is extensible. For now, diagnostics (inline squiggles + a Problems
panel) are the priority; hover/completion can follow on the same transport.

## Alternatives considered

- **Bundled code-server / VS Code for the Web:** full VS Code with extensions, terminals, and
  every language's LSP. Rejected because it is a standalone application, not an embeddable
  component — it needs its own always-running service, port + auth + security management, and
  hard-to-reconcile embedding in the resizable main pane alongside the factory's own UI.
- **Monaco + backend toolchain check (`tsc` / `cargo check` / `dart analyze` / `dotnet build`):**
  lighter than LSP but gives diagnostics only on-demand after a check/build, not the streaming,
  incremental in-editor experience LSP provides.
- **Monaco + TS-only language service:** rejected — does not cover C#/Dart/Rust.

The LSP bridge keeps the lightweight in-app Monaco editor while delivering real, streaming
diagnostics for whatever language a project uses, at the cost of a backend server host and a
client transport.

## Consequences

- A backend **LSP host** manages per-language language-server processes and their lifecycle per
  project folder, and exposes diagnostics (JSON-RPC) to the browser.
- `monaco-languageclient` is added to the frontend; Monaco connects to the bridge for the active
  folder and renders diagnostics inline and in a Problems panel.
- No separate code-server process, port, or auth surface is introduced.
- Each new language needs a small adapter (language server + spawn/args) added to the registry.
