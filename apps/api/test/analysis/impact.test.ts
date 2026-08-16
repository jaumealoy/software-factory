import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { analyzeRepository } from "../../src/analysis/impact.js";
import type { GraphExecutor } from "../../src/analysis/codeGraph.js";
import { createTestChange, createTestContext, createTestProject } from "../helpers.js";

let fixtureRoot: string;

beforeEach(() => {
  fixtureRoot = path.join(os.tmpdir(), `impact-${Math.random().toString(36).slice(2)}`);
  mkdirSync(fixtureRoot, { recursive: true });
});

afterEach(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

function writeTree(root: string, files: Record<string, string>): void {
  for (const [relative, content] of Object.entries(files)) {
    const filePath = path.join(root, relative);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
  }
}

function makeFixture(includeGraphIndex = false): void {
  const files: Record<string, string> = {
    "pnpm-lock.yaml": "",
    "apps/api/src/server.ts": "export interface ApiContract {}",
    "apps/api/src/server.test.ts": "test('api')",
    "apps/web/src/page.ts": "export const page = true;",
    "tests/unit/api.test.ts": "test('x')",
  };
  if (includeGraphIndex) {
    files[".codegraph/codegraph.db"] = "";
  }
  writeTree(fixtureRoot, files);
}

const graphExecutor: GraphExecutor = async () => ({
  exitCode: 0,
  stdout: JSON.stringify([
    {
      node: {
        id: "n1",
        kind: "function",
        name: "fetchContract",
        qualifiedName: "api.fetchContract",
        filePath: "apps/api/src/server.ts",
        language: "typescript",
        signature: undefined,
        isExported: true,
      },
      score: 90,
    },
    {
      node: {
        id: "n2",
        kind: "interface",
        name: "ApiContract",
        qualifiedName: "api.ApiContract",
        filePath: "apps/api/src/server.ts",
        language: "typescript",
        signature: undefined,
        isExported: true,
      },
      score: 80,
    },
  ]),
});

describe("impact analysis", () => {
  it("produces and persists a manifest with traceable evidence", async () => {
    const { store, db } = createTestContext();
    const { projectId } = await createTestProject(store);
    const { changeId } = await createTestChange(store, projectId);
    makeFixture(true);

    const result = await analyzeRepository(db, {
      changeId,
      repositoryPath: fixtureRoot,
      signals: ["contract"],
      graphExecutor,
    });

    expect(result.manifest.graphUnavailable).toBe(false);
    expect(result.manifest.affectedSymbols).toContain("api.fetchContract");
    expect(result.manifest.affectedModules).toContain("apps/api");
    expect(result.manifest.apisContracts).toContain("api.ApiContract");
    expect(result.manifest.confidence).toBeGreaterThan(0.8);
    expect(
      result.manifest.evidence.some(
        (row) => row.source === "codegraph" && row.entity === "apps/api/src/server.ts",
      ),
    ).toBe(true);

    const artifacts = await store.listArtifacts({ changeId });
    const manifestArtifact = artifacts.find((artifact) => artifact.kind === "impact_manifest");
    expect(manifestArtifact).toBeDefined();
    expect(result.artifactId).toBe(manifestArtifact?.id);
    const stored = JSON.parse(manifestArtifact?.validationResult ?? "{}");
    expect(stored.generatedAt).toBeDefined();
  });

  it("falls back explicitly when the code graph is unavailable", async () => {
    const context = createTestContext();
    const { projectId } = await createTestProject(context.store);
    const { changeId } = await createTestChange(context.store, projectId);
    makeFixture(); // no .codegraph directory

    const result = await analyzeRepository(context.db, {
      changeId,
      repositoryPath: fixtureRoot,
      signals: ["contract"],
    });

    expect(result.manifest.graphUnavailable).toBe(true);
    expect(result.manifest.graphFallbackReason).toMatch(/no code graph index/i);
    expect(result.manifest.confidence).toBeLessThan(0.5);
    expect(result.manifest.evidence.some((row) => /unavailable/i.test(row.title))).toBe(true);
    expect(result.manifest.warnings.some((warning) => /no code graph index/i.test(warning))).toBe(
      true,
    );
  });

  it("records developer overrides as evidence", async () => {
    const context = createTestContext();
    const { projectId } = await createTestProject(context.store);
    const { changeId } = await createTestChange(context.store, projectId);
    makeFixture(true);

    const result = await analyzeRepository(context.db, {
      changeId,
      repositoryPath: fixtureRoot,
      signals: ["contract"],
      graphExecutor,
      overrides: {
        applications: [{ name: "api", path: "apps/api", role: "backend", hasTests: true }],
      },
    });

    expect(result.manifest.evidence.some((row) => row.source === "override")).toBe(true);
    expect(result.manifest.affectedModules).toContain("apps/api");
  });
});
