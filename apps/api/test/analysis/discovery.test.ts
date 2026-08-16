import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverRepository, type RepositoryOverrides } from "../../src/analysis/discovery.js";

let fixtureRoot: string;

beforeEach(() => {
  fixtureRoot = fsMkdtempSync();
});

afterEach(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

function fsMkdtempSync(): string {
  const dir = path.join(os.tmpdir(), `discovery-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeTree(files: Record<string, string>): void {
  for (const [relative, content] of Object.entries(files)) {
    const filePath = path.join(fixtureRoot, relative);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
  }
}

describe("repository discovery", () => {
  it("detects applications, packages, test locations, and metadata", () => {
    writeTree({
      "pnpm-lock.yaml": "",
      "package.json": '{"name":"fixture","workspaces":["apps/*"]}',
      "apps/api/src/server.ts": "export const api = true;",
      "apps/api/src/server.test.ts": "import { api } from './server.js';",
      "apps/web/src/ui.tsx": "export const ui = true;",
      "packages/shared/src/lib.ts": "export const lib = true;",
      "tests/unit/model.test.ts": "test('x', () => {})",
    });

    const discovery = discoverRepository(fixtureRoot);

    expect(discovery.packageManagers).toContain("pnpm");
    expect(discovery.languageHints).toEqual(expect.arrayContaining(["typescript"]));
    expect(discovery.hasTests).toBe(true);
    expect(discovery.testDirectories).toContain("tests");

    const applications = discovery.modules.filter((module) => module.kind === "application");
    const api = applications.find((module) => module.name === "api");
    expect(api?.path).toBe("apps/api");
    const backend = applications.find((module) => module.name.toLowerCase().includes("api"));
    expect(backend).toBeDefined();

    expect(discovery.modules.some((module) => module.path === "packages/shared")).toBe(true);
  });

  it("applies developer overrides for application structure", () => {
    writeTree({ "apps/api/src/main.ts": "export {};" });
    const overrides: RepositoryOverrides = {
      applications: [
        { name: "api", path: "apps/api", role: "backend", hasTests: false },
        { name: "custom", path: "apps/custom", role: "frontend", hasTests: true },
      ],
    };

    const discovery = discoverRepository(fixtureRoot, overrides);
    expect(discovery.applications.map((app) => app.path)).toEqual(["apps/api", "apps/custom"]);
  });

  it("honors ignorePaths when discovering modules", () => {
    writeTree({
      "apps/api/src/main.ts": "export {};",
      "apps/web/src/main.ts": "export {};",
    });

    const discovery = discoverRepository(fixtureRoot, { ignorePaths: ["apps/web"] });
    expect(discovery.modules.map((module) => module.path)).not.toContain("apps/web");
    expect(discovery.modules.map((module) => module.path)).toContain("apps/api");
  });

  it("treats a repository root with src/ as a single application", () => {
    writeTree({ "src/main.ts": "export {};", "src/main.test.ts": "test('x')" });
    const discovery = discoverRepository(fixtureRoot);
    expect(discovery.applications).toHaveLength(1);
    expect(discovery.applications[0]?.path).toBe(".");
    expect(discovery.warnings.some((warning) => /single application/.test(warning))).toBe(true);
  });

  it("throws when the repository path does not exist", () => {
    expect(() => discoverRepository(path.join(fixtureRoot, "missing"))).toThrow(/does not exist/);
  });
});
