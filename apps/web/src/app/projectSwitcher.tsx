import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type Project } from "../api";

const STORAGE_KEY = "factory.activeProjectId";

interface ProjectContextValue {
  projects: Project[];
  ready: boolean;
  activeProjectId: string | null;
  setActiveProjectId: (id: string | null) => void;
  activeFolderId: string | null;
  setActiveFolderId: (id: string | null) => void;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActive] = useState<string | null>(null);
  const [activeFolderId, setActiveFolder] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .listProjects()
      .then((list) => {
        if (cancelled) return;
        setProjects(list);
        let stored: string | null = null;
        try {
          stored = localStorage.getItem(STORAGE_KEY);
        } catch {
          // ignore storage failures
        }
        const exists = stored !== null && list.some((project) => project.id === stored);
        setActive(exists ? stored : (list[0]?.id ?? null));
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setActiveProjectId = useCallback((id: string | null) => {
    setActive(id);
    try {
      if (id) {
        localStorage.setItem(STORAGE_KEY, id);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // ignore storage failures
    }
  }, []);

  const setActiveFolderId = useCallback((id: string | null) => {
    setActiveFolder(id);
  }, []);

  return (
    <ProjectContext.Provider
      value={{
        projects,
        ready,
        activeProjectId,
        setActiveProjectId,
        activeFolderId,
        setActiveFolderId,
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject(): ProjectContextValue {
  const value = useContext(ProjectContext);
  if (!value) {
    throw new Error("useProject must be used within a ProjectProvider");
  }
  return value;
}
