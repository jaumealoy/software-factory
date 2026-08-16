import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export interface DiscoveredApplication {
  name: string;
  path: string;
  role: string | null;
  hasTests: boolean;
}

export interface DiscoveredModule {
  name: string;
  path: string;
  kind: "application" | "package";
}

export interface RepositoryDiscovery {
  root: string;
  languageHints: string[];
  packageManagers: string[];
  hasTests: boolean;
  testDirectories: string[];
  applications: DiscoveredApplication[];
  modules: DiscoveredModule[];
  warnings: string[];
}

export interface RepositoryOverrides {
  applications?: DiscoveredApplication[];
  testDirectories?: string[];
  ignorePaths?: string[];
}

const CONTAINER_DIRECTORIES = ["apps", "packages", "services", "libs", "modules"] as const;
const TEST_DIRECTORY_NAMES = new Set(["test", "tests", "__tests__", "spec", "specs", "e2e"]);

const PACKAGE_MANAGER_MANIFESTS: Array<{ file: string; name: string }> = [
  { file: "pnpm-lock.yaml", name: "pnpm" },
  { file: "package-lock.json", name: "npm" },
  { file: "yarn.lock", name: "yarn" },
  { file: "bun.lockb", name: "bun" },
  { file: "go.mod", name: "go mod" },
  { file: "Cargo.toml", name: "cargo" },
  { file: "pyproject.toml", name: "uv/pip" },
];

const LANGUAGE_MARKERS: Array<{ extension: string; language: string }> = [
  { extension: ".ts", language: "typescript" },
  { extension: ".tsx", language: "typescript" },
  { extension: ".js", language: "javascript" },
  { extension: ".jsx", language: "javascript" },
  { extension: ".py", language: "python" },
  { extension: ".go", language: "go" },
  { extension: ".rs", language: "rust" },
  { extension: ".java", language: "java" },
  { extension: ".cs", language: "csharp" },
  { extension: ".rb", language: "ruby" },
  { extension: ".php", language: "php" },
];

function isDirectory(filePath: string): boolean {
  try {
    return statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function listDirectories(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function listFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function detectLanguageHints(root: string): string[] {
  const hints = new Set<string>();
  const scan = (dir: string, depth: number): void => {
    if (depth > 2) return;
    for (const entry of listFiles(dir)) {
      for (const marker of LANGUAGE_MARKERS) {
        if (entry.endsWith(marker.extension)) {
          hints.add(marker.language);
        }
      }
    }
    for (const child of listDirectories(dir)) {
      scan(path.join(dir, child), depth + 1);
    }
  };
  scan(root, 0);
  return [...hints].sort();
}

function detectPackageManagers(root: string): string[] {
  return PACKAGE_MANAGER_MANIFESTS.filter(({ file }) => existsSync(path.join(root, file))).map(
    ({ name }) => name,
  );
}

function inferRole(name: string): string | null {
  const lower = name.toLowerCase();
  if (/(web|frontend|front-end|ui|dashboard|client)/.test(lower)) return "frontend";
  if (/(api|backend|server)/.test(lower)) return "backend";
  if (/(worker|queue|jobs|cron)/.test(lower)) return "worker";
  if (/(cli|command)/.test(lower)) return "cli";
  return null;
}

function collectTestDirectories(root: string): string[] {
  const found = new Set<string>();
  const scan = (dir: string, depth: number): void => {
    if (depth > 3) return;
    for (const child of listDirectories(dir)) {
      const childPath = path.join(dir, child);
      if (TEST_DIRECTORY_NAMES.has(child.toLowerCase())) {
        found.add(path.relative(root, childPath));
      }
      scan(childPath, depth + 1);
    }
  };
  scan(root, 0);
  return [...found].sort();
}

function hasTestFiles(dir: string): boolean {
  const scan = (current: string, depth: number): boolean => {
    if (depth > 3) return false;
    for (const entry of listFiles(current)) {
      if (/\.(test|spec)\.[a-z0-9]+$/i.test(entry)) return true;
    }
    for (const child of listDirectories(current)) {
      if (scan(path.join(current, child), depth + 1)) return true;
    }
    return false;
  };
  return scan(dir, 0);
}

export function discoverRepository(
  repositoryRoot: string,
  overrides: RepositoryOverrides = {},
): RepositoryDiscovery {
  const root = path.resolve(repositoryRoot);
  const warnings: string[] = [];

  if (!existsSync(root)) {
    throw new Error(`Repository path does not exist: ${root}`);
  }

  const ignore = new Set(overrides.ignorePaths ?? []);
  const modules: DiscoveredModule[] = [];

  for (const container of CONTAINER_DIRECTORIES) {
    const containerPath = path.join(root, container);
    if (!isDirectory(containerPath)) continue;
    for (const child of listDirectories(containerPath)) {
      const relativePath = path.join(container, child);
      if (ignore.has(relativePath)) continue;
      const kind: DiscoveredModule["kind"] =
        container === "apps" || container === "services" || container === "modules"
          ? "application"
          : "package";
      modules.push({ name: child, path: relativePath, kind });
    }
  }

  let applications: DiscoveredApplication[] = modules
    .filter((module) => module.kind === "application")
    .map((module) => {
      const moduleRoot = path.join(root, module.path);
      return {
        name: module.name,
        path: module.path,
        role: inferRole(module.name),
        hasTests: hasTestFiles(moduleRoot),
      };
    });

  if (overrides.applications !== undefined) {
    applications = overrides.applications;
  }

  if (applications.length === 0 && isDirectory(path.join(root, "src"))) {
    const name = path.basename(root);
    applications.push({
      name,
      path: ".",
      role: inferRole(name),
      hasTests: hasTestFiles(root),
    });
    warnings.push(
      "No application containers found; treated repository root as a single application.",
    );
  }

  const testDirectories = overrides.testDirectories ?? collectTestDirectories(root);
  const hasTests = testDirectories.length > 0 || hasTestFiles(root);

  return {
    root,
    languageHints: detectLanguageHints(root),
    packageManagers: detectPackageManagers(root),
    hasTests,
    testDirectories,
    applications,
    modules,
    warnings,
  };
}
