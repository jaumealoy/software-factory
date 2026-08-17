import { useEffect, useState } from "react";
import Editor from "@monaco-editor/react";
import { toast } from "sonner";
import { Save } from "lucide-react";
import { api } from "../../api";
import { Button } from "../../components/ui/button";
import { messageOf } from "../domainViews";

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
  };
  return map[ext] ?? "plaintext";
}

export function EditorPane({
  projectId,
  filePath,
  initialValue,
  onSaved,
}: {
  projectId: string;
  filePath: string;
  initialValue: string;
  onSaved?: (content: string) => void;
}) {
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setValue(initialValue);
    setDirty(false);
  }, [filePath, initialValue]);

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      await api.saveFile(projectId, filePath, value);
      setDirty(false);
      toast.success(`Saved ${filePath}`);
      onSaved?.(value);
    } catch (err) {
      toast.error(messageOf(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border px-2 py-1">
        <span className="flex-1 truncate text-xs text-muted-foreground">
          {filePath}
          {dirty && <span className="ml-2 text-amber-500">● unsaved</span>}
        </span>
        <Button size="sm" onClick={() => void save()} disabled={saving || !dirty}>
          <Save className="mr-1 h-3.5 w-3.5" aria-hidden />
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
      <div className="flex-1 overflow-hidden">
        <Editor
          height="100%"
          language={languageFor(filePath)}
          value={value}
          onChange={(next) => {
            setValue(next ?? "");
            setDirty(true);
          }}
          options={{ minimap: { enabled: false }, fontSize: 13, tabSize: 2 }}
        />
      </div>
    </div>
  );
}
