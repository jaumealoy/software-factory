import { Badge } from "../../components/ui/badge";
import type { TaskEdge, TaskItem } from "../../api";

export interface TaskGraphData {
  tasks: TaskItem[];
  edges: TaskEdge[];
  isAcyclic: boolean;
}

interface LayerNode {
  id: string;
  layer: number;
  order: number;
}

/** Longest-path layering (Kahn) so dependencies always sit in lower layers. */
export function computeLayers(tasks: TaskItem[], edges: TaskEdge[]): Map<string, LayerNode> {
  const deps = new Map<string, string[]>();
  const dependents = new Map<string, string[]>();
  for (const task of tasks) {
    deps.set(task.id, []);
    dependents.set(task.id, []);
  }
  for (const edge of edges) {
    deps.get(edge.taskId)?.push(edge.dependsOnTaskId);
    dependents.get(edge.dependsOnTaskId)?.push(edge.taskId);
  }

  const inDegree = new Map<string, number>();
  for (const task of tasks) {
    inDegree.set(task.id, deps.get(task.id)?.length ?? 0);
  }
  const queue = tasks
    .filter((task) => (deps.get(task.id)?.length ?? 0) === 0)
    .map((task) => task.id);

  const layer = new Map<string, number>();
  while (queue.length > 0) {
    const id = queue.shift() as string;
    const dependencyLayers = (deps.get(id) ?? []).map((dep) => layer.get(dep) ?? -1);
    layer.set(id, dependencyLayers.length > 0 ? Math.max(...dependencyLayers) + 1 : 0);
    for (const dependent of dependents.get(id) ?? []) {
      const remaining = (inDegree.get(dependent) ?? 1) - 1;
      inDegree.set(dependent, remaining);
      if (remaining === 0) queue.push(dependent);
    }
  }

  const nodes: LayerNode[] = tasks.map((task) => ({
    id: task.id,
    layer: layer.get(task.id) ?? 0,
    order: 0,
  }));
  const byLayer = new Map<number, LayerNode[]>();
  for (const node of nodes) {
    const bucket = byLayer.get(node.layer) ?? [];
    bucket.push(node);
    byLayer.set(node.layer, bucket);
  }
  for (const bucket of byLayer.values()) {
    bucket.sort(
      (a, b) =>
        tasks.findIndex((task) => task.id === a.id) - tasks.findIndex((task) => task.id === b.id),
    );
    bucket.forEach((node, index) => {
      node.order = index;
    });
  }
  return new Map(nodes.map((node) => [node.id, node]));
}

const NODE_WIDTH = 200;
const NODE_HEIGHT = 64;
const GAP_X = 48;
const GAP_Y = 28;
const PADDING = 24;

export function TaskGraphView({ tasks, edges, isAcyclic }: TaskGraphData) {
  if (tasks.length === 0) {
    return <p className="text-sm text-muted-foreground">No tasks yet.</p>;
  }

  const layers = computeLayers(tasks, edges);
  const byLayer = new Map<number, string[]>();
  for (const task of tasks) {
    const layerNumber = layers.get(task.id)?.layer ?? 0;
    const bucket = byLayer.get(layerNumber) ?? [];
    bucket.push(task.id);
    byLayer.set(layerNumber, bucket);
  }
  const layerNumbers = [...byLayer.keys()].sort((a, b) => a - b);
  const maxOrder = Math.max(...[...layers.values()].map((node) => node.order), 0);

  const position = (taskId: string) => {
    const node = layers.get(taskId);
    const layerNumber = node?.layer ?? 0;
    const order = node?.order ?? 0;
    return {
      x: PADDING + layerNumber * (NODE_WIDTH + GAP_X),
      y: PADDING + order * (NODE_HEIGHT + GAP_Y),
    };
  };

  const svgWidth = PADDING * 2 + layerNumbers.length * (NODE_WIDTH + GAP_X) - GAP_X;
  const svgHeight = PADDING * 2 + (maxOrder + 1) * (NODE_HEIGHT + GAP_Y) - GAP_Y;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {tasks.length} tasks, {edges.length} dependencies — {isAcyclic ? "acyclic" : "cyclic"}
      </p>

      <svg
        role="img"
        aria-label="Task dependency graph"
        width={svgWidth}
        height={svgHeight}
        className="max-w-full"
      >
        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L0,6 L6,3 z" fill="#94a3b8" />
          </marker>
        </defs>
        {edges.map((edge, index) => {
          const from = position(edge.taskId);
          const to = position(edge.dependsOnTaskId);
          return (
            <line
              key={index}
              x1={from.x + NODE_WIDTH / 2}
              y1={from.y + NODE_HEIGHT}
              x2={to.x + NODE_WIDTH / 2}
              y2={to.y}
              stroke="#94a3b8"
              strokeWidth={1.5}
              markerEnd="url(#arrow)"
            />
          );
        })}
        {tasks.map((task) => {
          const pos = position(task.id);
          return (
            <g key={task.id}>
              <rect
                x={pos.x}
                y={pos.y}
                width={NODE_WIDTH}
                height={NODE_HEIGHT}
                rx={8}
                fill={taskFill(task.status)}
                stroke="#cbd5e1"
              />
              <text x={pos.x + 10} y={pos.y + 24} fontSize={12} fontWeight={600} fill="#0f172a">
                {task.status}
              </text>
              <text x={pos.x + 10} y={pos.y + 46} fontSize={11} fill="#334155">
                {truncate(task.objective, 28)}
              </text>
            </g>
          );
        })}
      </svg>

      <div>
        <h4 className="mb-1 text-sm font-medium">Dependencies</h4>
        {edges.length === 0 ? (
          <p className="text-sm text-muted-foreground">No dependencies between tasks.</p>
        ) : (
          <ul className="space-y-1.5">
            {edges.map((edge, index) => (
              <li key={index} className="text-sm">
                <span className="font-medium">{objectiveOf(tasks, edge.taskId)}</span>{" "}
                <span className="text-muted-foreground">depends on</span>{" "}
                <span className="font-medium">{objectiveOf(tasks, edge.dependsOnTaskId)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        {tasks.map((task) => (
          <div key={task.id} className="flex min-w-56 flex-col gap-1 rounded-md border p-3">
            <Badge variant={badgeVariant(task.status)} className="w-fit">
              {task.status}
            </Badge>
            <span className="text-sm">{task.objective}</span>
            {task.githubIssueNumber != null && (
              <span className="text-xs text-muted-foreground">#{task.githubIssueNumber}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function objectiveOf(tasks: TaskItem[], taskId: string): string {
  return tasks.find((task) => task.id === taskId)?.objective ?? taskId;
}

function truncate(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

function badgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "DONE") return "default";
  if (status === "BLOCKED" || status === "CANCELLED" || status === "FAILED") return "destructive";
  if (status === "VERIFYING") return "secondary";
  return "outline";
}

function taskFill(status: string): string {
  if (status === "DONE") return "#dcfce7";
  if (status === "BLOCKED" || status === "FAILED") return "#fee2e2";
  if (status === "VERIFYING" || status === "IMPLEMENTING") return "#e0f2fe";
  return "#f8fafc";
}
