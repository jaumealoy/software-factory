import { describe, expect, it } from "vitest";
import { InvalidTransitionError, NotFoundError, ValidationError } from "../../src/domain/errors.js";
import {
  createTestChange,
  createTestContext,
  createTestProject,
  type TestContext,
} from "../helpers.js";

type ChangeContext = TestContext & { changeId: string };

async function setup(): Promise<ChangeContext> {
  const context = createTestContext();
  const { projectId } = await createTestProject(context.store);
  const { changeId } = await createTestChange(context.store, projectId);
  return { ...context, changeId };
}

describe("change lifecycle transitions", () => {
  it("follows the happy path from CREATED to DONE", async () => {
    const { store, changeId } = await setup();
    const sequence = [
      "REFINING",
      "CRITIQUE",
      "SPECIFYING",
      "ANALYZING",
      "DECOMPOSING",
      "TEST_DESIGN",
      "TEST_IMPLEMENTATION",
      "IMPLEMENTING",
      "VERIFYING",
      "REVIEWING",
      "READY_FOR_PR",
      "DONE",
    ] as const;

    let current = await store.getChange(changeId);
    expect(current.status).toBe("CREATED");

    for (const next of sequence) {
      current = await store.transitionChange(changeId, next);
      expect(current.status).toBe(next);
    }
  });

  it("rejects transitions that skip a stage", async () => {
    const { store, changeId } = await setup();
    await expect(store.transitionChange(changeId, "DONE")).rejects.toBeInstanceOf(
      InvalidTransitionError,
    );
    await expect(store.transitionChange(changeId, "IMPLEMENTING")).rejects.toBeInstanceOf(
      InvalidTransitionError,
    );
  });

  it("allows verification/review failure paths", async () => {
    const { store, changeId } = await setup();
    await store.transitionChange(changeId, "REFINING");
    await store.transitionChange(changeId, "CRITIQUE");
    await store.transitionChange(changeId, "SPECIFYING");
    await store.transitionChange(changeId, "ANALYZING");
    await store.transitionChange(changeId, "DECOMPOSING");
    await store.transitionChange(changeId, "CONTRACTING");
    await store.transitionChange(changeId, "TEST_DESIGN");
    await store.transitionChange(changeId, "TEST_IMPLEMENTATION");
    await store.transitionChange(changeId, "IMPLEMENTING");
    await store.transitionChange(changeId, "VERIFYING");

    const diagnosing = await store.transitionChange(changeId, "DIAGNOSING");
    expect(diagnosing.status).toBe("DIAGNOSING");
    await store.transitionChange(changeId, "IMPLEMENTING");
    await store.transitionChange(changeId, "VERIFYING");
    await store.transitionChange(changeId, "REVIEWING");
    const fixing = await store.transitionChange(changeId, "FIXING");
    expect(fixing.status).toBe("FIXING");
  });

  it("does not allow transitions out of DONE", async () => {
    const { store, changeId } = await setup();
    await store.transitionChange(changeId, "REFINING");
    await store.transitionChange(changeId, "CRITIQUE");
    await store.transitionChange(changeId, "SPECIFYING");
    await store.transitionChange(changeId, "ANALYZING");
    await store.transitionChange(changeId, "DECOMPOSING");
    await store.transitionChange(changeId, "TEST_DESIGN");
    await store.transitionChange(changeId, "TEST_IMPLEMENTATION");
    await store.transitionChange(changeId, "IMPLEMENTING");
    await store.transitionChange(changeId, "VERIFYING");
    await store.transitionChange(changeId, "REVIEWING");
    await store.transitionChange(changeId, "READY_FOR_PR");
    await store.transitionChange(changeId, "DONE");

    await expect(store.transitionChange(changeId, "FIXING")).rejects.toBeInstanceOf(
      InvalidTransitionError,
    );
  });

  it("fails transitions on unknown entities", async () => {
    const { store } = await setup();
    await expect(store.getChange("does-not-exist")).rejects.toBeInstanceOf(NotFoundError);
    await expect(store.transitionChange("does-not-exist", "REFINING")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("decision flow", () => {
  it("pauses a change awaiting a decision and resumes on approval", async () => {
    const { store, changeId } = await setup();
    await store.transitionChange(changeId, "REFINING");
    await store.transitionChange(changeId, "CRITIQUE");

    const decision = await store.requestDecision({
      changeId,
      problem: "Conflicting auth flows exist.",
      options: ["Reuse OAuth flow A", "Reuse OAuth flow B"],
      recommendation: "Reuse OAuth flow A",
      rationale: "Used by 3 active modules.",
      resumeStatus: "SPECIFYING",
    });

    const paused = await store.getChange(changeId);
    expect(paused.status).toBe("WAITING_FOR_DECISION");
    expect(decision.status).toBe("PENDING");

    const resolved = await store.resolveDecision({ decisionId: decision.id, approved: true });
    expect(resolved.status).toBe("APPROVED");

    const resumed = await store.getChange(changeId);
    expect(resumed.status).toBe("SPECIFYING");
  });

  it("declines a decision and still resumes the change", async () => {
    const { store, changeId } = await setup();
    await store.transitionChange(changeId, "REFINING");

    const decision = await store.requestDecision({
      changeId,
      problem: "Which direction?",
      options: ["A", "B"],
      resumeStatus: "CRITIQUE",
    });
    await store.resolveDecision({
      decisionId: decision.id,
      approved: false,
      resolutionNote: "Go with C.",
    });

    const declined = await store.getDecision(decision.id);
    expect(declined.status).toBe("DECLINED");
    const resumed = await store.getChange(changeId);
    expect(resumed.status).toBe("CRITIQUE");
  });

  it("rejects resolving a pending decision twice and requesting with no options", async () => {
    const { store, changeId } = await setup();
    await store.transitionChange(changeId, "REFINING");
    const decision = await store.requestDecision({
      changeId,
      problem: "Which?",
      options: ["A"],
      resumeStatus: "REFINING",
    });
    await store.resolveDecision({ decisionId: decision.id, approved: true });
    await expect(
      store.resolveDecision({ decisionId: decision.id, approved: true }),
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      store.requestDecision({ changeId, problem: "No options", options: [] }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("task lifecycle transitions", () => {
  it("walks the happy path and honors failure rework", async () => {
    const { store, changeId } = await setup();
    const task = await store.createTask({
      changeId,
      objective: "Implement the widget.",
    });
    expect(task.status).toBe("PROPOSED");

    expect((await store.transitionTask(task.id, "READY")).status).toBe("READY");
    expect((await store.transitionTask(task.id, "TEST_DESIGN")).status).toBe("TEST_DESIGN");
    expect((await store.transitionTask(task.id, "TEST_IMPLEMENTATION")).status).toBe(
      "TEST_IMPLEMENTATION",
    );
    expect((await store.transitionTask(task.id, "IMPLEMENTATION")).status).toBe("IMPLEMENTATION");
    expect((await store.transitionTask(task.id, "VERIFYING")).status).toBe("VERIFYING");

    // Verification failure sends the task back for rework
    expect((await store.transitionTask(task.id, "REWORK")).status).toBe("REWORK");
    expect((await store.transitionTask(task.id, "IMPLEMENTATION")).status).toBe("IMPLEMENTATION");
    await store.transitionTask(task.id, "VERIFYING");
    expect((await store.transitionTask(task.id, "REVIEW")).status).toBe("REVIEW");
    expect((await store.transitionTask(task.id, "DONE")).status).toBe("DONE");
  });

  it("rejects illegal task transitions", async () => {
    const { store, changeId } = await setup();
    const task = await store.createTask({ changeId, objective: "Never skip." });
    await expect(store.transitionTask(task.id, "DONE")).rejects.toBeInstanceOf(
      InvalidTransitionError,
    );
    await expect(store.transitionTask(task.id, "IMPLEMENTATION")).rejects.toBeInstanceOf(
      InvalidTransitionError,
    );

    const done = await store.transitionTask(task.id, "CANCELLED");
    expect(done.status).toBe("CANCELLED");
    await expect(store.transitionTask(task.id, "READY")).rejects.toBeInstanceOf(
      InvalidTransitionError,
    );
  });

  it("persists GitHub references on tasks", async () => {
    const { store, changeId } = await setup();
    const task = await store.createTask({ changeId, objective: "Track me." });
    const updated = await store.setGitHubReference({
      taskId: task.id,
      githubIssueNumber: 42,
      githubIssueUrl: "https://github.com/example/example/issues/42",
    });
    expect(updated.githubIssueNumber).toBe(42);
    expect(updated.githubIssueUrl).toMatch(/issues\/42$/);
  });
});
