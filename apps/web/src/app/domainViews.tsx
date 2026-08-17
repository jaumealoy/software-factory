import { useState } from "react";
import { toast } from "sonner";
import { api, type Artifact, type Decision, type ExecutionEvent, type TaskItem } from "../api";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Table, TableBody, TableCell, TableRow } from "../components/ui/table";
import { cn } from "../lib/utils";

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

export function statusBadgeVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "DONE":
    case "COMPLETED":
      return "default";
    case "BLOCKED":
    case "CANCELLED":
    case "FAILED":
      return "destructive";
    case "VERIFYING":
    case "IMPLEMENTING":
    case "TEST_IMPLEMENTATION":
      return "secondary";
    default:
      return "outline";
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

  async function resolve(approved: boolean) {
    try {
      setBusy(true);
      await api.resolveDecision(decision.id, { approved, repositoryPath });
      toast.success(approved ? "Decision approved" : "Decision declined");
      onResolved();
    } catch (err) {
      toast.error(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-6 border-amber-300 bg-amber-50">
      <CardHeader>
        <CardTitle className="text-base">Decision needed</CardTitle>
        <CardDescription>{decision.problem}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="list-disc pl-5">
          {parseOptions(decision.optionsJson).map((option) => (
            <li key={option}>{option}</li>
          ))}
        </ul>
        {decision.recommendation && (
          <p className="text-sm text-muted-foreground">
            Recommendation:{" "}
            <span className="font-medium text-foreground">{decision.recommendation}</span>
            {decision.rationale ? ` — ${decision.rationale}` : ""}
          </p>
        )}
        <div className="flex gap-2">
          <Button size="sm" disabled={busy} onClick={() => void resolve(true)}>
            Approve
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void resolve(false)}>
            Decline
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function TaskTable({ tasks }: { tasks: TaskItem[] }) {
  return (
    <Table>
      <TableBody>
        {tasks.map((task) => (
          <TableRow key={task.id}>
            <TableCell className="w-40">
              <Badge variant={statusBadgeVariant(task.status)}>{task.status}</Badge>
            </TableCell>
            <TableCell>{task.objective}</TableCell>
            <TableCell className="w-24 text-muted-foreground">
              {task.githubIssueNumber != null ? `#${task.githubIssueNumber}` : ""}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function ArtifactRow({ artifact }: { artifact: Artifact }) {
  return (
    <li className="flex items-baseline gap-2 py-1">
      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{artifact.kind}</code>
      <span>{artifact.summary}</span>
      {artifact.uri && (
        <a className="text-blue-600 underline" href={artifact.uri} target="_blank" rel="noreferrer">
          link
        </a>
      )}
    </li>
  );
}

export function EventRow({ event }: { event: ExecutionEvent }) {
  return (
    <li className="flex gap-2">
      <span className="tabular-nums text-muted-foreground">
        {new Date(event.createdAt).toLocaleTimeString()}
      </span>
      <span className={cn("rounded bg-muted px-1.5 text-xs")}>{event.eventType}</span>
    </li>
  );
}

export { Alert, AlertDescription, AlertTitle };
