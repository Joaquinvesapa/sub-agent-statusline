import { solidPlugin } from "esbuild-plugin-solid";
import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: {
      index: "src/index.ts",
    },
    format: ["esm"],
    target: "node22",
    dts: {
      entry: {
        index: "src/index.ts",
      },
    },
    bundle: true,
    splitting: false,
    clean: true,
    outDir: "dist",
  },
  {
    entry: {
      tui: "src/v2/index.ts",
      server: "src/v2/server.ts",
    },
    format: ["esm"],
    target: "node22",
    dts: {
      entry: {
        tui: "src/v2/index.ts",
        server: "src/v2/server.ts",
      },
    },
    bundle: true,
    splitting: false,
    clean: false,
    outDir: "dist",
    external: [
      "@opencode/plugin",
      "@opencode/plugin/tui",
      "@opencode/theme",
      "@opentui/core",
      "@opentui/solid",
      "solid-js",
    ],
    esbuildPlugins: [
      solidPlugin({ solid: { generate: "universal", moduleName: "@opentui/solid" } }),
    ],
  },
]);
