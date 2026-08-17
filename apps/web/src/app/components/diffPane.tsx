import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, File as FileIcon } from "lucide-react";
import { api, type DiffFile, type WorkingDiff } from "../../api";
import { cn } from "../../lib/utils";
import { Badge } from "../../components/ui/badge";

const STATUS_VARIANT: Record<string, "outline" | "secondary" | "destructive"> = {
  modified: "secondary",
  new: "outline",
  deleted: "destructive",
};

function DiffRow({ file }: { file: DiffFile }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-sm hover:bg-accent"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        )}
        <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate">{file.path}</span>
        <span className="ml-auto flex items-center gap-1">
          <Badge variant={STATUS_VARIANT[file.status]}>{file.status}</Badge>
        </span>
      </button>
      <div className="ml-4 text-xs text-muted-foreground">
        <span className="text-emerald-600">+{file.additions}</span>{" "}
        <span className="text-red-600">-{file.deletions}</span>
      </div>
      {open && (
        <div className="ml-4 mt-1 rounded border border-border">
          {file.hunks.map((hunk, i) => (
            <div key={i}>
              <div className="bg-muted px-2 py-0.5 font-mono text-xs">{hunk.header}</div>
              {hunk.lines.map((line, j) => (
                <div
                  key={j}
                  className={cn(
                    "px-2 py-0.5 font-mono text-xs",
                    line.type === "add" &&
                      "bg-emerald-100/60 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100",
                    line.type === "del" &&
                      "bg-red-100/60 text-red-900 dark:bg-red-950/40 dark:text-red-100",
                  )}
                >
                  {line.type === "add" ? "+" : line.type === "del" ? "-" : " "} {line.text}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function DiffPane({ projectId }: { projectId: string }) {
  const [diff, setDiff] = useState<WorkingDiff | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDiff(null);
    setError(null);
    api
      .getWorkingDiff(projectId)
      .then((res) => setDiff(res.diff))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load diff."));
  }, [projectId]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-border px-3 py-2 text-sm font-medium">Working changes</div>
      <div className="flex-1 overflow-auto p-1">
        {error && <p className="p-3 text-sm text-destructive">{error}</p>}
        {!error && !diff && <p className="p-3 text-sm text-muted-foreground">Loading…</p>}
        {diff?.empty && <p className="p-3 text-sm text-muted-foreground">Working tree is clean.</p>}
        {diff?.files.map((file) => (
          <DiffRow key={file.path} file={file} />
        ))}
      </div>
    </div>
  );
}
