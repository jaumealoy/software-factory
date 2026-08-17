import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Db } from "../db/index.js";
import { recordArtifact } from "../domain/artifacts.js";
import { recordEvent } from "../domain/events.js";
import type { TaskRunContext, TaskRunEvent, TaskRunResult, TaskRunner } from "./types.js";

export interface DeterministicRunnerOptions {
  /** `success` (default) – full happy path. `verification-failure` – tests pass but verification fails. `error` – runner crashes. */
  mode?: "success" | "verification-failure" | "error";
  testCommand?: string;
}

export class DeterministicRunner implements TaskRunner {
  private readonly mode: "success" | "verification-failure" | "error";
  private readonly testCommand: string;

  constructor(options: DeterministicRunnerOptions = {}) {
    this.mode = options.mode ?? "success";
    this.testCommand = options.testCommand ?? "echo 'test ok'";
  }

  async run(
    context: TaskRunContext,
    onEvent?: (event: TaskRunEvent) => void,
  ): Promise<TaskRunResult> {
    const events: TaskRunEvent[] = [];
    const emit = (event: TaskRunEvent): void => {
      events.push(event);
      onEvent?.(event);
    };
    const now = () => new Date().toISOString();
    const startedAt = now();

    emit({ type: "started", stage: null, message: "Run started", timestamp: now() });

    if (this.mode === "error") {
      emit({
        type: "failed",
        stage: "TEST_DESIGN",
        message: "Deterministic runner error",
        timestamp: now(),
      });
      return {
        status: "FAILED",
        events,
        testsCreated: [],
        changedFiles: [],
        verificationCommand: null,
        verificationOutput: null,
        verificationPassed: null,
        message: "Runner error",
        startedAt,
        finishedAt: now(),
      };
    }

    emit({
      type: "tests_written",
      stage: "TEST_IMPLEMENTATION",
      message: "Tests created",
      timestamp: now(),
    });
    const testsCreated = [`tests/${context.taskId.slice(0, 8)}.test.ts`];
    mkdirSync(path.join(context.repositoryPath, "tests"), { recursive: true });
    writeFileSync(
      path.join(context.repositoryPath, testsCreated[0] as string),
      "// fixture test\n",
    );

    emit({
      type: "implementation_done",
      stage: "IMPLEMENTATION",
      message: "Implementation complete",
      timestamp: now(),
    });
    const changedFiles = [`src/${context.taskId.slice(0, 8)}.ts`];
    mkdirSync(path.join(context.repositoryPath, "src"), { recursive: true });
    writeFileSync(
      path.join(context.repositoryPath, changedFiles[0] as string),
      "export const implemented = true;\n",
    );

    emit({
      type: "verification_started",
      stage: "VERIFYING",
      message: `Running ${this.testCommand}`,
      timestamp: now(),
    });

    if (this.mode === "verification-failure") {
      emit({
        type: "verification_failed",
        stage: "VERIFYING",
        message: "Tests failed",
        detail: "AssertionError: expected 1 to be 2",
        timestamp: now(),
      });
      emit({ type: "failed", stage: "VERIFYING", message: "Run failed", timestamp: now() });
      return {
        status: "FAILED",
        events,
        testsCreated,
        changedFiles,
        verificationCommand: this.testCommand,
        verificationOutput: "AssertionError: expected 1 to be 2",
        verificationPassed: false,
        message: "Verification failed",
        startedAt,
        finishedAt: now(),
      };
    }

    emit({
      type: "verification_passed",
      stage: "VERIFYING",
      message: "All tests passed",
      timestamp: now(),
    });
    emit({ type: "completed", stage: "COMPLETED", message: "Run completed", timestamp: now() });

    return {
      status: "SUCCEEDED",
      events,
      testsCreated,
      changedFiles,
      verificationCommand: this.testCommand,
      verificationOutput: "OK",
      verificationPassed: true,
      message: null,
      startedAt,
      finishedAt: now(),
    };
  }
}

export interface PersistRunInput {
  changeId: string;
  taskId: string;
  context: TaskRunContext;
  result: TaskRunResult;
}

export function persistRun(db: Db, input: PersistRunInput): void {
  recordEvent(db, {
    entityType: "task",
    entityId: input.taskId,
    eventType: "task.run_completed",
    payload: {
      status: input.result.status,
      model: input.context.model,
      durationMs:
        new Date(input.result.finishedAt).getTime() - new Date(input.result.startedAt).getTime(),
      verificationPassed: input.result.verificationPassed,
    },
  });

  recordEvent(db, {
    entityType: "change",
    entityId: input.changeId,
    eventType: "task.run_completed",
    payload: {
      taskId: input.taskId,
      status: input.result.status,
      model: input.context.model,
    },
  });

  recordArtifact(db, {
    changeId: input.changeId,
    taskId: input.taskId,
    kind: "other",
    uri: `run://tasks/${input.taskId}/result`,
    summary: `Task run (${input.context.model})`,
    validationResult: JSON.stringify({
      status: input.result.status,
      testsCreated: input.result.testsCreated,
      changedFiles: input.result.changedFiles,
      verificationCommand: input.result.verificationCommand,
      verificationOutput: input.result.verificationOutput,
      eventTypes: input.result.events.map((event) => event.type),
    }),
  });
}
