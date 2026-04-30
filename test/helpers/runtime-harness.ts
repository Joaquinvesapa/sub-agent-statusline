import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { vi } from "vitest";

const tempDirs = new Set<string>();

export async function createRuntimeHarness(options: { preserveState?: boolean } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "subagent-statusline-test-"));
  tempDirs.add(dir);

  const statePath = join(dir, "state.json");
  const textPath = join(dir, "status.txt");
  process.env.OPENCODE_SUBAGENT_STATUSLINE_STATE = statePath;
  process.env.OPENCODE_SUBAGENT_STATUSLINE_PRESERVE_STATE = options.preserveState
    ? "1"
    : "0";
  process.env.NO_COLOR = "1";

  return { dir, statePath, textPath };
}

export async function cleanupRegisteredTempDirs(): Promise<void> {
  await Promise.all(
    [...tempDirs].map(async (dir) => {
      await rm(dir, { force: true, recursive: true });
      tempDirs.delete(dir);
    }),
  );
}

export async function readJsonFixture<T>(name: string): Promise<T> {
  const url = new URL(`../fixtures/events/${name}.json`, import.meta.url);
  return JSON.parse(await readFile(url, "utf8")) as T;
}

export async function readRuntimeState<T>(statePath: string): Promise<T> {
  return JSON.parse(await readFile(statePath, "utf8")) as T;
}

export async function readStatusText(textPath: string): Promise<string> {
  return readFile(textPath, "utf8");
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export function useFrozenTime(isoTimestamp: string): Date {
  const now = new Date(isoTimestamp);
  vi.useFakeTimers();
  vi.setSystemTime(now);
  return now;
}
