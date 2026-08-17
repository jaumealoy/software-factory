import { useState } from "react";
import { Outlet } from "react-router-dom";
import { Group, Panel, Separator, type Layout } from "react-resizable-panels";
import { Toaster } from "./toast";
import { Sidebar } from "./components/sidebar";
import { FilePane } from "./components/filePane";
import { ChatPane } from "./components/chatPane";
import { EditorWorkspacePane } from "./components/editorWorkspacePane";
import { ProjectProvider } from "./projectSwitcher";
import { EditorWorkspaceProvider, useEditorWorkspace } from "./editorWorkspace";
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

function MainPane() {
  const { hasTabs } = useEditorWorkspace();
  if (hasTabs) {
    return <EditorWorkspacePane />;
  }
  return (
    <main className="h-full overflow-auto p-4 lg:p-6">
      <Outlet />
    </main>
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
        <EditorWorkspaceProvider>
          <Sidebar />
          <Group
            orientation="horizontal"
            id="factory-workspace"
            defaultLayout={layout}
            onLayoutChange={handleLayoutChange}
            className="flex-1"
          >
            <Panel id="files" defaultSize="18" minSize="10" collapsible className="min-w-0">
              <FilePane />
            </Panel>
            <SeparatorHandle id="files-separator" />
            <Panel id="main" defaultSize="62" minSize="30" className="min-w-0">
              <MainPane />
            </Panel>
            <SeparatorHandle id="main-separator" />
            <Panel id="chat" defaultSize="20" minSize="12" collapsible className="min-w-0">
              <ChatPane />
            </Panel>
          </Group>
        </EditorWorkspaceProvider>
      </ProjectProvider>
      <Toaster />
    </div>
  );
}
