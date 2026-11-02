import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

type Version = [number, number, number];

function parseVersion(value: string): Version {
  const [major = 0, minor = 0, patch = 0] = value.split(".").map(Number);
  return [major, minor, patch];
}

function compare(a: Version, b: Version): number {
  for (let index = 0; index < 3; index += 1) {
    const diff = a[index]! - b[index]!;
    if (diff !== 0) return diff;
  }
  return 0;
}

// Supports the `>=X.Y.Z <A.B[.C]` form the manifest uses for OpenTUI peers.
function satisfies(version: string, range: string): boolean {
  const target = parseVersion(version);
  return range.split(/\s+/).every((clause) => {
    const match = /^(>=|<)(\d+(?:\.\d+){0,2})$/.exec(clause);
    if (!match) throw new Error(`Unsupported range clause: ${clause}`);
    const diff = compare(target, parseVersion(match[2]!));
    return match[1] === ">=" ? diff >= 0 : diff < 0;
  });
}

async function peerDependencies(): Promise<Record<string, string>> {
  const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  return pkg.peerDependencies;
}

describe("OpenTUI peer ranges", () => {
  // OpenCode 2.0.x ships OpenTUI 0.5.x, @opencode/plugin 2.2.0 pins 0.7.0 and
  // 2.2.5 requires >=0.8.0 (npm resolves 0.8.1). See issue #118.
  const hostVersions = ["0.5.10", "0.6.8", "0.7.0", "0.8.0", "0.8.1"];

  for (const name of ["@opentui/core", "@opentui/solid"]) {
    it(`${name} accepts every OpenTUI version shipped by OpenCode 2 hosts`, async () => {
      const range = (await peerDependencies())[name]!;
      for (const version of hostVersions) {
        expect(satisfies(version, range), `${name} ${range} should accept ${version}`).toBe(true);
      }
    });

    it(`${name} keeps an upper bound below the next untested minor`, async () => {
      const range = (await peerDependencies())[name]!;
      expect(satisfies("0.9.0", range)).toBe(false);
      expect(satisfies("0.4.9", range)).toBe(false);
    });
  }
});
