import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type ChangeSummary } from "../../api";
import { listItemStyle, linkButtonStyle, messageOf, statusPillStyle } from "../domainViews";

export function ChangesPage() {
  const navigate = useNavigate();
  const [changes, setChanges] = useState<ChangeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listChanges()
      .then((list) => {
        setChanges(list);
        setLoading(false);
      })
      .catch((err) => {
        setError(messageOf(err));
        setLoading(false);
      });
  }, []);

  if (error) {
    return <p role="alert">{error}</p>;
  }

  if (loading) {
    return <p>Loading changes…</p>;
  }

  return (
    <section aria-label="Changes list">
      <h2>Changes</h2>
      {changes.length === 0 ? (
        <p>No changes yet.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {changes.map((change) => (
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
    </section>
  );
}
