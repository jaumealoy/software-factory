import { useEffect, useState } from "react";
import { fetchHealth, type HealthResponse } from "./api";

type HealthState =
  | { phase: "loading" }
  | { phase: "ok"; data: HealthResponse }
  | { phase: "error"; message: string };

export function App() {
  const [state, setState] = useState<HealthState>({ phase: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    fetchHealth(controller.signal)
      .then((data) => setState({ phase: "ok", data }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          phase: "error",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      });
    return () => controller.abort();
  }, []);

  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: "40rem",
        margin: "4rem auto",
        lineHeight: 1.5,
      }}
    >
      <h1>Software Factory</h1>
      <section aria-label="API status">
        {state.phase === "loading" && <p>Checking API…</p>}
        {state.phase === "error" && <p role="alert">API unreachable: {state.message}</p>}
        {state.phase === "ok" && (
          <dl>
            <div>
              <dt>Status</dt>
              <dd>{state.data.status}</dd>
            </div>
            <div>
              <dt>Database</dt>
              <dd>{state.data.database}</dd>
            </div>
            <div>
              <dt>Checked at</dt>
              <dd>{new Date(state.data.timestamp).toLocaleString()}</dd>
            </div>
          </dl>
        )}
      </section>
    </main>
  );
}
