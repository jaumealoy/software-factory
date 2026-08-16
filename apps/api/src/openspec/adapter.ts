import { execFile } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { Db } from "../db/index.js";
import { recordArtifact } from "../domain/artifacts.js";
import { recordEvent } from "../domain/events.js";
import { ValidationError } from "../domain/errors.js";
import {
  OpenSpecCommandError,
  OpenSpecConfigurationError,
  OpenSpecValidationFailedError,
} from "./errors.js";
import {
  renderDesignMarkdown,
  renderProposalMarkdown,
  renderSpecMarkdown,
  renderTasksMarkdown,
} from "./render.js";
import type {
  CreateOpenSpecChangeInput,
  OpenSpecChangeRecord,
  OpenSpecChangeResult,
  OpenSpecIssue,
  OpenSpecPreflight,
  OpenSpecValidationResult,
} from "./types.js";

const execFileAsync = promisify(execFile);

/** Resolves the OpenSpec root inside a repository (MVP 1: repo-local only). */
export function openspecRoot(repoPath: string): string {
  return path.join(path.resolve(repoPath), "openspec");
}

export function preflightOpenSpec(repoPath: string): OpenSpecPreflight {
  const root = openspecRoot(repoPath);
  const configPath = path.join(root, "config.yaml");
  const configured = existsSync(configPath);
  return { configured, openspecRoot: root, configPath };
}

export function changeRootFor(repoPath: string, name: string): string {
  return path.join(openspecRoot(repoPath), "changes", name);
}

function kebabCaseName(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!/^[a-z][a-z0-9-]*$/.test(normalized)) {
    throw new ValidationError(`Invalid change name "${name}"; expected kebab-case`);
  }
  return normalized;
}

async function runCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await execFileAsync(command, args, { cwd, timeout: 20_000 });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; code?: number };
    return { stdout: err.stdout ?? "", stderr: err.stderr ?? "", exitCode: err.code ?? 1 };
  }
}

export async function validateOpenSpecChange(
  repoPath: string,
  name: string,
): Promise<OpenSpecValidationResult> {
  const result = await runCommand("openspec", ["validate", name, "--json"], repoPath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout || "{}");
  } catch {
    return {
      valid: false,
      issues: [{ level: "ERROR", path: null, message: "OpenSpec returned an unparseable result" }],
      durationMs: 0,
    };
  }

  const envelope = parsed as { status?: unknown; items?: unknown };
  if (envelope.status !== undefined) {
    const message = (envelope.status as Array<{ message?: string }>)
      .map((entry) => entry.message)
      .join("; ");
    throw new OpenSpecCommandError(
      "openspec validate",
      message || "Validation failed",
      result.stderr,
    );
  }

  const items =
    (
      parsed as {
        items?: Array<{ valid?: boolean; issues?: unknown[]; durationMs?: number }>;
      }
    ).items ?? [];
  const issues: OpenSpecIssue[] = [];
  let valid = true;
  for (const item of items) {
    if (item.valid === false) valid = false;
    for (const issue of (item.issues as Array<Record<string, unknown>> | undefined) ?? []) {
      issues.push({
        level: issue.level === "WARN" ? "WARN" : "ERROR",
        path: typeof issue.path === "string" ? issue.path : null,
        message: String(issue.message ?? ""),
      });
    }
  }
  return { valid, issues, durationMs: items[0]?.durationMs ?? 0 };
}

export async function changeStatusOpenSpec(repoPath: string, name: string): Promise<unknown> {
  const result = await runCommand("openspec", ["status", "--change", name, "--json"], repoPath);
  if (result.exitCode !== 0) {
    throw new OpenSpecCommandError(
      "openspec status",
      result.stderr || "Status failed",
      result.stderr,
    );
  }
  return JSON.parse(result.stdout || "{}");
}

function artifactRecords(
  name: string,
  artifacts: CreateOpenSpecChangeInput["artifacts"],
): OpenSpecChangeRecord[] {
  const records: OpenSpecChangeRecord[] = [];
  records.push({
    kind: "openspec_proposal",
    relativePath: path.join("proposal.md"),
    content: renderProposalMarkdown(artifacts.proposal),
  });
  records.push({
    kind: "openspec_design",
    relativePath: path.join("design.md"),
    content: renderDesignMarkdown(artifacts.design),
  });
  for (const capability of artifacts.specs) {
    records.push({
      kind: "openspec_spec",
      relativePath: path.join("specs", capability.name, "spec.md"),
      content: renderSpecMarkdown(capability),
    });
  }
  records.push({
    kind: "openspec_tasks",
    relativePath: path.join("tasks.md"),
    content: renderTasksMarkdown(artifacts.tasks),
  });
  return records;
}

/** Generates, writes, validates, and persists an OpenSpec change. */
export async function createOpenSpecChange(
  db: Db,
  input: CreateOpenSpecChangeInput,
): Promise<OpenSpecChangeResult> {
  const name = kebabCaseName(input.name);
  const repoPath = path.resolve(input.repoPath);

  const preflight = preflightOpenSpec(repoPath);
  if (!preflight.configured && !input.autoInit) {
    throw new OpenSpecConfigurationError(
      `OpenSpec is not configured at ${preflight.openspecRoot} (missing ${preflight.configPath}). Configure the repository first or pass autoInit: true.`,
    );
  }

  const scaffold = await runCommand("openspec", ["new", "change", name], repoPath);
  if (scaffold.exitCode !== 0) {
    throw new OpenSpecCommandError(
      "openspec new change",
      `Failed to create OpenSpec change "${name}": ${scaffold.stderr}`,
      scaffold.stderr,
    );
  }

  const changeRoot = changeRootFor(repoPath, name);
  const records = artifactRecords(name, input.artifacts);
  for (const record of records) {
    const target = path.join(changeRoot, record.relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, record.content);
  }

  const validation = await validateOpenSpecChange(repoPath, name);
  for (const record of records) {
    recordArtifact(db, {
      changeId: input.changeId,
      kind: record.kind,
      path: path.join(changeRoot, record.relativePath),
      sourceRevision: input.sourceRevision,
      validationResult: validation.valid ? `valid` : `invalid: ${validation.issues.length}`,
    });
  }

  recordEvent(db, {
    entityType: "change",
    entityId: input.changeId,
    eventType: "openspec.change_created",
    payload: {
      name,
      changeRoot,
      valid: validation.valid,
      issueCount: validation.issues.length,
    },
  });

  if (!validation.valid) {
    throw new OpenSpecValidationFailedError(
      validation.issues,
      `OpenSpec validation failed for "${name}": ${
        validation.issues.map((issue) => issue.message).join("; ") || "unknown validation error"
      }`,
    );
  }

  return { name, changeRoot, validation };
}
