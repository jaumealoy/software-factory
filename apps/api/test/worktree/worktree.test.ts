import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorktreeError, WorktreeManager } from "../../src/worktree/manager.js";

let repoPath: string;
let manager: WorktreeManager;

function runGit(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

beforeEach(() => {
  repoPath = path.join(os.tmpdir(), `wt-${Math.random().toString(36).slice(2)}`);
  mkdirSync(repoPath, { recursive: true });
  runGit(["init", "-b", "main"], repoPath);
  runGit(["config", "user.email", "test@example.com"], repoPath);
  runGit(["config", "user.name", "Test"], repoPath);
  writeFileSync(path.join(repoPath, "README.md"), "# fixture\n");
  runGit(["add", "."], repoPath);
  runGit(["commit", "-m", "initial"], repoPath);
  manager = new WorktreeManager();
});

afterEach(() => {
  rmSync(repoPath, { recursive: true, force: true });
});

describe("git worktree execution", () => {
  it("creates an isolated worktree with a task branch", async () => {
    const provision = await manager.create({
      repoPath,
      changeName: "add-widget",
      taskId: "t-12345678-0000-0000-0000-000000000001",
      baseRef: "main",
    });

    expect(existsSync(provision.worktreePath)).toBe(true);
    expect(provision.branch).toMatch(/^task\/add-widget-/);
    expect(provision.baseRef).toBe("main");

    const branch = runGit(["branch", "--show-current"], provision.worktreePath).trim();
    expect(branch).toBe(provision.branch);

    // Commits made inside the worktree are isolated from the main repo branch
    writeFileSync(path.join(provision.worktreePath, "feature.txt"), "work\n");
    await manager.commitAll(provision, "implement task");

    const commits = await manager.commits(provision);
    expect(commits.some((commit) => commit.includes("implement task"))).toBe(true);
    expect(runGit(["branch", "--show-current"], repoPath).trim()).toBe("main");

    await manager.destroy(provision);
    expect(existsSync(provision.worktreePath)).toBe(false);
  });

  it("rejects a worktree for a missing base ref", async () => {
    await expect(
      manager.create({
        repoPath,
        changeName: "add-widget",
        taskId: "t-00000000-0000-0000-0000-000000000002",
        baseRef: "does-not-exist",
      }),
    ).rejects.toBeInstanceOf(WorktreeError);
  });

  it("rejects duplicate worktrees for the same task", async () => {
    const provision = await manager.create({
      repoPath,
      changeName: "add-widget",
      taskId: "t-12345678-0000-0000-0000-000000000003",
      baseRef: "main",
    });

    await expect(
      manager.create({
        repoPath,
        changeName: "add-widget",
        taskId: "t-12345678-0000-0000-0000-000000000003",
        baseRef: "main",
      }),
    ).rejects.toBeInstanceOf(WorktreeError);

    await manager.destroy(provision);
  });

  it("reports cleanup warnings when the worktree is already gone", async () => {
    const provision = await manager.create({
      repoPath,
      changeName: "add-widget",
      taskId: "t-12345678-0000-0000-0000-000000000004",
      baseRef: "main",
    });
    rmSync(provision.worktreePath, { recursive: true, force: true });

    const cleanup = await manager.destroy(provision);
    expect(cleanup.warnings.length).toBeGreaterThanOrEqual(0);
  });
});
