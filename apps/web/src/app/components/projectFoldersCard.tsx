import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Star } from "lucide-react";
import { api, type WorkFolder } from "../../api";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Badge } from "../../components/ui/badge";
import { messageOf } from "../domainViews";
import { useProject } from "../projectSwitcher";

export function ProjectFoldersCard() {
  const { activeProjectId } = useProject();
  const [folders, setFolders] = useState<WorkFolder[]>([]);
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setFolders([]);
    setError(null);
    if (!activeProjectId) return;
    api
      .listFolders(activeProjectId)
      .then((res) => setFolders(res.folders))
      .catch((err) => setError(messageOf(err)));
  }, [activeProjectId]);

  async function addFolder() {
    if (!activeProjectId || !name.trim() || !path.trim()) return;
    try {
      const { folder } = await api.addFolder(activeProjectId, {
        name: name.trim(),
        path: path.trim(),
      });
      setFolders((prev) => [...prev, folder]);
      setName("");
      setPath("");
      toast.success("Folder added");
    } catch (err) {
      toast.error(messageOf(err));
    }
  }

  async function setActive(folderId: string) {
    if (!activeProjectId) return;
    try {
      const { folders: next } = await api.setActiveFolder(activeProjectId, folderId);
      setFolders(next);
      toast.success("Active folder updated");
    } catch (err) {
      toast.error(messageOf(err));
    }
  }

  async function remove(folderId: string) {
    if (!activeProjectId) return;
    try {
      const { folders: next } = await api.removeFolder(activeProjectId, folderId);
      setFolders(next);
      toast.success("Folder removed");
    } catch (err) {
      toast.error(messageOf(err));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Project folders</CardTitle>
        <CardDescription>
          A project can span multiple folders/repositories. The active folder scopes the file tree,
          editor, and diff.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!activeProjectId ? (
          <p className="text-sm text-muted-foreground">Select a project to manage its folders.</p>
        ) : (
          <>
            {folders.length === 0 ? (
              <p className="text-sm text-muted-foreground">No folders defined yet.</p>
            ) : (
              <ul className="divide-y">
                {folders.map((folder) => (
                  <li key={folder.id} className="flex items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{folder.name}</span>
                        {folder.isPrimary && <Badge variant="secondary">active</Badge>}
                        {!folder.exists && <Badge variant="destructive">path missing</Badge>}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{folder.path}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {!folder.isPrimary && (
                        <Button variant="ghost" size="sm" onClick={() => void setActive(folder.id)}>
                          <Star className="mr-1 h-3.5 w-3.5" aria-hidden />
                          Set active
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => void remove(folder.id)}>
                        Remove
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="space-y-2 border-t border-border pt-3">
              <Label htmlFor="folder-name">Add a folder</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="folder-name"
                  placeholder="Name (e.g. Backend)"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <Input
                  id="folder-path"
                  placeholder="/absolute/path"
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                />
                <Button onClick={() => void addFolder()} disabled={!name.trim() || !path.trim()}>
                  Add folder
                </Button>
              </div>
            </div>
          </>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
