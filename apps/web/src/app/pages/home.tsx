import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type ChangeSummary, type Project } from "../../api";
import {
  fieldStyle,
  listItemStyle,
  linkButtonStyle,
  messageOf,
  statusPillStyle,
} from "../domainViews";

export function HomePage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState("");
  const [requestText, setRequestText] = useState("");
  const [repositoryPath, setRepositoryPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changes, setChanges] = useState<ChangeSummary[]>([]);

  async function load() {
    try {
      const [projectList, changeList] = await Promise.all([api.listProjects(), api.listChanges()]);
      setProjects(projectList);
      setChanges(changeList);
      if (projectList.length > 0) {
        setProjectId((current) => current || (projectList[0]?.id ?? ""));
      }
    } catch (err) {
      setError(messageOf(err));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function submitRequest() {
    if (busy) return;
    try {
      setBusy(true);
      setError(null);
      const response = await api.createChange({ projectId, title, requestText, repositoryPath });
      sessionStorage.setItem("factory.repositoryPath", repositoryPath);
      navigate(`/changes/${response.workflow.changeId}`);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Request intake">
      <h2>Start a request</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submitRequest();
        }}
      >
        <label style={fieldStyle}>
          Project
          <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            {projects.length === 0 && <option value="">No projects configured</option>}
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <label style={fieldStyle}>
          Title
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            placeholder="Add Google OAuth login"
          />
        </label>
        <label style={fieldStyle}>
          Request
          <textarea
            value={requestText}
            onChange={(event) => setRequestText(event.target.value)}
            required
            rows={4}
            placeholder="Describe the feature you want the factory to build."
          />
        </label>
        <label style={fieldStyle}>
          Repository path
          <input
            value={repositoryPath}
            onChange={(event) => setRepositoryPath(event.target.value)}
            placeholder="/path/to/product/repo"
          />
        </label>
        <button type="submit" disabled={busy || !projectId}>
          {busy ? "Running…" : "Run factory"}
        </button>
        {error && <p role="alert">{error}</p>}
      </form>

      <h2 style={{ marginTop: "2rem" }}>Recent changes</h2>
      {changes.length === 0 ? (
        <p>No changes yet.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {changes.slice(0, 5).map((change) => (
            <li key={change.id} style={listItemStyle}>
              <button
                type="button"
                onClick={() => navigate(`/changes/${change.id}`)}
                style={linkButtonStyle}
              >
                {change.title}
              </button>{" "}
              <span style={statusPillStyle}>{change.status}</span>
            </li>
          ))}
        </ul>
      )}
      {changes.length > 5 && (
        <p>
          <a
            href="/changes"
            onClick={(event) => {
              event.preventDefault();
              navigate("/changes");
            }}
          >
            View all changes
          </a>
        </p>
      )}
    </section>
  );
}
