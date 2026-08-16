import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DomainError } from "../domain/errors.js";

const execFileAsync = promisify(execFile);

export interface IssueInfo {
  number: number;
  url: string;
}

export interface CreateIssueInput {
  repoFullName: string;
  title: string;
  body: string;
  labels?: string[];
}

export interface EditIssueInput {
  repoFullName: string;
  number: number;
  title: string;
  body: string;
}

export interface IssueExecutor {
  createIssue(input: CreateIssueInput): Promise<IssueInfo>;
  editIssue(input: EditIssueInput): Promise<IssueInfo>;
}

export class GitHubIssueError extends DomainError {
  constructor(
    readonly command: string,
    message: string,
    readonly stderr: string,
  ) {
    super(message);
    this.name = "GitHubIssueError";
  }
}

export function parseRepoFullName(repositoryUrl: string): string {
  const normalized = repositoryUrl.trim();
  const httpsMatch = normalized.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (httpsMatch) {
    return `${httpsMatch[1]}/${httpsMatch[2]}`.replace(/\.git$/, "");
  }
  const sshMatch = /(?:git@github\.com:)([^/]+)\/([^/]+?)(?:\.git)?$/.exec(normalized);
  if (sshMatch) {
    return `${sshMatch[1]}/${sshMatch[2]}`.replace(/\.git$/, "");
  }
  throw new DomainError(`Unsupported GitHub repository URL: "${repositoryUrl}"`);
}

function parseIssueNumber(stdout: string): { number: number; url: string | null } {
  const trimmed = stdout.trim();
  if (/^\d+$/.test(trimmed)) {
    return { number: Number(trimmed), url: null };
  }
  const match = /\/issues\/(\d+)/.exec(trimmed);
  if (match) {
    const url = trimmed.includes("github.com") ? trimmed : null;
    return { number: Number(match[1]), url };
  }
  throw new DomainError(`Unrecognized GitHub issue reference "${trimmed}"`);
}

function toIssueInfo(
  repoFullName: string,
  parsed: { number: number; url: string | null },
): IssueInfo {
  return {
    number: parsed.number,
    url: parsed.url ?? `https://github.com/${repoFullName}/issues/${parsed.number}`,
  };
}

type GhRunResult = { stdout: string; stderr: string; exitCode: number };

async function defaultGhRunner(args: string[]): Promise<GhRunResult> {
  try {
    const result = await execFileAsync("gh", args, { timeout: 20_000 });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; code?: number };
    return { stdout: err.stdout ?? "", stderr: err.stderr ?? "", exitCode: err.code ?? 1 };
  }
}

export class GitHubCliExecutor implements IssueExecutor {
  constructor(
    private readonly userRun: (args: string[]) => Promise<GhRunResult> = defaultGhRunner,
  ) {}

  async createIssue(input: CreateIssueInput): Promise<IssueInfo> {
    const args = ["issue", "create", "--repo", input.repoFullName, "--title", input.title];
    for (const label of input.labels ?? []) {
      args.push("--label", label);
    }
    args.push("--body", input.body);

    const result = await this.userRun(args);
    if (result.exitCode !== 0) {
      throw new GitHubIssueError(
        "gh issue create",
        `gh issue create failed: ${result.stderr.trim() || "unknown error"}`,
        result.stderr,
      );
    }
    return toIssueInfo(input.repoFullName, parseIssueNumber(result.stdout));
  }

  async editIssue(input: EditIssueInput): Promise<IssueInfo> {
    const result = await this.userRun([
      "issue",
      "edit",
      String(input.number),
      "--repo",
      input.repoFullName,
      "--title",
      input.title,
      "--body",
      input.body,
    ]);
    if (result.exitCode !== 0) {
      throw new GitHubIssueError(
        "gh",
        `gh issue edit failed: ${result.stderr.trim() || "unknown error"}`,
        result.stderr,
      );
    }
    return toIssueInfo(
      input.repoFullName,
      parseIssueNumber(result.stdout.trim() || String(input.number)),
    );
  }
}
