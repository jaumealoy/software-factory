import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api, type ChangeSummary } from "../../api";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Textarea } from "../../components/ui/textarea";
import { Badge } from "../../components/ui/badge";
import { messageOf, statusBadgeVariant } from "../domainViews";
import { useProject } from "../projectSwitcher";

export function HomePage() {
  const navigate = useNavigate();
  const { projects, ready, activeProjectId, setActiveProjectId } = useProject();
  const [title, setTitle] = useState("");
  const [requestText, setRequestText] = useState("");
  const [repositoryPath, setRepositoryPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changes, setChanges] = useState<ChangeSummary[]>([]);

  async function load() {
    try {
      setChanges(await api.listChanges(activeProjectId ?? undefined));
    } catch (err) {
      setError(messageOf(err));
    }
  }

  useEffect(() => {
    void load();
  }, [activeProjectId]);

  async function submitRequest() {
    if (busy) return;
    try {
      setBusy(true);
      setError(null);
      const response = await api.createChange({
        projectId: activeProjectId ?? "",
        title,
        requestText,
        repositoryPath,
      });
      sessionStorage.setItem("factory.repositoryPath", repositoryPath);
      toast.success("Request accepted");
      navigate(`/changes/${response.workflow.changeId}`);
    } catch (err) {
      setError(messageOf(err));
      toast.error(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <section aria-label="Request intake">
        <Card>
          <CardHeader>
            <CardTitle>Start a request</CardTitle>
            <CardDescription>
              Describe what you want the factory to build; it will refine, specify, analyze, and
              decompose it into tasks.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void submitRequest();
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="project">Project</Label>
                <Select
                  value={activeProjectId ?? ""}
                  onValueChange={(value) => {
                    if (value) setActiveProjectId(value);
                  }}
                  disabled={!ready || projects.length === 0}
                >
                  <SelectTrigger id="project">
                    <SelectValue placeholder="Select a project" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  required
                  placeholder="Add Google OAuth login"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="request">Request</Label>
                <Textarea
                  id="request"
                  value={requestText}
                  onChange={(event) => setRequestText(event.target.value)}
                  required
                  rows={4}
                  placeholder="Describe the feature you want the factory to build."
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="repositoryPath">Repository path</Label>
                <Input
                  id="repositoryPath"
                  value={repositoryPath}
                  onChange={(event) => setRepositoryPath(event.target.value)}
                  placeholder="/path/to/product/repo"
                />
              </div>
              <Button type="submit" disabled={busy || !activeProjectId}>
                {busy ? "Running…" : "Run factory"}
              </Button>
              {error && (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}
            </form>
          </CardContent>
        </Card>
      </section>

      <section aria-label="Recent changes">
        <Card>
          <CardHeader>
            <CardTitle>Recent changes</CardTitle>
          </CardHeader>
          <CardContent>
            {changes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No changes yet.</p>
            ) : (
              <ul className="divide-y">
                {changes.slice(0, 5).map((change) => (
                  <li key={change.id} className="flex items-center justify-between py-2">
                    <button
                      type="button"
                      onClick={() => navigate(`/changes/${change.id}`)}
                      className="text-sm font-medium text-blue-600 hover:underline"
                    >
                      {change.title}
                    </button>
                    <Badge variant={statusBadgeVariant(change.status)}>{change.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
            {changes.length > 5 && (
              <Button
                variant="link"
                size="sm"
                className="mt-2 px-0"
                onClick={() => navigate("/changes")}
              >
                View all changes
              </Button>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
