import { describe, expect, it, vi } from "vitest";
import { KiloCliExecutor, KiloNotInstalledError } from "../../src/kilo/client.js";
import { buildTaskPrompt } from "../../src/kilo/prompt.js";
import { kiloModelId, KiloRunner, truncate } from "../../src/kilo/runner.js";
import { listAvailableModels, parseKiloModels } from "../../src/kilo/models.js";
import type { TaskRunContext } from "../../src/runner/types.js";

function context(overrides: Partial<TaskRunContext> = {}): TaskRunContext {
  return {
    changeId: "c1",
    taskId: "t1",
    repositoryPath: "/tmp/worktree",
    model: "kilo/anthropic/claude-haiku-4.5",
    taskObjective: "Implement the widget.",
    changeTitle: "Add the widget",
    artifactPaths: ["/tmp/worktree/openspec/changes/add-widget/specs/core/spec.md"],
    testCommand: "pnpm test",
    ...overrides,
  };
}

describe("kilo task prompt", () => {
  it("encodes the task, artifacts, and TDD agreement", () => {
    const prompt = buildTaskPrompt(context());
    expect(prompt).toContain('Implement the task "Implement the widget."');
    expect(prompt).toContain("Write the tests FIRST");
    expect(prompt).toContain("/tmp/worktree/openspec/changes/add-widget/specs/core/spec.md");
    expect(prompt).toContain("`pnpm test`");
  });
});

describe("KiloRunner", () => {
  it("reports success when the CLI exits zero", async () => {
    const executor = {
      run: vi.fn().mockResolvedValue({ stdout: "ok\n", stderr: "", exitCode: 0, timedOut: false }),
    };
    const runner = new KiloRunner({ executor, testCommand: "pnpm test" });
    const events: string[] = [];

    const result = await runner.run(context(), (event) => events.push(event.type));

    expect(result.status).toBe("SUCCEEDED");
    expect(result.verificationPassed).toBe(true);
    expect(executor.run).toHaveBeenCalledWith(
      expect.objectContaining({ model: "anthropic/claude-haiku-4.5", dir: "/tmp/worktree" }),
    );
    expect(events).toEqual([
      "started",
      "log",
      "verification_started",
      "verification_passed",
      "completed",
    ]);
  });

  it("reports failure with verification evidence on non-zero exit", async () => {
    const executor = {
      run: vi.fn().mockResolvedValue({
        stdout: "",
        stderr: "TypeError: x is not a function",
        exitCode: 1,
        timedOut: false,
      }),
    };
    const runner = new KiloRunner({ executor });

    const result = await runner.run(context());

    expect(result.status).toBe("FAILED");
    expect(result.verificationPassed).toBe(false);
    expect(result.message).toMatch(/code 1/);
    expect(result.events.some((event) => event.type === "verification_failed")).toBe(true);
  });

  it("aborts on timeout", async () => {
    const executor = {
      run: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 124, timedOut: true }),
    };
    const runner = new KiloRunner({ executor, timeoutMs: 1000 });

    const result = await runner.run(context());

    expect(result.status).toBe("ABORTED");
    expect(result.events.some((event) => event.type === "aborted")).toBe(true);
  });

  it("surfaces a missing kilo binary as a failure", async () => {
    const executor = {
      run: vi.fn().mockRejectedValue(new KiloNotInstalledError()),
    };
    const runner = new KiloRunner({ executor });

    const result = await runner.run(context());

    expect(result.status).toBe("FAILED");
    expect(result.message).toMatch(/not installed/i);
  });
});

describe("KiloCliExecutor", () => {
  it("builds the headless kilo run invocation", async () => {
    const userRun = vi
      .fn()
      .mockResolvedValue({ stdout: "", stderr: "", exitCode: 0, timedOut: false });
    const executor = new KiloCliExecutor(userRun, 60_000);

    await executor.run({ message: "do it", model: "anthropic/claude-haiku-4.5", dir: "/tmp/wt" });

    const [args, timeout] = userRun.mock.calls[0] as [string[], number];
    expect(args[0]).toBe("run");
    expect(args).toContain("--model");
    expect(args[args.indexOf("--model") + 1]).toBe("anthropic/claude-haiku-4.5");
    expect(args).toContain("--dir");
    expect(args[args.indexOf("--dir") + 1]).toBe("/tmp/wt");
    expect(args).toContain("--format");
    expect(args).toContain("json");
    expect(timeout).toBe(60_000);
  });
});

describe("kilo model helpers", () => {
  it("strips the kilo/ prefix for the --model flag", () => {
    expect(kiloModelId("kilo/anthropic/claude-haiku-4.5")).toBe("anthropic/claude-haiku-4.5");
    expect(kiloModelId("anthropic/claude-haiku-4.5")).toBe("anthropic/claude-haiku-4.5");
  });

  it("parses `kilo models` output", () => {
    const models = parseKiloModels(
      "kilo/~openai/gpt-latest\nkilo/anthropic/claude-haiku-4.5\njunk line\n",
    );
    expect(models).toEqual([
      { id: "kilo/~openai/gpt-latest", provider: "~openai", model: "gpt-latest" },
      { id: "kilo/anthropic/claude-haiku-4.5", provider: "anthropic", model: "claude-haiku-4.5" },
    ]);
  });

  it("lists models through the runner", async () => {
    const models = await listAvailableModels(async () => "kilo/anthropic/claude-sonnet-4.5\n");
    expect(models[0]?.model).toBe("claude-sonnet-4.5");
  });

  it("truncates long output", () => {
    expect(truncate("abcdef", 3)).toBe("abc…");
  });
});
