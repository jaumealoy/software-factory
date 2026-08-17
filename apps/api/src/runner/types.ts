import { ValidationError } from "../domain/errors.js";

export type TaskRunStage = "TEST_DESIGN" | "TEST_IMPLEMENTATION" | "IMPLEMENTATION" | "VERIFYING";
export type TaskRunStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "ABORTED";

export type TaskRunEventType =
  | "started"
  | "log"
  | "tests_written"
  | "implementation_done"
  | "verification_started"
  | "verification_passed"
  | "verification_failed"
  | "completed"
  | "failed"
  | "aborted";

export interface TaskRunEvent {
  type: TaskRunEventType;
  stage: TaskRunStage | "COMPLETED" | null;
  message?: string;
  detail?: string;
  data?: Record<string, unknown>;
  timestamp: string;
}

export interface TaskRunContext {
  changeId: string;
  taskId: string;
  repositoryPath: string;
  model: string;
  taskObjective: string;
  changeTitle: string;
  /** OpenSpec spec/design artifact paths the agent should honor. */
  artifactPaths: string[];
  impactManifestPath?: string;
  /** Command the runner must run to verify the task (e.g. `pnpm test`). */
  testCommand?: string;
}

export interface TaskRunResult {
  status: TaskRunStatus;
  events: TaskRunEvent[];
  testsCreated: string[];
  changedFiles: string[];
  verificationCommand: string | null;
  verificationOutput: string | null;
  verificationPassed: boolean | null;
  message: string | null;
  startedAt: string;
  finishedAt: string;
}

export interface TaskRunner {
  /** Executes a task. Events are emitted (and persisted) in order as the run progresses. */
  run(context: TaskRunContext, onEvent?: (event: TaskRunEvent) => void): Promise<TaskRunResult>;
}

export const validateRunContext = (context: TaskRunContext): void => {
  const required: Array<[keyof TaskRunContext, string]> = [
    ["changeId", "changeId"],
    ["taskId", "taskId"],
    ["repositoryPath", "repositoryPath"],
    ["model", "model"],
    ["taskObjective", "taskObjective"],
  ];
  for (const [key, label] of required) {
    if (typeof context[key] !== "string" || context[key].trim() === "") {
      throw new ValidationError(`Missing required run context field: ${label}`);
    }
  }
};
