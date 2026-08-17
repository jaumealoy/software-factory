import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { KiloNotInstalledError } from "./client.js";

const execFileAsync = promisify(execFile);

export interface KiloModel {
  /** Full id as printed by `kilo models`, e.g. `kilo/anthropic/claude-haiku-4.5`. */
  id: string;
  provider: string;
  model: string;
}

async function defaultModelsRunner(): Promise<string> {
  try {
    const result = await execFileAsync("kilo", ["models"], { timeout: 60_000 });
    return result.stdout;
  } catch (error) {
    const err = error as { code?: string };
    if (err.code === "ENOENT") {
      throw new KiloNotInstalledError();
    }
    return "";
  }
}

export function parseKiloModels(stdout: string): KiloModel[] {
  const models: KiloModel[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("kilo/")) continue;
    const parts = trimmed.split("/");
    if (parts.length < 3) continue;
    const provider = parts[1] ?? "";
    const model = parts.slice(2).join("/");
    models.push({ id: trimmed, provider, model });
  }
  return models;
}

export async function listAvailableModels(
  runner: () => Promise<string> = defaultModelsRunner,
): Promise<KiloModel[]> {
  return parseKiloModels(await runner());
}
