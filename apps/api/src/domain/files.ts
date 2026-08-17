import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { NotFoundError, ValidationError } from "./errors.js";

export const EXCLUDED_SEGMENTS = new Set([".git", "node_modules", "dist", "coverage", ".DS_Store"]);

export const MAX_FILE_BYTES = 1024 * 1024;

export interface FileEntry {
  name: string;
  path: string;
  type: "dir" | "file";
  size: number | null;
}

export interface DirectoryListing {
  exists: boolean;
  path: string;
  entries: FileEntry[];
}

function isExcludedPath(relPath: string): boolean {
  return relPath.split("/").some((segment) => EXCLUDED_SEGMENTS.has(segment));
}

/** Resolves a relative repo path against the root, rejecting any traversal escape. */
export function resolveToRoot(root: string, relPath: string): string {
  if (!root) {
    throw new ValidationError("No repository root configured for this project");
  }
  const rootAbs = path.resolve(root);
  const clean = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  const target = path.resolve(rootAbs, clean);
  if (target !== rootAbs && !target.startsWith(rootAbs + path.sep)) {
    throw new ValidationError("Path escapes the repository root");
  }
  return target;
}

export function listDirectory(root: string, relPath = ""): DirectoryListing {
  const target = resolveToRoot(root, relPath);
  if (!existsSync(target)) {
    return { exists: false, path: relPath || ".", entries: [] };
  }
  const entries = readdirSync(target, { withFileTypes: true })
    .filter((dirent) => !isExcludedPath(dirent.name))
    .map((dirent): FileEntry => {
      const relative = normalizePosix(path.join(relPath, dirent.name));
      if (dirent.isDirectory()) {
        return { name: dirent.name, path: relative, type: "dir", size: null };
      }
      let size: number | null = null;
      try {
        size = statSync(path.join(target, dirent.name)).size;
      } catch {
        size = null;
      }
      return { name: dirent.name, path: relative, type: "file", size };
    })
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  return { exists: true, path: relPath || ".", entries };
}

export interface FileContent {
  path: string;
  content: string;
  size: number;
  binary: boolean;
}

/** Reads a file for preview, rejecting binary and oversized files. */
export function readFileContent(root: string, relPath: string): FileContent {
  const target = resolveToRoot(root, relPath);
  if (!existsSync(target)) {
    throw new NotFoundError("file", relPath);
  }
  const stats = statSync(target);
  if (!stats.isFile()) {
    throw new ValidationError(`${relPath} is not a file`);
  }
  if (stats.size > MAX_FILE_BYTES) {
    throw new ValidationError(`File exceeds the ${MAX_FILE_BYTES}-byte preview limit`);
  }
  const buffer = readFileSync(target);
  const binary = buffer.includes(0);
  if (binary) {
    return { path: relPath, content: "", size: buffer.length, binary: true };
  }
  return {
    path: relPath,
    content: buffer.toString("utf8"),
    size: buffer.length,
    binary: false,
  };
}

function normalizePosix(value: string): string {
  return value.split(path.sep).join("/");
}
