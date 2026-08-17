import { useEffect, useState } from "react";
import { ChevronRight, File as FileIcon, Folder, FolderOpen, Loader2 } from "lucide-react";
import { api, type DirectoryListing, type FileEntry, type FileContent } from "../../api";
import { cn } from "../../lib/utils";
import { useProject } from "../projectSwitcher";
import { DiffPane } from "./diffPane";

function TreeRow({
  depth,
  entry,
  expanded,
  onToggle,
  selected,
  onSelect,
}: {
  depth: number;
  entry: FileEntry;
  expanded: boolean;
  onToggle: () => void;
  selected: boolean;
  onSelect: () => void;
}) {
  const isDir = entry.type === "dir";
  return (
    <button
      type="button"
      onClick={isDir ? onToggle : onSelect}
      className={cn(
        "flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-sm hover:bg-accent",
        selected && "bg-accent text-accent-foreground",
      )}
      style={{ paddingLeft: `${(depth + 1) * 0.75}rem` }}
      aria-expanded={isDir ? expanded : undefined}
    >
      {isDir ? (
        <>
          <ChevronRight
            className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground", expanded && "rotate-90")}
            aria-hidden
          />
          {expanded ? (
            <FolderOpen className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          ) : (
            <Folder className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          )}
        </>
      ) : (
        <span className="w-3.5 shrink-0" />
      )}
      <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="truncate">{entry.name}</span>
    </button>
  );
}

export function FilePane() {
  const { ready, activeProjectId } = useProject();
  const [view, setView] = useState<"tree" | "diff">("tree");
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [children, setChildren] = useState<Record<string, FileEntry[]>>({});
  const [loadingPath, setLoadingPath] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<FileContent | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    setListing(null);
    setChildren({});
    setSelected(null);
    setPreview(null);
    setPreviewError(null);
    if (!activeProjectId) return;
    api
      .listFiles(activeProjectId)
      .then(setListing)
      .catch(() => setPreviewError("Failed to load the project files."));
  }, [activeProjectId]);

  async function toggleDir(path: string) {
    if (!activeProjectId) return;
    const current = new Set(expanded);
    const willExpand = !current.has(path);
    if (willExpand) {
      current.add(path);
      setLoadingPath(path);
      try {
        const dir = await api.listFiles(activeProjectId, path);
        setChildren((prev) => ({ ...prev, [path]: dir.entries }));
      } catch {
        setPreviewError("Failed to load this folder.");
      } finally {
        setLoadingPath(null);
      }
    } else {
      current.delete(path);
    }
    setExpanded(current);
  }

  async function openFile(path: string) {
    if (!activeProjectId) return;
    setSelected(path);
    setPreview(null);
    setPreviewError(null);
    try {
      setPreview(await api.readFileContent(activeProjectId, path));
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Failed to read file.");
    }
  }

  if (!ready || !activeProjectId) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="border-b border-border px-3 py-2 text-sm font-medium">Project files</div>
        <div className="flex-1 p-3 text-sm text-muted-foreground">
          {!ready ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            "Select a project to browse files."
          )}
        </div>
      </div>
    );
  }

  const rootEntries: FileEntry[] = listing?.entries ?? [];

  function renderEntries(entries: FileEntry[], depth: number): React.ReactNode {
    return entries.map((entry) => {
      const isDir = entry.type === "dir";
      const isExpanded = isDir && expanded.has(entry.path);
      const kids = isExpanded ? children[entry.path] : undefined;
      return (
        <div key={entry.path}>
          <TreeRow
            depth={depth}
            entry={entry}
            expanded={isExpanded}
            onToggle={() => void toggleDir(entry.path)}
            selected={selected === entry.path}
            onSelect={() => void openFile(entry.path)}
          />
          {isExpanded && kids && renderEntries(kids, depth + 1)}
        </div>
      );
    });
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center border-b border-border px-2 py-1">
        <span className="flex-1 px-1 text-sm font-medium">Project files</span>
        <button
          type="button"
          onClick={() => setView("tree")}
          className={cn(
            "rounded px-2 py-0.5 text-xs hover:bg-accent",
            view === "tree" && "bg-accent",
          )}
        >
          Files
        </button>
        <button
          type="button"
          onClick={() => setView("diff")}
          className={cn(
            "rounded px-2 py-0.5 text-xs hover:bg-accent",
            view === "diff" && "bg-accent",
          )}
        >
          Changes
        </button>
      </div>
      {view === "diff" && activeProjectId ? (
        <DiffPane projectId={activeProjectId} />
      ) : (
        <>
          <div className="flex-1 overflow-auto p-1">
            {!listing?.exists && !previewError ? (
              <p className="p-3 text-sm text-muted-foreground">
                {listing?.message ?? "No files to show."}
              </p>
            ) : (
              renderEntries(rootEntries, 0)
            )}
            {previewError && <p className="p-3 text-sm text-destructive">{previewError}</p>}
          </div>
          {preview && (
            <div className="border-t border-border">
              <div className="truncate px-3 py-1.5 text-xs text-muted-foreground">
                {preview.path}
              </div>
              <pre className="max-h-40 overflow-auto p-3 text-xs">{preview.content}</pre>
            </div>
          )}
          {loadingPath && (
            <div className="p-2 text-xs text-muted-foreground">
              <Loader2 className="mr-1 inline h-3 w-3 animate-spin" aria-hidden />
              Loading…
            </div>
          )}
        </>
      )}
    </div>
  );
}
