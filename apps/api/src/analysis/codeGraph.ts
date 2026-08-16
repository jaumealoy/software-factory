import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GraphNode {
  id: string;
  kind: string;
  name: string;
  qualifiedName: string | null;
  filePath: string;
  language: string | null;
  signature: string | null;
  isExported: boolean;
}

export type GraphQueryResult =
  { available: true; nodes: GraphNode[] } | { available: false; reason: string };

export interface GraphExecutor {
  (query: string, repoPath: string): Promise<{ stdout: string; exitCode: number }>;
}

export interface QueryCodeGraphOptions {
  repoPath: string;
  limit?: number;
  executor?: GraphExecutor;
}

const GRAPH_EXECUTION_TIMEOUT_MS = 15_000;

export async function defaultGraphExecutor(
  query: string,
  repoPath: string,
): Promise<{ stdout: string; exitCode: number }> {
  const { stdout } = await execFileAsync(
    "codegraph",
    ["query", query, "--json", "-p", repoPath, "--limit", "15"],
    { timeout: GRAPH_EXECUTION_TIMEOUT_MS },
  );
  return { stdout, exitCode: 0 };
}

export async function hasCodeGraphIndex(repoPath: string): Promise<boolean> {
  return existsSync(path.join(repoPath, ".codegraph"));
}

export async function queryCodeGraph(
  query: string,
  options: QueryCodeGraphOptions,
): Promise<GraphQueryResult> {
  if (!(await hasCodeGraphIndex(options.repoPath))) {
    return {
      available: false,
      reason: `No code graph index found at ${options.repoPath} (expected ${path.join(options.repoPath, ".codegraph")}). Run \`codegraph init\` to create one.`,
    };
  }

  const executor = options.executor ?? defaultGraphExecutor;
  let stdout: string;
  try {
    const result = await executor(query, options.repoPath);
    stdout = result.stdout;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown error";
    return {
      available: false,
      reason: `Code graph query failed: ${reason}`,
    };
  }

  try {
    const parsed: unknown = JSON.parse(stdout);
    if (!Array.isArray(parsed)) {
      return { available: false, reason: "Code graph returned a non-list response" };
    }
    const nodes: GraphNode[] = parsed.flatMap((entry) => {
      const node = entry?.node;
      return node ? [normalizeNode(node)] : [];
    });
    return { available: true, nodes };
  } catch {
    return {
      available: false,
      reason: "Code graph output could not be parsed as JSON",
    };
  }
}

function normalizeNode(node: Record<string, unknown>): GraphNode {
  return {
    id: String(node.id ?? ""),
    kind: String(node.kind ?? "unknown"),
    name: String(node.name ?? ""),
    qualifiedName: node.qualifiedName != null ? String(node.qualifiedName) : null,
    filePath: String(node.filePath ?? ""),
    language: node.language != null ? String(node.language) : null,
    signature: node.signature != null ? String(node.signature) : null,
    isExported: Boolean(node.isExported),
  };
}
