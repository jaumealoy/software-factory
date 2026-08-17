import { useState } from "react";
import { Outlet } from "react-router-dom";
import { Group, Panel, Separator, type Layout } from "react-resizable-panels";
import { Toaster } from "./toast";
import { Sidebar } from "./components/sidebar";
import { PlaceholderPane } from "./components/placeholder";
import { ProjectProvider } from "./projectSwitcher";
import { cn } from "../lib/utils";

const LAYOUT_KEY = "factory.workspaceLayout";

function loadLayout(): Layout | undefined {
  try {
    const stored = localStorage.getItem(LAYOUT_KEY);
    return stored ? (JSON.parse(stored) as Layout) : undefined;
  } catch {
    return undefined;
  }
}

function SeparatorHandle({ id }: { id: string }) {
  return (
    <Separator
      id={id}
      aria-label="Resize pane"
      className={cn(
        "w-px shrink-0 bg-border transition-colors hover:bg-accent",
        "data-[size-direction=backwards]:bg-accent",
      )}
    />
  );
}

export function AppShell() {
  const [layout, setLayout] = useState<Layout | undefined>(loadLayout);

  function handleLayoutChange(next: Layout) {
    setLayout(next);
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(next));
    } catch {
      // ignore storage failures
    }
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      <ProjectProvider>
        <Sidebar />
        <Group
          orientation="horizontal"
          id="factory-workspace"
          defaultLayout={layout}
          onLayoutChange={handleLayoutChange}
          className="flex-1"
        >
          <Panel id="files" defaultSize="18" minSize="10" collapsible className="min-w-0">
            <PlaceholderPane title="Project files">
              <p>
                Browse the repository here. The file tree and editor arrive with the Project files
                workspace.
              </p>
            </PlaceholderPane>
          </Panel>
          <SeparatorHandle id="files-separator" />
          <Panel id="main" defaultSize="62" minSize="30" className="min-w-0">
            <main className="h-full overflow-auto p-4 lg:p-6">
              <Outlet />
            </main>
          </Panel>
          <SeparatorHandle id="main-separator" />
          <Panel id="chat" defaultSize="20" minSize="12" collapsible className="min-w-0">
            <PlaceholderPane title="Agent chat">
              <p>Live agent transcript and chat will render here when a run is streaming.</p>
            </PlaceholderPane>
          </Panel>
        </Group>
      </ProjectProvider>
      <Toaster />
    </div>
  );
}
