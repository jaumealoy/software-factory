import { describe, expect, it } from "vitest";
import { DeterministicRunner, persistRun, validateRunContext } from "../../src/runner/index.js";
import { ValidationError } from "../../src/domain/errors.js";
import { createTestChange, createTestContext, createTestProject } from "../helpers.js";
import type { TaskRunContext } from "../../src/runner/index.js";

function context(overrides: Partial<TaskRunContext> = {}): TaskRunContext {
  return {
    changeId: "c1",
    taskId: "t1",
    repositoryPath: "/tmp/repo",
    model: "openrouter/deepseek/deepseek-v4",
    taskObjective: "Implement the widget.",
    changeTitle: "Add the widget",
    artifactPaths: ["/tmp/repo/openspec/changes/add-widget/specs/core/spec.md"],
    testCommand: "pnpm test",
    ...overrides,
  };
}

describe("runner contract", () => {
  it("emits the documented event sequence on success", async () => {
    const runner = new DeterministicRunner({ testCommand: "pnpm test" });
    const events: string[] = [];
    const result = await runner.run(context(), (event) => events.push(event.type));

    expect(result.status).toBe("SUCCEEDED");
    expect(result.verificationPassed).toBe(true);
    expect(result.verificationCommand).toBe("pnpm test");
    expect(result.testsCreated.length).toBeGreaterThan(0);
    expect(result.changedFiles.length).toBeGreaterThan(0);
    expect(events).toEqual([
      "started",
      "tests_written",
      "implementation_done",
      "verification_started",
      "verification_passed",
      "completed",
    ]);
    expect(result.events).toHaveLength(events.length);
  });

  it("fails when verification fails", async () => {
    const runner = new DeterministicRunner({ mode: "verification-failure" });
    const result = await runner.run(context());

    expect(result.status).toBe("FAILED");
    expect(result.verificationPassed).toBe(false);
    expect(result.message).toBe("Verification failed");
    expect(result.events.some((event) => event.type === "verification_failed")).toBe(true);
  });

  it("fails fast on a runner error", async () => {
    const runner = new DeterministicRunner({ mode: "error" });
    const result = await runner.run(context());

    expect(result.status).toBe("FAILED");
    expect(result.message).toBe("Runner error");
    expect(result.events.at(-1)?.type).toBe("failed");
  });

  it("validates the required run context", () => {
    expect(() => validateRunContext(context())).not.toThrow();
    expect(() => validateRunContext(context({ model: "" }))).toThrow(ValidationError);
    expect(() => validateRunContext(context({ taskObjective: "  " }))).toThrow(ValidationError);
  });
});

describe("run persistence", () => {
  it("records run events and an artifact with the model used", async () => {
    const { store, db } = createTestContext();
    const { projectId } = await createTestProject(store);
    const { changeId } = await createTestChange(store, projectId);
    const task = await store.createTask({ changeId, objective: "Implement the widget." });

    const runContext = context({ changeId, taskId: task.id });
    const runner = new DeterministicRunner();
    const result = await runner.run(runContext);
    persistRun(db, { changeId, taskId: task.id, context: runContext, result });

    const events = await store.listEvents({ entityType: "task", entityId: task.id });
    expect(events.some((event) => event.eventType === "task.run_completed")).toBe(true);

    const artifacts = await store.listArtifacts({ changeId, taskId: task.id });
    const runArtifact = artifacts.find((artifact) => artifact.uri?.startsWith("run://"));
    expect(runArtifact).toBeDefined();
    const stored = JSON.parse(runArtifact?.validationResult ?? "{}");
    expect(stored.status).toBe("SUCCEEDED");
    expect(stored.eventTypes).toContain("tests_written");
  });
});
