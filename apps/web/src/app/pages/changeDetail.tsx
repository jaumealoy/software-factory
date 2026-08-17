import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, type ChangeDetail } from "../../api";
import { ArtifactRow, EventRow, messageOf, PendingDecision, TaskTable } from "../domainViews";

export function ChangeDetailPage() {
  const { changeId } = useParams<{ changeId: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<ChangeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [repositoryPath] = useState(() => sessionStorage.getItem("factory.repositoryPath") ?? "");

  async function load() {
    if (!changeId) {
      navigate("/changes");
      return;
    }
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
        <button type="button" onClick={() => navigate("/changes")}>
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
      <button type="button" onClick={() => navigate("/changes")}>
        ← Back
      </button>
      <h2>{detail.change.title}</h2>
      <p>
        Status:{" "}
        <span
          style={{
            fontSize: "0.85rem",
            fontWeight: 600,
            padding: "0.1rem 0.5rem",
            borderRadius: "0.5rem",
            backgroundColor: "#ddf4ff",
            color: "#0550ae",
          }}
        >
          {detail.change.status}
        </span>
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
