import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { promisify } from "node:util";
import {
  changeRootFor,
  createOpenSpecChange,
  preflightOpenSpec,
  validateOpenSpecChange,
} from "../../src/openspec/adapter.js";
import {
  OpenSpecConfigurationError,
  OpenSpecValidationFailedError,
} from "../../src/openspec/errors.js";
import {
  renderDesignMarkdown,
  renderProposalMarkdown,
  renderSpecMarkdown,
  renderTasksMarkdown,
} from "../../src/openspec/render.js";
import type { OpenSpecChangeArtifacts } from "../../src/openspec/types.js";
import { createTestChange, createTestContext, createTestProject } from "../helpers.js";

const execFileAsync = promisify(execFile);
const tmpRoots: string[] = [];

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeFixture(dirName: string, configured = true): string {
  const root = mkdtempSync(path.join(os.tmpdir(), `ops-fixture-${dirName}-`));
  tmpRoots.push(root);
  mkdirSync(path.join(root, "openspec"), { recursive: true });
  if (configured) {
    writeFileSync(path.join(root, "openspec", "config.yaml"), "schema: spec-driven\n");
  }
  return root;
}

async function openspecAvailable(): Promise<boolean> {
  try {
    await execFileAsync("openspec", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

const sampleCapability: OpenSpecChangeArtifacts["specs"][number] = {
  name: "user-auth",
  requirements: [
    {
      name: "User can sign in with Google",
      text: "The system SHALL authenticate users via Google OAuth.",
      scenarios: [
        {
          scenario: "Successful sign-in",
          when: "a user chooses Google as their provider",
          then: "the system creates a session and redirects to the dashboard",
        },
      ],
    },
  ],
};

function sampleArtifacts(): OpenSpecChangeArtifacts {
  return {
    proposal: {
      why: "Users need a way to sign in with their Google account.",
      whatChanges: ["Add Google OAuth provider to the dashboard."],
      newCapabilities: [{ name: "user-auth", description: "Google OAuth sign-in" }],
      modifiedCapabilities: [],
      impact: ["apps/web", "apps/api"],
    },
    design: {
      context: ["The dashboard is a Fastify + React app."],
      goals: ["Single provider for now."],
      nonGoals: ["Multi-provider federation."],
      decisions: ["Use openid-client."],
      risks: ["Token expiry handling"],
    },
    specs: [sampleCapability],
    tasks: [{ group: "Authentication", items: ["Implement provider adapter", "Add routes"] }],
  };
}

describe("OpenSpec markdown renderers", () => {
  it("renders the proposal sections", () => {
    const markdown = renderProposalMarkdown(sampleArtifacts().proposal);
    expect(markdown).toContain("## Why");
    expect(markdown).toContain("## What Changes");
    expect(markdown).toContain("### New Capabilities");
    expect(markdown).toContain("- `user-auth`: Google OAuth sign-in");
  });

  it("renders spec deltas with requirements and scenarios", () => {
    const markdown = renderSpecMarkdown(sampleCapability);
    expect(markdown).toContain("## ADDED Requirements");
    expect(markdown).toContain("### Requirement: User can sign in with Google");
    expect(markdown).toContain("#### Scenario: Successful sign-in");
    expect(markdown).toContain("- **WHEN** a user chooses Google as their provider");
    expect(markdown).toContain(
      "- **THEN** the system creates a session and redirects to the dashboard",
    );
  });

  it("renders proposal capabilities with backticks", () => {
    const markdown = renderProposalMarkdown(sampleArtifacts().proposal);
    expect(markdown).toContain("- `user-auth`: Google OAuth sign-in");
  });

  it("renders task checkboxes in numbered groups", () => {
    const markdown = renderTasksMarkdown(sampleArtifacts().tasks);
    expect(markdown).toContain("## 1. Authentication");
    expect(markdown).toContain("- [ ] 1.1 Implement provider adapter");
    expect(markdown).toContain("- [ ] 1.2 Add routes");
  });

  it("renders design decisions and risks", () => {
    const markdown = renderDesignMarkdown(sampleArtifacts().design);
    expect(markdown).toContain("## Goals / Non-Goals");
    expect(markdown).toContain("**Non-Goals:**");
    expect(markdown).toContain("## Decisions");
    expect(markdown).toContain("## Risks / Trade-offs");
  });
});

describe("OpenSpec preflight", () => {
  it("reports unconfigured repositories", () => {
    const root = makeFixture("unconfigured", false);
    const preflight = preflightOpenSpec(root);
    expect(preflight.configured).toBe(false);
  });

  it("reports configured repositories", () => {
    const root = makeFixture("configured");
    const preflight = preflightOpenSpec(root);
    expect(preflight.configured).toBe(true);
    expect(preflight.configPath).toBe(path.join(root, "openspec", "config.yaml"));
  });
});

const describeIntegration = (await openspecAvailable()) ? describe : describe.skip;

describeIntegration("OpenSpec adapter (CLI)", () => {
  it("creates, validates, and persists a complete change", async () => {
    const context = createTestContext();
    const { projectId } = await createTestProject(context.store);
    const change = await createTestChange(context.store, projectId);
    const root = makeFixture("complete");
    const changeId = change.changeId;

    const result = await createOpenSpecChange(context.db, {
      changeId,
      repoPath: root,
      name: "add-google-auth",
      artifacts: sampleArtifacts(),
    });

    expect(result.name).toBe("add-google-auth");
    expect(result.validation.valid).toBe(true);
    expect(result.validation.issues).toHaveLength(0);

    const changeRoot = changeRootFor(root, "add-google-auth");
    expect(existsSync(path.join(changeRoot, "proposal.md"))).toBe(true);
    expect(existsSync(path.join(changeRoot, "design.md"))).toBe(true);
    expect(existsSync(path.join(changeRoot, "tasks.md"))).toBe(true);
    expect(existsSync(path.join(changeRoot, "specs", "user-auth", "spec.md"))).toBe(true);

    const artifacts = await context.store.listArtifacts({ changeId });
    expect(artifacts.map((artifact) => artifact.kind)).toEqual(
      expect.arrayContaining([
        "openspec_proposal",
        "openspec_design",
        "openspec_spec",
        "openspec_tasks",
      ]),
    );

    const validation = await validateOpenSpecChange(root, "add-google-auth");
    expect(validation.valid).toBe(true);
  });

  it("rejects changes whose generated spec is invalid", async () => {
    const context = createTestContext();
    const { projectId } = await createTestProject(context.store);
    const change = await createTestChange(context.store, projectId);
    const root = makeFixture("invalid");

    const artifacts = sampleArtifacts();
    artifacts.specs = [
      {
        name: "bad-capability",
        requirements: [
          {
            name: "Requirement without scenario",
            text: "This requirement is missing a scenario.",
            scenarios: [],
          },
        ],
      },
    ];

    await expect(
      createOpenSpecChange(context.db, {
        changeId: change.changeId,
        repoPath: root,
        name: "invalid-change",
        artifacts,
      }),
    ).rejects.toBeInstanceOf(OpenSpecValidationFailedError);
  });

  it("surfaces missing OpenSpec configuration", async () => {
    const context = createTestContext();
    const { projectId } = await createTestProject(context.store);
    const change = await createTestChange(context.store, projectId);
    const root = makeFixture("no-config", false);

    await expect(
      createOpenSpecChange(context.db, {
        changeId: change.changeId,
        repoPath: root,
        name: "no-config",
        artifacts: sampleArtifacts(),
      }),
    ).rejects.toBeInstanceOf(OpenSpecConfigurationError);
  });

  it("auto-initializes the OpenSpec config when allowed", async () => {
    const context = createTestContext();
    const { projectId } = await createTestProject(context.store);
    const change = await createTestChange(context.store, projectId);
    const root = makeFixture("auto-init", false);

    const result = await createOpenSpecChange(context.db, {
      changeId: change.changeId,
      repoPath: root,
      name: "auto-initialized",
      artifacts: sampleArtifacts(),
      autoInit: true,
    });
    expect(result.validation.valid).toBe(true);
    expect(existsSync(path.join(root, "openspec", "config.yaml"))).toBe(true);
  });
});
