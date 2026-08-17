import Editor from "@monaco-editor/react";
import { X } from "lucide-react";
import { useEditorWorkspace } from "../editorWorkspace";
import { Button } from "../../components/ui/button";

function languageFor(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    json: "json",
    yml: "yaml",
    yaml: "yaml",
    md: "markdown",
    css: "css",
    html: "html",
    py: "python",
    go: "go",
    rs: "rust",
    cs: "csharp",
    dart: "dart",
  };
  return map[ext] ?? "plaintext";
}

function baseName(filePath: string): string {
  return filePath.split("/").pop() ?? filePath;
}

export function EditorWorkspacePane() {
  const { tabs, activePath, activate, closeFile, updateContent, saveActive } = useEditorWorkspace();
  const active = tabs.find((tab) => tab.path === activePath);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center border-b border-border bg-muted/30">
        <div className="flex flex-1 items-center overflow-x-auto" role="tablist">
          {tabs.map((tab) => (
            <div
              key={tab.path}
              role="tab"
              aria-selected={tab.path === activePath}
              className={`group flex max-w-[12rem] shrink-0 items-center gap-1 border-r border-border px-3 py-2 text-sm ${
                tab.path === activePath
                  ? "bg-background"
                  : "text-muted-foreground hover:bg-accent/40"
              }`}
            >
              <button
                type="button"
                className="truncate"
                onClick={() => activate(tab.path)}
                title={tab.path}
              >
                {baseName(tab.path)}
              </button>
              {tab.dirty && (
                <span className="text-amber-500" aria-label="unsaved">
                  ●
                </span>
              )}
              <button
                type="button"
                aria-label={`Close ${baseName(tab.path)}`}
                className="text-muted-foreground hover:text-foreground"
                onClick={() => closeFile(tab.path)}
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="ml-2 mr-2"
          onClick={() => void saveActive()}
          disabled={!active?.dirty}
        >
          Save
        </Button>
      </div>
      {active ? (
        <div className="flex-1 overflow-hidden">
          <Editor
            key={active.path}
            height="100%"
            language={languageFor(active.path)}
            value={active.content}
            onChange={(next) => updateContent(active.path, next ?? "")}
            options={{ minimap: { enabled: false }, fontSize: 13, tabSize: 2 }}
          />
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          No file open. Select a file from the project tree.
        </div>
      )}
    </div>
  );
}
