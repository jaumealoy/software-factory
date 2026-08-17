import { useState, type CSSProperties } from "react";
import { api, type Artifact, type Decision, type ExecutionEvent, type TaskItem } from "../api";

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export function parseOptions(optionsJson: string): string[] {
  try {
    const parsed = JSON.parse(optionsJson);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function PendingDecision({
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

export function TaskTable({ tasks }: { tasks: TaskItem[] }) {
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

export function ArtifactRow({ artifact }: { artifact: Artifact }) {
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

export function EventRow({ event }: { event: ExecutionEvent }) {
  return (
    <li>
      {new Date(event.createdAt).toLocaleTimeString()} — {event.eventType}
    </li>
  );
}

export function taskStatusPillStyle(status: string): CSSProperties {
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

export const fieldStyle: CSSProperties = {
  display: "block",
  marginBottom: "0.75rem",
  fontWeight: 500,
};
export const listItemStyle: CSSProperties = { padding: "0.4rem 0", borderBottom: "1px solid #eee" };
export const linkButtonStyle: CSSProperties = {
  background: "none",
  border: "none",
  color: "#0550ae",
  cursor: "pointer",
  fontSize: "1rem",
};
export const decisionBoxStyle: CSSProperties = {
  border: "1px solid #d0d7de",
  borderRadius: "0.5rem",
  padding: "1rem",
  margin: "1rem 0",
  backgroundColor: "#fff8c5",
};
export const statusPillStyle: CSSProperties = {
  fontSize: "0.85rem",
  fontWeight: 600,
  padding: "0.1rem 0.5rem",
  borderRadius: "0.5rem",
  backgroundColor: "#ddf4ff",
  color: "#0550ae",
};
