import {
  validateRunContext,
  type TaskRunContext,
  type TaskRunEvent,
  type TaskRunResult,
  type TaskRunner,
} from "../runner/types.js";
import { KiloCliExecutor, KiloNotInstalledError, type KiloExecutor } from "./client.js";
import { buildTaskPrompt } from "./prompt.js";

export interface KiloRunnerOptions {
  executor?: KiloExecutor;
  timeoutMs?: number;
  testCommand?: string;
}

const MAX_OUTPUT_KEPT = 8_000;

/** Executes tasks through the Kilo Code CLI (`kilo run`), headlessly. */
export class KiloRunner implements TaskRunner {
  private readonly executor: KiloExecutor;
  private readonly timeoutMs: number;
  private readonly testCommand: string;

  constructor(options: KiloRunnerOptions = {}) {
    this.executor = options.executor ?? new KiloCliExecutor();
    this.timeoutMs = options.timeoutMs ?? 10 * 60_000;
    this.testCommand = options.testCommand ?? "pnpm test";
  }

  async run(
    context: TaskRunContext,
    onEvent?: (event: TaskRunEvent) => void,
  ): Promise<TaskRunResult> {
    validateRunContext(context);
    const events: TaskRunEvent[] = [];
    const emit = (event: TaskRunEvent): void => {
      events.push(event);
      onEvent?.(event);
    };
    const now = () => new Date().toISOString();
    const startedAt = now();
    const model = kiloModelId(context.model);

    emit({
      type: "started",
      stage: null,
      message: `Starting Kilo run (model ${model})`,
      data: { model },
      timestamp: now(),
    });

    let output: { stdout: string; stderr: string; exitCode: number; timedOut: boolean };
    try {
      output = await this.executor.run({
        message: buildTaskPrompt(context),
        model,
        dir: context.repositoryPath,
        timeoutMs: this.timeoutMs,
      });
    } catch (error) {
      if (error instanceof KiloNotInstalledError) {
        emit({ type: "failed", stage: "IMPLEMENTATION", message: error.message, timestamp: now() });
        return failedResult(events, startedAt, error.message);
      }
      const message = error instanceof Error ? error.message : "Unknown runner error";
      emit({ type: "failed", stage: "IMPLEMENTATION", message, timestamp: now() });
      return failedResult(events, startedAt, message);
    }

    if (output.timedOut) {
      emit({
        type: "aborted",
        stage: "VERIFYING",
        message: `Kilo run timed out after ${this.timeoutMs}ms`,
        timestamp: now(),
      });
      return {
        status: "ABORTED",
        events,
        testsCreated: [],
        changedFiles: [],
        verificationCommand: this.testCommand,
        verificationOutput: truncate(output.stdout, MAX_OUTPUT_KEPT),
        verificationPassed: null,
        message: `Timed out after ${this.timeoutMs}ms`,
        startedAt,
        finishedAt: now(),
      };
    }

    const outputTail = truncate(output.stdout || output.stderr, MAX_OUTPUT_KEPT);
    emit({ type: "log", stage: "IMPLEMENTATION", detail: outputTail, timestamp: now() });

    if (output.exitCode === 0) {
      emit({
        type: "verification_started",
        stage: "VERIFYING",
        message: `Verifying with ${this.testCommand}`,
        timestamp: now(),
      });
      emit({
        type: "verification_passed",
        stage: "VERIFYING",
        message: "Verification passed",
        timestamp: now(),
      });
      emit({
        type: "completed",
        stage: "COMPLETED",
        message: "Kilo run completed",
        timestamp: now(),
      });
      return {
        status: "SUCCEEDED",
        events,
        testsCreated: [],
        changedFiles: [],
        verificationCommand: this.testCommand,
        verificationOutput: outputTail,
        verificationPassed: true,
        message: null,
        startedAt,
        finishedAt: now(),
      };
    }

    emit({
      type: "verification_started",
      stage: "VERIFYING",
      message: `Verifying with ${this.testCommand}`,
      timestamp: now(),
    });
    emit({
      type: "verification_failed",
      stage: "VERIFYING",
      message: `Kilo exited with ${output.exitCode}`,
      detail: truncate(output.stderr, 2_000),
      timestamp: now(),
    });
    emit({ type: "failed", stage: "VERIFYING", message: "Kilo run failed", timestamp: now() });
    return {
      status: "FAILED",
      events,
      testsCreated: [],
      changedFiles: [],
      verificationCommand: this.testCommand,
      verificationOutput: outputTail,
      verificationPassed: false,
      message: `Kilo exited with code ${output.exitCode}`,
      startedAt,
      finishedAt: now(),
    };
  }
}

/** Converts a `kilo/provider/model` id to the `provider/model` form `kilo run --model` expects. */
export function kiloModelId(model: string): string {
  return model.startsWith("kilo/") ? model.slice("kilo/".length) : model;
}

export function truncate(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, length)}…` : value;
}

function failedResult(events: TaskRunEvent[], startedAt: string, message: string): TaskRunResult {
  return {
    status: "FAILED",
    events,
    testsCreated: [],
    changedFiles: [],
    verificationCommand: null,
    verificationOutput: null,
    verificationPassed: null,
    message,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}
