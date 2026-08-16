import { describe, expect, it } from "vitest";
import {
  parseRepoFullName,
  type CreateIssueInput,
  type EditIssueInput,
  type IssueExecutor,
} from "../../src/github/client.js";
import { renderTaskIssueBody } from "../../src/github/issueBody.js";
import {
  publishChangeIssues,
  publishTaskIssue,
  PublishTaskError,
} from "../../src/github/publisher.js";
import { createTestChange, createTestContext, createTestProject } from "../helpers.js";

class FakeIssueExecutor implements IssueExecutor {
  calls: Array<{ kind: "create" | "edit"; repoFullName: string; title: string; body: string }> = [];
  failOnCreate = false;
  private nextNumber = 10;

  async createIssue(input: CreateIssueInput) {
    if (this.failOnCreate) {
      throw new Error("gh: authentication required");
    }
    const number = this.nextNumber++;
    this.calls.push({
      kind: "create",
      repoFullName: input.repoFullName,
      title: input.title,
      body: input.body,
    });
    return { number, url: `https://github.com/${input.repoFullName}/issues/${number}` };
  }

  async editIssue(input: EditIssueInput) {
    this.calls.push({
      kind: "edit",
      repoFullName: input.repoFullName,
      title: input.title,
      body: input.body,
    });
    return {
      number: input.number,
      url: `https://github.com/${input.repoFullName}/issues/${input.number}`,
    };
  }
}

const REPO = "acme/product";

async function setupTasks() {
  const context = createTestContext();
  const { projectId } = await createTestProject(context.store);
  const { changeId } = await createTestChange(context.store, projectId);
  const capability = await context.store.addCapability({
    changeId,
    name: "Authentication",
    summary: "Sign-in flows.",
  });
  const first = await context.store.createTask({
    changeId,
    capabilityId: capability.id,
    objective: "Define the auth contract.",
    scope: "apps/api",
    risk: "medium",
  });
  await context.store.setGitHubReference({
    taskId: first.id,
    githubIssueNumber: 7,
    githubIssueUrl: "https://github.com/acme/plugin/issues/7",
  });
  const second = await context.store.createTask({
    changeId,
    capabilityId: capability.id,
    objective: "Implement the provider flow.",
    risk: "high",
  });
  await context.store.addTaskDependency({ taskId: second.id, dependsOnTaskId: first.id });
  return { ...context, changeId, first, second, capability };
}

describe("task issue body rendering", () => {
  it("renders all required sections", () => {
    const body = renderTaskIssueBody({
      taskId: "t1",
      taskNumber: 9,
      objective: "Implement sign in",
      scope: "apps/api/auth",
      risk: "high",
      status: "READY",
      changeId: "c1",
      changeTitle: "Add Google OAuth",
      changeIssueNumber: 2,
      capabilityName: "Authentication",
      dependencyIssues: [{ number: 7, title: "Define the auth contract." }],
    });

    expect(body).toContain("## Objective");
    expect(body).toContain("## Requirements");
    expect(body).toContain("## Scope");
    expect(body).toContain("## Inputs");
    expect(body).toContain("## Outputs");
    expect(body).toContain("## TDD");
    expect(body).toContain("## Verification");
    expect(body).toContain("## Dependencies");
    expect(body).toContain("## Factory metadata");
    expect(body).toContain("#7 — Define the auth contract.");
    expect(body).toContain("parent issue #2");
    expect(body).toContain("Capability: `Authentication`");
    expect(body).toContain("Status: `READY`");
  });
});

describe("issue publishing", () => {
  it("creates one issue per task and persists references", async () => {
    const { store, changeId, second } = await setupTasks();
    const executor = new FakeIssueExecutor();

    const results = await publishChangeIssues(store.db, {
      changeId,
      repoFullName: REPO,
      changeIssueNumber: 2,
      labels: ["factory"],
      executor,
    });

    expect(results).toHaveLength(2);
    expect(executor.calls.filter((call) => call.title.includes("auth contract"))).toHaveLength(1);
    const published = await store.getTask(second.id);
    expect(published.githubIssueNumber).toBeGreaterThanOrEqual(10);

    const first = await store.listTasks(changeId);
    const contract = first.find((task) => task.objective.includes("auth contract"));
    expect(contract?.githubIssueNumber).toBe(7);
  });

  it("is idempotent: updating reuses the existing issue", async () => {
    const { store, second } = await setupTasks();
    const executor = new FakeIssueExecutor();

    await publishTaskIssue(store.db, { taskId: second.id, repoFullName: REPO, executor });
    const before = await store.getTask(second.id);
    expect(before.githubIssueNumber).toBeDefined();

    const result = await publishTaskIssue(store.db, {
      taskId: second.id,
      repoFullName: REPO,
      executor,
    });
    expect(result.action).toBe("updated");
    const after = await store.getTask(second.id);
    expect(after.githubIssueNumber).toBe(before.githubIssueNumber);
    expect(executor.calls.filter((call) => call.kind === "create")).toHaveLength(1);
    expect(executor.calls.filter((call) => call.kind === "edit")).toHaveLength(1);
  });

  it("records failures and leaves no reference behind", async () => {
    const { store, second } = await setupTasks();
    const executor = new FakeIssueExecutor();
    executor.failOnCreate = true;

    await expect(
      publishTaskIssue(store.db, { taskId: second.id, repoFullName: REPO, executor }),
    ).rejects.toBeInstanceOf(PublishTaskError);
    const unchanged = await store.getTask(second.id);
    expect(unchanged.githubIssueNumber).toBeNull();
    const events = await store.listEvents({ entityType: "task", entityId: second.id });
    expect(events.some((event) => event.eventType === "task.issue_publish_failed")).toBe(true);
  });
});

describe("parseRepoFullName", () => {
  it("parses https URLs", () => {
    expect(parseRepoFullName("https://github.com/acme/plugin")).toBe("acme/plugin");
    expect(parseRepoFullName("https://github.com/acme/plugin.git")).toBe("acme/plugin");
  });

  it("parses ssh URLs", () => {
    expect(parseRepoFullName("git@github.com:acme/plugin.git")).toBe("acme/plugin");
  });

  it("rejects unsupported URLs", () => {
    expect(() => parseRepoFullName("https://gitlab.com/acme/plugin")).toThrow();
  });
});
