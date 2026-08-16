import { useEffect, useState, type CSSProperties } from "react";
import {
  api,
  type Artifact,
  type ChangeDetail,
  type ChangeSummary,
  type Decision,
  type ExecutionEvent,
  type Project,
  type TaskItem,
} from "./api";

type View = { name: "home" } | { name: "detail"; changeId: string };

export function App() {
  const [view, setView] = useState<View>({ name: "home" });
  const [lastRepositoryPath, setLastRepositoryPath] = useState("");

  return (
    <main style={pageStyle}>
      <h1>Software Factory</h1>
      {view.name === "home" ? (
        <HomeView
          onOpenChange={(changeId, repositoryPath) => {
            setLastRepositoryPath(repositoryPath);
            setView({ name: "detail", changeId });
          }}
        />
      ) : (
        <ChangeDetailView
          changeId={view.changeId}
          repositoryPath={lastRepositoryPath}
          onHome={() => setView({ name: "home" })}
        />
      )}
    </main>
  );
}

function HomeView({
  onOpenChange,
}: {
  onOpenChange: (changeId: string, repositoryPath: string) => void;
}) {
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
      onOpenChange(response.workflow.changeId, repositoryPath);
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

      <h2>Changes</h2>
      {changes.length === 0 && <p>No changes yet.</p>}
      <ul style={{ listStyle: "none", padding: 0 }}>
        {changes.map((change) => (
          <li key={change.id} style={listItemStyle}>
            <button
              type="button"
              onClick={() => onOpenChange(change.id, "")}
              style={linkButtonStyle}
            >
              {change.title}
            </button>{" "}
            <span style={statusPillStyle}>{change.status}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ChangeDetailView({
  changeId,
  repositoryPath,
  onHome,
}: {
  changeId: string;
  repositoryPath: string;
  onHome: () => void;
}) {
  const [detail, setDetail] = useState<ChangeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setDetail(await api.getChange(changeId));
      setError(null);
    } catch (err) {
      setError(messageOf(err));
    }
  }

  useEffect(() => {
    void load();
  }, [changeId]);

  if (error) {
    return (
      <section>
        <p role="alert">{error}</p>
        <button type="button" onClick={onHome}>
          Back
        </button>
      </section>
    );
  }

  if (!detail) {
    return <p>Loading change…</p>;
  }

  return (
    <section aria-label="Change details">
      <button type="button" onClick={onHome}>
        ← Back
      </button>
      <h2>{detail.change.title}</h2>
      <p>
        Status: <span style={statusPillStyle}>{detail.change.status}</span>
      </p>
      <p>{detail.change.requestText}</p>

      {detail.pendingDecisions.map((decision) => (
        <PendingDecision
          key={decision.id}
          decision={decision}
          repositoryPath={repositoryPath}
          onResolved={() => void load()}
        />
      ))}

      <h3>Capabilities</h3>
      {detail.capabilities.length === 0 ? (
        <p>None.</p>
      ) : (
        <ul>
          {detail.capabilities.map((capability) => (
            <li key={capability.id}>{capability.name}</li>
          ))}
        </ul>
      )}

      <h3>Tasks</h3>
      <TaskTable tasks={detail.tasks} />

      <h3>Artifacts</h3>
      {detail.artifacts.length === 0 ? (
        <p>None.</p>
      ) : (
        <ul>
          {detail.artifacts.map((artifact) => (
            <ArtifactRow key={artifact.id} artifact={artifact} />
          ))}
        </ul>
      )}

      {detail.events.length > 0 && (
        <>
          <h3>Activity</h3>
          <ul style={{ fontSize: "0.9rem", color: "#444" }}>
            {detail.events.slice(0, 10).map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function PendingDecision({
  decision,
  repositoryPath,
  onResolved,
}: {
  decision: Decision;
  repositoryPath: string;
  onResolved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resolve(approved: boolean) {
    try {
      setBusy(true);
      setError(null);
      await api.resolveDecision(decision.id, { approved, repositoryPath });
      onResolved();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={decisionBoxStyle} role="group" aria-label="Pending decision">
      <h3>Decision needed</h3>
      <p>{decision.problem}</p>
      <ul>
        {parseOptions(decision.optionsJson).map((option) => (
          <li key={option}>{option}</li>
        ))}
      </ul>
      {decision.recommendation && (
        <p>
          Recommendation: {decision.recommendation}
          {decision.rationale ? ` — ${decision.rationale}` : ""}
        </p>
      )}
      <button type="button" disabled={busy} onClick={() => void resolve(true)}>
        Approve
      </button>{" "}
      <button type="button" disabled={busy} onClick={() => void resolve(false)}>
        Decline
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

function TaskTable({ tasks }: { tasks: TaskItem[] }) {
  return (
    <ul style={{ listStyle: "none", padding: 0 }}>
      {tasks.map((task) => (
        <li key={task.id} style={listItemStyle}>
          <span style={taskStatusPillStyle(task.status)}>{task.status}</span>
          {task.objective}
          {task.githubIssueNumber != null && (
            <span style={{ color: "#57606a", marginLeft: "0.5rem" }}>
              #{task.githubIssueNumber}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function ArtifactRow({ artifact }: { artifact: Artifact }) {
  return (
    <li>
      <code>{artifact.kind}</code>
      {artifact.summary ? ` — ${artifact.summary}` : ""}
      {artifact.uri ? (
        <>
          {" "}
          <a href={artifact.uri} target="_blank" rel="noreferrer">
            link
          </a>
        </>
      ) : null}
    </li>
  );
}

function EventRow({ event }: { event: ExecutionEvent }) {
  return (
    <li>
      {new Date(event.createdAt).toLocaleTimeString()} — {event.eventType}
    </li>
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function parseOptions(optionsJson: string): string[] {
  try {
    const parsed = JSON.parse(optionsJson);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function taskStatusPillStyle(status: string): CSSProperties {
  const color: Record<string, string> = {
    DONE: "#1a7f37",
    BLOCKED: "#b60205",
    VERIFYING: "#9a6700",
  };
  return {
    display: "inline-block",
    fontSize: "0.75rem",
    fontWeight: 600,
    fontFamily: "monospace",
    color: "#fff",
    backgroundColor: color[status] ?? "#57606a",
    borderRadius: "0.75rem",
    padding: "0.1rem 0.6rem",
    marginRight: "0.5rem",
  };
}

const pageStyle: CSSProperties = {
  fontFamily: "system-ui, sans-serif",
  maxWidth: "52rem",
  margin: "2rem auto",
  padding: "0 1rem",
  lineHeight: 1.5,
};
const fieldStyle: CSSProperties = { display: "block", marginBottom: "0.75rem", fontWeight: 500 };
const listItemStyle: CSSProperties = { padding: "0.4rem 0", borderBottom: "1px solid #eee" };
const linkButtonStyle: CSSProperties = {
  background: "none",
  border: "none",
  color: "#0550ae",
  cursor: "pointer",
  fontSize: "1rem",
};
const decisionBoxStyle: CSSProperties = {
  border: "1px solid #d0d7de",
  borderRadius: "0.5rem",
  padding: "1rem",
  margin: "1rem 0",
  backgroundColor: "#fff8c5",
};
const statusPillStyle: CSSProperties = {
  fontSize: "0.85rem",
  fontWeight: 600,
  padding: "0.1rem 0.5rem",
  borderRadius: "0.5rem",
  backgroundColor: "#ddf4ff",
  color: "#0550ae",
};
