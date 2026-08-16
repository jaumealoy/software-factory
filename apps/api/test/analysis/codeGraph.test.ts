import { mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { queryCodeGraph, type GraphExecutor } from "../../src/analysis/codeGraph.js";

let fixtureRoot: string;

beforeEach(() => {
  fixtureRoot = path.join(os.tmpdir(), `graph-${Math.random().toString(36).slice(2)}`);
  mkdirSync(fixtureRoot, { recursive: true });
});

afterEach(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

describe("code graph adapter", () => {
  it("declares the graph unavailable when no index exists", async () => {
    const result = await queryCodeGraph("greet", { repoPath: fixtureRoot });
    expect(result.available).toBe(false);
    if (!result.available) {
      expect(result.reason).toMatch(/no code graph index/i);
    }
  });

  it("normalizes graph results from a JSON executor", async () => {
    mkdirSync(path.join(fixtureRoot, ".codegraph"), { recursive: true });
    const executor: GraphExecutor = async () => ({
      exitCode: 0,
      stdout: JSON.stringify([
        {
          node: {
            id: "function:1",
            kind: "function",
            name: "greet",
            qualifiedName: "lib.greet",
            filePath: "src/lib.ts",
            language: "typescript",
            startLine: 1,
            endLine: 3,
            signature: "(name: string): string",
            isExported: true,
          },
          score: 90,
        },
      ]),
    });

    const result = await queryCodeGraph("greet", { repoPath: fixtureRoot, executor });
    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0]?.kind).toBe("function");
      expect(result.nodes[0]?.qualifiedName).toBe("lib.greet");
      expect(result.nodes[0]?.isExported).toBe(true);
    }
  });

  it("degrades when the executor output is not JSON", async () => {
    mkdirSync(path.join(fixtureRoot, ".codegraph"), { recursive: true });
    const executor: GraphExecutor = async () => ({ stdout: "No relevant code found", exitCode: 0 });

    const result = await queryCodeGraph("greet", { repoPath: fixtureRoot, executor });
    expect(result.available).toBe(false);
    if (!result.available) {
      expect(result.reason).toMatch(/could not be parsed/i);
    }
  });

  it("degrades when the executor throws", async () => {
    mkdirSync(path.join(fixtureRoot, ".codegraph"), { recursive: true });
    const executor: GraphExecutor = async () => {
      throw new Error("codegraph: command not found");
    };

    const result = await queryCodeGraph("greet", { repoPath: fixtureRoot, executor });
    expect(result.available).toBe(false);
    if (!result.available) {
      expect(result.reason).toMatch(/failed/i);
    }
  });
});
