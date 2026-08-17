import type { ReactNode } from "react";

export function PlaceholderPane({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div
      className="flex h-full flex-col overflow-hidden border-border"
      data-testid={`pane-${title.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div className="border-b border-border px-3 py-2 text-sm font-medium">{title}</div>
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center text-sm text-muted-foreground">
        {children ?? <p>Nothing here yet.</p>}
      </div>
    </div>
  );
}
