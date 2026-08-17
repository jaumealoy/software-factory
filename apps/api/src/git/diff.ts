import { execFileSync } from "node:child_process";
import { ValidationError } from "../domain/errors.js";

export type DiffStatus = "modified" | "new" | "deleted";

export interface DiffLine {
  type: "add" | "del" | "ctx";
  text: string;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffFile {
  path: string;
  status: DiffStatus;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

export interface WorkingDiff {
  files: DiffFile[];
  empty: boolean;
}

function runGit(root: string, args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  } catch (error) {
    const err = error as { message?: string; status?: number };
    throw new ValidationError(`git command failed in ${root}: ${err.message ?? "unknown error"}`);
  }
}

interface PorcelainEntry {
  path: string;
  status: DiffStatus;
}

/** Parses `git status --porcelain` worktree entries (vs HEAD): M/D/A/R files and ?? untracked. */
function parseStatus(root: string): PorcelainEntry[] {
  const raw = runGit(root, ["status", "--porcelain"]);
  const entries: PorcelainEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    const statusChar = line[0];
    const path = line.slice(3);
    const baseStatus = statusChar ?? "?";
    let status: DiffStatus;
    if (baseStatus === "?") {
      status = "new";
    } else if (baseStatus === "D") {
      status = "deleted";
    } else {
      status = "modified";
    }
    if (path) {
      entries.push({ path, status });
    }
  }
  return entries;
}

function parseUnifiedDiff(text: string, explicitStatus: DiffStatus): DiffFile {
  const hunks: DiffHunk[] = [];
  let additions = 0;
  let deletions = 0;
  let current: DiffHunk | null = null;

  for (const line of text.split("\n")) {
    if (line.startsWith("@@")) {
      current = { header: line, lines: [] };
      hunks.push(current);
      continue;
    }
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || !current) {
      continue;
    }
    const type: DiffLine["type"] = line.startsWith("+")
      ? "add"
      : line.startsWith("-")
        ? "del"
        : "ctx";
    if (type === "add") additions += 1;
    if (type === "del") deletions += 1;
    current.lines.push({ type, text: line.slice(1) });
  }

  const status: DiffStatus =
    explicitStatus === "deleted" ? "deleted" : explicitStatus === "new" ? "new" : "modified";
  return { path: "", status, additions, deletions, hunks };
}

/** Returns the working-tree diff against the last commit for the repository at `root`. */
export function buildWorkingDiff(root: string): WorkingDiff {
  const statuses = parseStatus(root);
  const files: DiffFile[] = [];

  for (const entry of statuses) {
    if (entry.status === "new") {
      files.push({
        path: entry.path,
        status: "new",
        additions: 0,
        deletions: 0,
        hunks: [{ header: "new file", lines: [] }],
      });
      continue;
    }
    const text = runGit(root, ["diff", "--no-color", "--unified=3", "HEAD", "--", entry.path]);
    const parsed = parseUnifiedDiff(text, entry.status);
    parsed.path = entry.path;
    files.push(parsed);
  }

  return { files, empty: files.length === 0 };
}
