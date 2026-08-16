import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { createDb, runMigrations, type DbHandle } from "../../src/db/index.js";
import { FactoryStore } from "../../src/domain/index.js";
import { publishChangeIssues } from "../../src/github/publisher.js";
import type { CreateIssueInput, EditIssueInput, IssueExecutor } from "../../src/github/client.js";
import { validateOpenSpecChange } from "../../src/openspec/adapter.js";
import { runWorkflow, resumeWorkflow } from "../../src/workflow/orchestrator.js";
import type {
  CritiqueInput,
  PlannedTask,
  RefineInput,
  WorkflowProvider,
} from "../../src/workflow/types.js";
import { migrationsDir } from "../../src/paths.js";

const execFileAsync = promisify(execFile);
const tmpRoots: string[] = [];
const handles: DbHandle[] = [];

afterEach(() => {
  for (const handle of handles.splice(0)) {
    handle.client.close();
  }
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

async function openspecAvailable(): Promise<boolean> {
  try {
    await execFileAsync("openspec", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

function makeFixtureRepo(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), `e2e-fixture-`));
  tmpRoots.push(root);
  mkdirSync(path.join(root, "openspec"), { recursive: true });
  writeFileSync(path.join(root, "openspec", "config.yaml"), "schema: spec-driven\n");
  mkdirSync(path.join(root, "apps", "backend", "src"), { recursive: true });
  writeFileSync(
    path.join(root, "apps", "backend", "src", "api.ts"),
    "export interface ApiContract {}",
  );
  writeFileSync(path.join(root, "apps", "backend", "src", "api.test.ts"), "test('x')");
  mkdirSync(path.join(root, "apps", "web", "src"), { recursive: true });
  writeFileSync(path.join(root, "apps", "web", "src", "page.ts"), "export const page = true;");
  return root;
}

class AcceptanceProvider implements WorkflowProvider {
  constructor(private readonly ambiguous: boolean) {}

  async refine(input: RefineInput) {
    return {
      title: input.requestText.split(/[.!?\n]/)[0] ?? "Untitled",
      summary: input.requestText,
      proposedCapabilities: [{ name: "user-auth", description: "Google OAuth sign-in" }],
      ambiguities: this.ambiguous ? ["Which provider is authoritative?"] : [],
      risks: [],
      expandedScope: false,
    };
  }

  async critique(input: CritiqueInput) {
    const findings = input.refinement.ambiguities.length > 0 ? ["Clarify the OAuth decision."] : [];
    return { findings, recommendation: "ok", requiresHumanDecision: findings.length > 0 };
  }

  async analyze() {
    return { signals: ["auth"], notes: [] };
  }

  async plan() {
    return {
      capabilities: [
        {
          name: "user-auth",
          description: "Google OAuth sign-in",
          tasks: [
            { objective: "Define the OAuth contract", risk: "medium" },
            { objective: "Implement the Google OAuth flow", risk: "high" },
            { objective: "Add the OAuth acceptance tests", risk: "low" },
          ] as PlannedTask[],
        },
      ],
      dependencies: [
        { from: { capability: 0, task: 1 }, to: { capability: 0, task: 0 } },
        { from: { capability: 0, task: 2 }, to: { capability: 0, task: 1 } },
      ],
    };
  }
}

class RecordingIssueExecutor implements IssueExecutor {
  created: number[] = [];
  edited: number[] = [];
  bodies: string[] = [];
  private next = 10;

  async createIssue(input: CreateIssueInput) {
    const number = this.next++;
    this.created.push(number);
    this.bodies.push(input.body);
    return { number, url: `https://github.com/${input.repoFullName}/issues/${number}` };
  }

  async editIssue(input: EditIssueInput) {
    this.edited.push(input.number);
    return {
      number: input.number,
      url: `https://github.com/${input.repoFullName}/issues/${input.number}`,
    };
  }
}

function setupDb(): DbHandle {
  const db = createDb(":memory:");
  runMigrations(db.db, migrationsDir);
  handles.push(db);
  return db;
}

const withCli = (await openspecAvailable()) ? describe : describe.skip;

withCli("MVP 1 acceptance — request to GitHub issues", () => {
  it("runs the full journey and publishes idempotent, linked task issues", async () => {
    const dbHandle = setupDb();
    const db = dbHandle.db;
    const store = new FactoryStore(db);
    const project = await store.createProject({ name: "Acme", slug: "acme" });
    const repositoryPath = makeFixtureRepo();
    const executor = new RecordingIssueExecutor();

    // 1. Request -> task graph (refine, critique, spec, impact, decompose)
    const workflow = await runWorkflow(db, {
      projectId: project.id,
      title: "Add user authentication",
      requestText: "Add user authentication with Google OAuth.",
      repositoryPath,
      provider: new AcceptanceProvider(false),
    });
    expect(workflow.phase).toBe("completed");
    expect(workflow.tasksCreated).toBe(3);
    expect(workflow.capabilitiesCreated).toBe(1);

    // 2. The generated OpenSpec change validates on disk with tooling
    const validation = await validateOpenSpecChange(repositoryPath, workflow.openspecName!);
    expect(validation.valid).toBe(true);

    // 3. Impact manifest and OpenSpec artifacts are persisted with evidence
    const artifacts = await store.listArtifacts({ changeId: workflow.changeId });
    expect(artifacts.some((artifact) => artifact.kind === "impact_manifest")).toBe(true);
    expect(artifacts.some((artifact) => artifact.kind === "openspec_proposal")).toBe(true);
    expect(artifacts.some((artifact) => artifact.kind === "openspec_spec")).toBe(true);

    // 4. Publish each task as a developer-readable GitHub issue
    const published = await publishChangeIssues(db, {
      changeId: workflow.changeId,
      repoFullName: "acme/product",
      changeIssueNumber: 5,
      labels: ["factory", "mvp"],
      executor,
    });
    expect(published).toHaveLength(3);
    expect(executor.created).toHaveLength(3);

    const bodies = executor.bodies;
    expect(bodies[0]).toContain("## Objective");
    expect(bodies[0]).toContain("## Requirements");
    expect(bodies[0]).toContain("## Dependencies");
    expect(bodies[0]).toContain("## Factory metadata");
    expect(bodies[0]).toContain("parent issue #5");
    expect(bodies[0]).toContain("Capability: `user-auth`");

    const tasks = await store.listTasks(workflow.changeId);
    expect(tasks.every((task) => task.githubIssueNumber != null)).toBe(true);
    const allBodies = bodies.join("\n");
    expect(allBodies).toContain("#10 — Define the OAuth contract");

    // 5. Republishing edits existing issues and never duplicates
    const republished = await publishChangeIssues(db, {
      changeId: workflow.changeId,
      repoFullName: "acme/product",
      changeIssueNumber: 5,
      labels: ["factory"],
      executor,
    });
    expect(republished.map((result) => result.action)).toEqual(["updated", "updated", "updated"]);
    expect(executor.created).toHaveLength(3);
    expect(executor.edited).toHaveLength(3);
  });

  it("covers the human-decision path across the whole flow", async () => {
    const dbHandle = setupDb();
    const db = dbHandle.db;
    const store = new FactoryStore(db);
    const project = await store.createProject({ name: "Acme", slug: "acme-decision" });
    const repositoryPath = makeFixtureRepo();

    const paused = await runWorkflow(db, {
      projectId: project.id,
      title: "Add user authentication",
      requestText: "Add user authentication with Google OAuth.",
      repositoryPath,
      provider: new AcceptanceProvider(true),
    });
    expect(paused.phase).toBe("awaiting_decision");
    expect((await store.getChange(paused.changeId)).status).toBe("WAITING_FOR_DECISION");

    await store.resolveDecision({ decisionId: paused.decisionId!, approved: true });

    const resumed = await resumeWorkflow(db, {
      changeId: paused.changeId,
      repositoryPath,
      provider: new AcceptanceProvider(false),
    });
    expect(resumed.phase).toBe("completed");
    expect(resumed.tasksCreated).toBe(3);
    const graph = await store.getTaskGraph(paused.changeId);
    expect(graph.isAcyclic).toBe(true);
  });
});
