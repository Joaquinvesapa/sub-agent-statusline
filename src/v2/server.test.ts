import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import serverPlugin from "./server.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");

type ExportTarget = { types: string; import: string };

async function packageExports(): Promise<Record<string, ExportTarget>> {
  const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  return pkg.exports;
}

// Mirrors the OpenCode 2 loader: the server role tries `./server`, then the
// package root.
function resolveServerEntry(exports: Record<string, ExportTarget>): string | undefined {
  for (const key of ["./server", "."]) {
    const target = exports[key]?.import;
    if (target) return target;
  }
  return undefined;
}

function importSpecifiers(source: string): string[] {
  const pattern = /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
  return [...source.matchAll(pattern)].map((match) => match[1] ?? match[2] ?? "");
}

async function collectImports(file: string, seen = new Set<string>()): Promise<string[]> {
  if (seen.has(file)) return [];
  seen.add(file);
  const specifiers = importSpecifiers(await readFile(file, "utf8"));
  const nested = await Promise.all(
    specifiers
      .filter((specifier) => specifier.startsWith("."))
      .map((specifier) => collectImports(resolve(dirname(file), specifier.replace(/\.js$/, ".ts")), seen)),
  );
  return [...specifiers, ...nested.flat()];
}

describe("V2 server entrypoint", () => {
  it("is the target the host resolves for the server role", async () => {
    const exports = await packageExports();

    expect(resolveServerEntry(exports)).toBe("./dist/server.js");
    expect(exports["./server"]?.types).toBe("./dist/server.d.ts");
  });

  it("keeps the package root and ./tui on the TUI bundle", async () => {
    const exports = await packageExports();

    expect(exports["."]?.import).toBe("./dist/tui.js");
    expect(exports["./tui"]?.import).toBe("./dist/tui.js");
  });

  it("does not import OpenTUI, Solid or the TUI module", async () => {
    const imports = await collectImports(resolve(here, "server.ts"));

    expect(imports).toContain("@opencode/plugin");
    for (const specifier of imports) {
      expect(specifier).not.toMatch(/^@opentui\//);
      expect(specifier).not.toMatch(/^solid-js/);
      expect(specifier).not.toMatch(/tui(\.js|\.tsx)?$/);
      expect(specifier).not.toBe("@opencode/plugin/tui");
    }
  });

  it("registers the monitor id with a setup that tolerates an empty context", async () => {
    expect(serverPlugin.id).toBe("subagent-monitor");
    await expect(
      Promise.resolve(serverPlugin.setup({} as Parameters<typeof serverPlugin.setup>[0])),
    ).resolves.toBeUndefined();
  });
});
