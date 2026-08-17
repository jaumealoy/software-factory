import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, type ChangeDetail } from "../../api";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { messageOf, PendingDecision, statusBadgeVariant } from "../domainViews";
import { TaskGraphView } from "../components/taskGraph";

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
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
        <Button variant="outline" size="sm" onClick={() => navigate("/changes")}>
          Back
        </Button>
      </section>
    );
  }

  if (!detail) {
    return <p className="text-sm text-muted-foreground">Loading change…</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => navigate("/changes")}>
          ← Back
        </Button>
        <h2 className="text-xl font-semibold">{detail.change.title}</h2>
        <Badge variant={statusBadgeVariant(detail.change.status)}>{detail.change.status}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">{detail.change.requestText}</p>

      {detail.pendingDecisions.map((decision) => (
        <PendingDecision
          key={decision.id}
          decision={decision}
          repositoryPath={repositoryPath}
          onResolved={() => void load()}
        />
      ))}

      <Card>
        <CardHeader>
          <CardTitle>Capabilities</CardTitle>
        </CardHeader>
        <CardContent>
          {detail.capabilities.length === 0 ? (
            <p className="text-sm text-muted-foreground">None.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {detail.capabilities.map((capability) => (
                <li key={capability.id}>
                  <Badge variant="secondary">{capability.name}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Task graph</CardTitle>
          <CardDescription>Decomposed tasks and their dependencies.</CardDescription>
        </CardHeader>
        <CardContent>
          <TaskGraphView
            tasks={detail.tasks}
            edges={detail.taskGraph.edges}
            isAcyclic={detail.taskGraph.isAcyclic}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Runs</CardTitle>
          <CardDescription>Task execution runs will appear here.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            The Kilo Code agent integration will surface live run status and verification results on
            this panel.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Artifacts</CardTitle>
        </CardHeader>
        <CardContent>
          {detail.artifacts.length === 0 ? (
            <p className="text-sm text-muted-foreground">None.</p>
          ) : (
            <ul className="divide-y">
              {detail.artifacts.map((artifact) => (
                <li key={artifact.id} className="py-2">
                  <details className="group">
                    <summary className="flex cursor-pointer items-baseline gap-2">
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                        {artifact.kind}
                      </code>
                      <span>{artifact.summary}</span>
                      {artifact.uri && (
                        <a
                          className="text-blue-600 underline"
                          href={artifact.uri}
                          target="_blank"
                          rel="noreferrer"
                        >
                          link
                        </a>
                      )}
                      <span className="text-xs text-muted-foreground group-open:hidden">
                        expand
                      </span>
                    </summary>
                    <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 text-xs">
                      {JSON.stringify(
                        {
                          path: artifact.path,
                          uri: artifact.uri,
                          validation: artifact.validationResult,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {detail.events.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Activity</CardTitle>
            <CardDescription>Recent execution events for this change.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5">
              {detail.events.slice(0, 10).map((event) => (
                <EventRowInline key={event.id} event={event} />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function EventRowInline({ event }: { event: { createdAt: string; eventType: string } }) {
  return (
    <li className="flex gap-2 text-sm">
      <span className="tabular-nums text-muted-foreground">
        {new Date(event.createdAt).toLocaleTimeString()}
      </span>
      <span>{event.eventType}</span>
    </li>
  );
}
