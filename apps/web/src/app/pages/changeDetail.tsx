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
import {
  ArtifactRow,
  EventRow,
  messageOf,
  PendingDecision,
  statusBadgeVariant,
  TaskTable,
} from "../domainViews";

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
          <CardTitle>Tasks</CardTitle>
        </CardHeader>
        <CardContent>
          <TaskTable tasks={detail.tasks} />
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
            <ul>
              {detail.artifacts.map((artifact) => (
                <ArtifactRow key={artifact.id} artifact={artifact} />
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
                <EventRow key={event.id} event={event} />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
