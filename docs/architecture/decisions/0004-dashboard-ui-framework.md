# ADR-0004 — Dashboard UI with shadcn/ui

## Status

Accepted

## Context

MVP 1 shipped the dashboard with hand-rolled inline CSS in `App.tsx`. As the factory gains
more screens (intake, change list, change detail, task execution, run history) a
consistent, accessible, themeable component system is needed so screens share primitives,
status visualization, and toasts instead of duplicating styling.

## Decision

Adopt **shadcn/ui** on **Tailwind CSS v4** + **Radix (Base UI)** primitives in `apps/web`.
shadcn components are copied into the repo (`src/components/ui/`), so the codebase owns and
can customize them. Iconography is `lucide-react`; toasts use Sonner; theming uses CSS
variables with a light/dark token set and a `.dark` variant. A `cn()` helper
(`clsx` + `tailwind-merge`) is used for conditional classes.

## Alternatives considered

- **MUI (Material UI):** heavier theming, opinionated design language, larger runtime.
- **Ant Design:** rich but heavy and less aligned with a custom look.
- **Headless-only (Base UI direct):** full control but more boilerplate and less consistency.
- **Continue with inline CSS:** rejected as it does not scale to many screens.

shadcn/ui was chosen because it is copy-paste owned (no lock-in), accessible (Radix), and
typed/native React, matching the existing stack with minimal bundle impact.

## Consequences

- All dashboard screens must be built from the shared primitives; no new inline-CSS UI.
- Theming is driven by CSS variables; adding brand colors later is a token change.
- New primitives should be added via `npx shadcn@latest add <name>`, then customized in-repo.
- The web build now depends on Tailwind v4 and the shadcn theme CSS, processed by the
  `@tailwindcss/vite` plugin.
