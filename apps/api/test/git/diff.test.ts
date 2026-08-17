import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildWorkingDiff } from "../../src/git/diff.js";

let repo: string;
const roots: string[] = [];

function runGit(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

beforeEach(() => {
  repo = path.join(os.tmpdir(), `diff-fixture-${Math.random().toString(36).slice(2)}`);
  roots.push(repo);
  mkdirSync(repo, { recursive: true });
  runGit(["init", "-b", "main"], repo);
  runGit(["config", "user.email", "test@example.com"], repo);
  runGit(["config", "user.name", "Test"], repo);
  writeFileSync(path.join(repo, "a.txt"), "line1\nline2\nline3\n");
  writeFileSync(path.join(repo, "gone.txt"), "to be deleted\n");
  writeFileSync(path.join(repo, "keep.txt"), "unchanged\n");
  runGit(["add", "."], repo);
  runGit(["commit", "-m", "initial"], repo);

  writeFileSync(path.join(repo, "a.txt"), "line1\nline2-CHANGED\nline3\n");
  writeFileSync(path.join(repo, "b.txt"), "brand new\ncontent\n");
  runGit(["rm", "gone.txt"], repo);
});

afterEach(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("git working-tree diff (#33)", () => {
  it("reports modified, new, and deleted files", () => {
    const { files } = buildWorkingDiff(repo);
    const byPath = new Map(files.map((f) => [f.path, f.status]));
    expect(byPath.get("a.txt")).toBe("modified");
    expect(byPath.get("b.txt")).toBe("new");
    expect(byPath.get("gone.txt")).toBe("deleted");
  });

  it("counts additions and deletions for a modified file", () => {
    const { files } = buildWorkingDiff(repo);
    const modified = files.find((f) => f.path === "a.txt")!;
    expect(modified.additions).toBe(1);
    expect(modified.deletions).toBe(1);
  });

  it("parses hunks with typed lines", () => {
    const { files } = buildWorkingDiff(repo);
    const modified = files.find((f) => f.path === "a.txt")!;
    expect(modified.hunks.length).toBeGreaterThan(0);
    const types = modified.hunks.flatMap((h) => h.lines.map((l) => l.type));
    expect(types).toContain("del");
    expect(types).toContain("add");
  });

  it("returns an empty diff on a clean worktree", () => {
    const clean = path.join(os.tmpdir(), `diff-clean-${Math.random().toString(36).slice(2)}`);
    roots.push(clean);
    mkdirSync(clean, { recursive: true });
    runGit(["init", "-b", "main"], clean);
    runGit(["config", "user.email", "t@e.com"], clean);
    runGit(["config", "user.name", "T"], clean);
    writeFileSync(path.join(clean, "x.txt"), "x\n");
    runGit(["add", "."], clean);
    runGit(["commit", "-m", "init"], clean);
    expect(buildWorkingDiff(clean).empty).toBe(true);
  });
});
