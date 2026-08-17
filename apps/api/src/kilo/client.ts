import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DomainError } from "../domain/errors.js";

const execFileAsync = promisify(execFile);

export interface KiloRunOptions {
  message: string;
  /** `provider/model` as accepted by `kilo run --model`. */
  model: string;
  /** Directory (worktree) the agent runs in. */
  dir: string;
  agent?: string;
  timeoutMs?: number;
}

export interface KiloRunOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

export interface KiloExecutor {
  run(options: KiloRunOptions): Promise<KiloRunOutput>;
}

export class KiloNotInstalledError extends DomainError {
  constructor() {
    super("Kilo Code is not installed or not on PATH; install it or configure a different runner");
    this.name = "KiloNotInstalledError";
  }
}

type KiloRunResult = { stdout: string; stderr: string; exitCode: number; timedOut: boolean };

async function defaultKiloRunner(args: string[], timeoutMs: number): Promise<KiloRunResult> {
  try {
    const result = await execFileAsync("kilo", args, {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0, timedOut: false };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; code?: string | number };
    if (err.code === "ENOENT") {
      throw new KiloNotInstalledError();
    }
    if (typeof err.code === "string" && err.code === "ETIMEDOUT") {
      return { stdout: err.stdout ?? "", stderr: err.stderr ?? "", exitCode: 124, timedOut: true };
    }
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
      exitCode: typeof err.code === "number" ? err.code : 1,
      timedOut: false,
    };
  }
}

export class KiloCliExecutor implements KiloExecutor {
  constructor(
    private readonly userRun: (
      args: string[],
      timeoutMs: number,
    ) => Promise<KiloRunResult> = defaultKiloRunner,
    private readonly defaultTimeoutMs = 10 * 60_000,
  ) {}

  async run(options: KiloRunOptions): Promise<KiloRunOutput> {
    const args = [
      "run",
      options.message,
      "--model",
      options.model,
      "--dir",
      options.dir,
      "--format",
      "json",
    ];
    if (options.agent) {
      args.push("--agent", options.agent);
    }
    const result = await this.userRun(args, options.timeoutMs ?? this.defaultTimeoutMs);
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
    };
  }
}
