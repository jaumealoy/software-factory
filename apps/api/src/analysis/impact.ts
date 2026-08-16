import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { Db } from "../db/index.js";
import { recordArtifact } from "../domain/artifacts.js";
import { getChange } from "../domain/changes.js";
import { recordEvent } from "../domain/events.js";
import { queryCodeGraph, type GraphExecutor } from "./codeGraph.js";
import {
  discoverRepository,
  type DiscoveredModule,
  type RepositoryOverrides,
} from "./discovery.js";

const execFileAsync = promisify(execFile);

export interface ImpactEvidence {
  source: "codegraph" | "discovery" | "override" | "input";
  title: string;
  entity?: string;
  detail?: string;
}

export interface ImpactManifest {
  generatedAt: string;
  repositoryName: string;
  requestedSignals: string[];
  graphUnavailable: boolean;
  graphFallbackReason: string | null;
  affectedModules: string[];
  affectedSymbols: string[];
  affectedFiles: string[];
  testSuites: string[];
  apisContracts: string[];
  dependencies: Array<{ source: string; target: string }>;
  confidence: number;
  evidence: ImpactEvidence[];
  warnings: string[];
}

export interface AnalyzeRepositoryInput {
  changeId: string;
  repositoryPath: string;
  requestSubject?: string;
  signals?: string[];
  overrides?: RepositoryOverrides;
  graphExecutor?: GraphExecutor;
  sourceRevision?: string;
}

export interface ImpactAnalysisResult {
  manifest: ImpactManifest;
  artifactId: string;
}

const CONTRACT_KINDS = new Set(["interface", "type", "class"]);

export async function analyzeRepository(
  db: Db,
  input: AnalyzeRepositoryInput,
): Promise<ImpactAnalysisResult> {
  const change = getChange(db, input.changeId);
  const repositoryRoot = path.resolve(input.repositoryPath);
  const discovery = discoverRepository(repositoryRoot, input.overrides);

  const requestedSignals = normalizeSignals(input.signals, input.requestSubject, change.title);
  const graphResults = await Promise.all(
    requestedSignals.map((signal) =>
      queryCodeGraph(signal, { repoPath: repositoryRoot, executor: input.graphExecutor }),
    ),
  );

  const evidence: ImpactEvidence[] = [];
  const affectedSymbols = new Set<string>();
  const affectedFiles = new Set<string>();
  const apisContracts = new Set<string>();
  const graphUnavailableReasons: string[] = [];
  let graphAvailable = false;

  for (const result of graphResults) {
    if (!result.available) {
      graphUnavailableReasons.push(result.reason);
      continue;
    }
    graphAvailable = true;
    for (const node of result.nodes) {
      const symbol = node.qualifiedName ?? node.name;
      if (symbol) affectedSymbols.add(symbol);
      if (node.filePath) affectedFiles.add(node.filePath);
      if (node.isExported && CONTRACT_KINDS.has(node.kind) && symbol) {
        apisContracts.add(symbol);
      }
      evidence.push({
        source: "codegraph",
        title: symbol,
        entity: node.filePath,
        detail: node.kind,
      });
    }
  }

  const affectedModules = new Set<string>();
  for (const file of affectedFiles) {
    const module = moduleContaining(file, discovery.modules);
    if (module) {
      affectedModules.add(module.path);
      evidence.push({
        source: "codegraph",
        title: "Affected module",
        entity: module.path,
        detail: file,
      });
    }
  }
  for (const app of discovery.modules.filter((module) => module.kind === "application")) {
    affectedModules.add(app.path);
    evidence.push({
      source: "discovery",
      title: "Discovered application",
      entity: app.path,
      detail: `role=${appRole(app.name) ?? "unknown"}`,
    });
  }
  if (input.overrides?.applications) {
    evidence.push({
      source: "override",
      title: "Developer overrides applied",
      entity: input.overrides.applications.map((app) => app.path).join(", "),
    });
  }

  const testSuites = [
    ...new Set([
      ...discovery.testDirectories,
      ...inferAdjacentTestDirectories(affectedFiles, discovery.testDirectories),
    ]),
  ].sort();

  const manifest: ImpactManifest = {
    generatedAt: new Date().toISOString(),
    repositoryName: path.basename(repositoryRoot),
    requestedSignals,
    graphUnavailable: !graphAvailable,
    graphFallbackReason: graphAvailable ? null : (graphUnavailableReasons[0] ?? null),
    affectedModules: [...affectedModules].sort(),
    affectedSymbols: [...affectedSymbols].sort(),
    affectedFiles: [...affectedFiles].sort(),
    testSuites,
    apisContracts: [...apisContracts].sort(),
    dependencies: moduleDependencies([...affectedModules]),
    confidence: computeConfidence(graphAvailable, affectedSymbols.size, Boolean(input.overrides)),
    evidence: withFallbackEvidence(evidence, graphAvailable, graphUnavailableReasons),
    warnings: [...discovery.warnings, ...graphUnavailableReasons],
  };

  const artifact = recordArtifact(db, {
    changeId: input.changeId,
    kind: "impact_manifest",
    path: repositoryRoot,
    summary: `Impact manifest for "${change.title}"`,
    uri: `impact://changes/${input.changeId}/impact-manifest`,
    sourceRevision: input.sourceRevision ?? (await currentRevision(repositoryRoot)),
    validationResult: JSON.stringify(manifest),
  });

  recordEvent(db, {
    entityType: "change",
    entityId: input.changeId,
    eventType: "analysis.impact_completed",
    payload: {
      artifactId: artifact.id,
      confidence: manifest.confidence,
      graphUnavailable: !graphAvailable,
      signalCount: requestedSignals.length,
    },
  });

  return { manifest, artifactId: artifact.id };
}

function withFallbackEvidence(
  evidence: ImpactEvidence[],
  graphAvailable: boolean,
  reasons: string[],
): ImpactEvidence[] {
  if (graphAvailable) return evidence;
  return [
    ...evidence,
    {
      source: "codegraph",
      title: "Code graph unavailable — discovery fallback",
      detail: reasons[0] ?? "No code graph index",
    },
  ];
}

function normalizeSignals(
  signals: string[] | undefined,
  subject: string | undefined,
  changeTitle: string,
): string[] {
  const values = (signals ?? []).map((signal) => signal.trim()).filter((value) => value.length > 0);
  if (values.length > 0) return [...new Set(values)];
  const candidate = (subject ?? changeTitle).trim();
  return candidate ? [candidate] : ["project"];
}

function moduleContaining(file: string, modules: DiscoveredModule[]): DiscoveredModule | null {
  const normalized = file.replace(/\\/g, "/");
  let best: DiscoveredModule | null = null;
  for (const module of modules) {
    const prefix = module.path.replace(/\\/g, "/");
    if (normalized.startsWith(`${prefix}/`)) {
      if (!best || prefix.length > best.path.length) {
        best = module;
      }
    }
  }
  return best;
}

function appRole(moduleName: string): string | null {
  const lower = moduleName.toLowerCase();
  if (/(web|frontend|front-end|ui|dashboard|client)/.test(lower)) return "frontend";
  if (/(api|backend|server)/.test(lower)) return "backend";
  if (/(worker|queue|jobs|cron)/.test(lower)) return "worker";
  return null;
}

function adjacentTestSuites(file: string, testDirectories: string[]): string[] {
  const dir = path.posix.dirname(file);
  return testDirectories.filter((testDir) => dir.startsWith(testDir.replace(/\\/g, "/")));
}

function moduleDependencies(modules: string[]): Array<{ source: string; target: string }> {
  const dependencies: Array<{ source: string; target: string }> = [];
  for (const source of modules) {
    for (const target of modules) {
      if (source !== target) {
        dependencies.push({ source, target });
      }
    }
  }
  return dependencies;
}

function computeConfidence(
  graphAvailable: boolean,
  symbolCount: number,
  hasOverrides: boolean,
): number {
  if (!graphAvailable) return 0.3;
  const base = symbolCount > 0 ? 0.85 : 0.6;
  return hasOverrides ? Math.min(0.95, base + 0.05) : base;
}

async function currentRevision(repositoryRoot: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: repositoryRoot,
      timeout: 5000,
    });
    return stdout.trim();
  } catch {
    return undefined;
  }
}

function inferAdjacentTestDirectories(
  affectedFiles: Set<string>,
  testDirectories: string[],
): string[] {
  const result = new Set<string>();
  for (const file of affectedFiles) {
    for (const suite of adjacentTestSuites(file, testDirectories)) {
      result.add(suite);
    }
  }
  return [...result];
}
