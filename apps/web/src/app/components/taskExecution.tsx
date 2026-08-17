import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  api,
  type KiloModel,
  type TaskItem,
  type TaskRunRecord,
  type TaskRunResult,
} from "../../api";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Table, TableBody, TableCell, TableRow } from "../../components/ui/table";
import { messageOf, statusBadgeVariant } from "../domainViews";
import { cn } from "../../lib/utils";

export function TaskExecutionPanel({
  tasks,
  repositoryPath,
  onTaskUpdated,
}: {
  tasks: TaskItem[];
  repositoryPath: string;
  onTaskUpdated: () => void;
}) {
  const [models, setModels] = useState<KiloModel[]>([]);
  const [modelsByTask, setModelsByTask] = useState<Record<string, string>>({});
  const [runsByTask, setRunsByTask] = useState<Record<string, TaskRunRecord[]>>({});
  const [busyByTask, setBusyByTask] = useState<Record<string, boolean>>({});
  const [lastResultByTask, setLastResultByTask] = useState<Record<string, TaskRunResult>>({});
  const [, setSearchParams] = useSearchParams();

  async function openChat(task: TaskItem) {
    if (!repositoryPath) return;
    try {
      const { sessionId } = await api.startSession({
        taskId: task.id,
        repositoryPath,
      });
      setSearchParams({ session: sessionId });
      toast.success("Chat attached to the running session");
    } catch (err) {
      toast.error(messageOf(err));
    }
  }

  useEffect(() => {
    api
      .listModels()
      .then((response) => setModels(response.models))
      .catch(() => setModels([]));
  }, []);

  useEffect(() => {
    for (const task of tasks) {
      if (runsByTask[task.id]) continue;
      api
        .getTaskRuns(task.id)
        .then((response) => setRunsByTask((current) => ({ ...current, [task.id]: response.runs })))
        .catch(() => undefined);
    }
  }, [tasks]);

  function modelValue(task: TaskItem): string {
    return modelsByTask[task.id] ?? task.model ?? "";
  }

  async function changeModel(task: TaskItem, value: string) {
    setModelsByTask((current) => ({ ...current, [task.id]: value }));
    try {
      await api.setTaskModel(task.id, value);
      toast.success("Task model updated");
      onTaskUpdated();
    } catch (err) {
      toast.error(messageOf(err));
    }
  }

  async function run(task: TaskItem) {
    if (busyByTask[task.id]) return;
    if (!repositoryPath) {
      toast.error("No repository path is set; start a request to record it.");
      return;
    }
    try {
      setBusyByTask((current) => ({ ...current, [task.id]: true }));
      const response = await api.runTask(task.id, repositoryPath);
      setLastResultByTask((current) => ({ ...current, [task.id]: response.result }));
      if (response.result.status === "SUCCEEDED") {
        toast.success("Task completed");
      } else {
        toast.error(response.result.message ?? "Task did not complete");
      }
      const runs = await api.getTaskRuns(task.id);
      setRunsByTask((current) => ({ ...current, [task.id]: runs.runs }));
      onTaskUpdated();
    } catch (err) {
      toast.error(messageOf(err));
    } finally {
      setBusyByTask((current) => ({ ...current, [task.id]: false }));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Task execution</CardTitle>
        <CardDescription>
          Choose a model per task and run it. Tasks must be READY with their dependencies DONE.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tasks yet.</p>
        ) : (
          <Table>
            <TableBody>
              {tasks.map((task) => (
                <TaskExecutionRow
                  key={task.id}
                  task={task}
                  models={models}
                  modelValue={modelValue(task)}
                  busy={Boolean(busyByTask[task.id])}
                  disabled={
                    Boolean(busyByTask[task.id]) || !repositoryPath || task.status !== "READY"
                  }
                  lastResult={lastResultByTask[task.id]}
                  runs={runsByTask[task.id] ?? []}
                  onModelChange={(value) => {
                    if (value) void changeModel(task, value);
                  }}
                  onRun={() => void run(task)}
                  onOpenChat={() => void openChat(task)}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function TaskExecutionRow({
  task,
  models,
  modelValue,
  busy,
  disabled,
  lastResult,
  runs,
  onModelChange,
  onRun,
  onOpenChat,
}: {
  task: TaskItem;
  models: KiloModel[];
  modelValue: string;
  busy: boolean;
  disabled: boolean;
  lastResult: TaskRunResult | undefined;
  runs: TaskRunRecord[];
  onModelChange: (value: string | null) => void;
  onRun: () => void;
  onOpenChat: () => void;
}) {
  return (
    <TableRow>
      <TableCell className="min-w-56">
        <div className="text-sm font-medium">{task.objective}</div>
        <div className="mt-1 flex items-center gap-2">
          <Badge variant={statusBadgeVariant(task.status)}>{task.status}</Badge>
          {runs.length > 0 && (
            <span className="text-xs text-muted-foreground">{runs.length} run(s)</span>
          )}
          {lastResult && <RunBadge status={lastResult.status} />}
        </div>
      </TableCell>
      <TableCell className="w-64">
        <Select value={modelValue} onValueChange={onModelChange}>
          <SelectTrigger aria-label={`Model for ${task.id}`}>
            <SelectValue placeholder="Select model" />
          </SelectTrigger>
          <SelectContent>
            {models.map((model) => (
              <SelectItem key={model.id} value={model.id}>
                {model.model}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-2">
          <Button size="sm" variant="ghost" disabled={disabled} onClick={onOpenChat}>
            Open chat
          </Button>
          <Button size="sm" variant="outline" disabled={disabled} onClick={onRun}>
            {busy ? "Running…" : "Run"}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

function RunBadge({ status }: { status: TaskRunResult["status"] }) {
  const variant =
    status === "SUCCEEDED"
      ? "default"
      : status === "FAILED" || status === "ABORTED"
        ? "destructive"
        : "secondary";
  return <Badge variant={variant}>{status}</Badge>;
}

export { cn };
