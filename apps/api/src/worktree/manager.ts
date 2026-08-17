import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { DomainError } from "../domain/errors.js";

const execFileAsync = promisify(execFile);

export interface GitRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type GitRunner = (args: string[], cwd: string) => Promise<GitRunResult>;

async function defaultGitRunner(args: string[], cwd: string): Promise<GitRunResult> {
  try {
    const result = await execFileAsync("git", args, { cwd, timeout: 20_000 });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; code?: number };
    return { stdout: err.stdout ?? "", stderr: err.stderr ?? "", exitCode: err.code ?? 1 };
  }
}

export class WorktreeError extends DomainError {
  constructor(message: string) {
    super(message);
    this.name = "WorktreeError";
  }
}

export interface WorktreeProvisionInput {
  repoPath: string;
  changeName: string;
  taskId: string;
  baseRef?: string;
}

export interface WorktreeProvision {
  repoPath: string;
  worktreePath: string;
  branch: string;
  baseRef: string;
}

export interface WorktreeCleanup {
  worktreeRemoved: boolean;
  branchRemoved: boolean;
  warnings: string[];
}

export class WorktreeManager {
  constructor(private readonly gitRun: GitRunner = defaultGitRunner) {}

  async create(input: WorktreeProvisionInput): Promise<WorktreeProvision> {
    const repoPath = path.resolve(input.repoPath);
    const gitDir = await this.gitRun(["rev-parse", "--git-dir"], repoPath);
    if (gitDir.exitCode !== 0) {
      throw new WorktreeError(`Not a git repository: ${repoPath}`);
    }

    const baseRef =
      input.baseRef ??
      (await this.gitRun(["branch", "--show-current"], repoPath)).stdout.trim() ??
      "HEAD";
    if (baseRef === "") {
      throw new WorktreeError(`Could not determine the base branch in ${repoPath}`);
    }
    const baseCheck = await this.gitRun(["rev-parse", "--verify", `${baseRef}^{commit}`], repoPath);
    if (baseCheck.exitCode !== 0) {
      throw new WorktreeError(`Base ref "${baseRef}" does not exist in ${repoPath}`);
    }

    const branch = `task/${input.changeName}-${input.taskId.slice(0, 8)}`;
    const worktreePath = path.join(
      path.dirname(repoPath),
      `${path.basename(repoPath)}-task-${input.taskId.slice(0, 8)}`,
    );

    const existingWorktree = await this.gitRun(["worktree", "list", "--porcelain"], repoPath);
    if (existingWorktree.stdout.includes(worktreePath)) {
      throw new WorktreeError(`A task worktree already exists at ${worktreePath}`);
    }

    const createBranch = await this.gitRun(["branch", branch, baseRef], repoPath);
    if (createBranch.exitCode !== 0) {
      throw new WorktreeError(`Could not create branch ${branch}: ${createBranch.stderr.trim()}`);
    }

    const addWorktree = await this.gitRun(["worktree", "add", worktreePath, branch], repoPath);
    if (addWorktree.exitCode !== 0) {
      await this.gitRun(["branch", "-D", branch], repoPath);
      throw new WorktreeError(
        `Could not create worktree at ${worktreePath}: ${addWorktree.stderr.trim()}`,
      );
    }

    return { repoPath, worktreePath, branch, baseRef };
  }

  async destroy(provision: WorktreeProvision): Promise<WorktreeCleanup> {
    const warnings: string[] = [];
    const removed = await this.gitRun(
      ["worktree", "remove", "--force", provision.worktreePath],
      provision.repoPath,
    );
    if (removed.exitCode !== 0) {
      warnings.push(`worktree removal: ${removed.stderr.trim()}`);
    }

    const branchDeleted = await this.gitRun(["branch", "-D", provision.branch], provision.repoPath);
    if (branchDeleted.exitCode !== 0) {
      warnings.push(`branch deletion: ${branchDeleted.stderr.trim()}`);
    }

    return {
      worktreeRemoved: removed.exitCode === 0,
      branchRemoved: branchDeleted.exitCode === 0,
      warnings,
    };
  }

  async commits(provision: WorktreeProvision): Promise<string[]> {
    const result = await this.gitRun(
      ["log", `${provision.baseRef}..HEAD`, "--oneline"],
      provision.worktreePath,
    );
    return result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }

  async commitAll(provision: WorktreeProvision, message: string): Promise<void> {
    await this.gitRun(["add", "-A"], provision.worktreePath);
    const commit = await this.gitRun(["commit", "-m", message], provision.worktreePath);
    const combined = `${commit.stdout} ${commit.stderr}`.toLowerCase();
    if (commit.exitCode !== 0 && !combined.includes("nothing to commit")) {
      throw new WorktreeError(`Could not commit in worktree: ${commit.stderr.trim()}`);
    }
  }
}
