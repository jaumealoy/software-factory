import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { api } from "../api";
import { useProject } from "./projectSwitcher";
import { messageOf } from "./domainViews";

export interface OpenTab {
  path: string;
  content: string;
  dirty: boolean;
}

interface EditorWorkspaceValue {
  tabs: OpenTab[];
  activePath: string | null;
  hasTabs: boolean;
  openFile: (path: string, content: string) => void;
  activate: (path: string) => void;
  closeFile: (path: string) => void;
  updateContent: (path: string, content: string) => void;
  saveActive: () => Promise<void>;
}

const EditorWorkspaceContext = createContext<EditorWorkspaceValue | null>(null);

function baseName(filePath: string): string {
  return filePath.split("/").pop() ?? filePath;
}

export function EditorWorkspaceProvider({ children }: { children: ReactNode }) {
  const { activeProjectId } = useProject();
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);

  const value = useMemo<EditorWorkspaceValue>(
    () => ({
      tabs,
      activePath,
      hasTabs: tabs.length > 0,
      openFile: (path, content) => {
        setTabs((prev) => {
          if (prev.some((tab) => tab.path === path)) {
            setActivePath(path);
            return prev;
          }
          return [...prev, { path, content, dirty: false }];
        });
        setActivePath(path);
      },
      activate: (path) => setActivePath(path),
      closeFile: (path) => {
        setTabs((prev) => {
          const next = prev.filter((tab) => tab.path !== path);
          setActivePath((current) =>
            current === path ? (next[next.length - 1]?.path ?? null) : current,
          );
          return next;
        });
      },
      updateContent: (path, content) => {
        setTabs((prev) =>
          prev.map((tab) => (tab.path === path ? { ...tab, content, dirty: true } : tab)),
        );
      },
      saveActive: async () => {
        const tab = tabs.find((candidate) => candidate.path === activePath);
        if (!tab || !activeProjectId) return;
        try {
          await api.saveFile(activeProjectId, tab.path, tab.content);
          setTabs((prev) =>
            prev.map((candidate) =>
              candidate.path === tab.path ? { ...candidate, dirty: false } : candidate,
            ),
          );
          toast.success(`Saved ${baseName(tab.path)}`);
        } catch (err) {
          toast.error(messageOf(err));
        }
      },
    }),
    [tabs, activePath, activeProjectId],
  );

  return (
    <EditorWorkspaceContext.Provider value={value}>{children}</EditorWorkspaceContext.Provider>
  );
}

export function useEditorWorkspace(): EditorWorkspaceValue {
  const value = useContext(EditorWorkspaceContext);
  if (!value) {
    throw new Error("useEditorWorkspace must be used within an EditorWorkspaceProvider");
  }
  return value;
}
