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
      tui: "src/tui.tsx",
    },
    format: ["esm"],
    target: "node22",
    dts: {
      entry: {
        tui: "src/tui.tsx",
      },
    },
    bundle: true,
    splitting: false,
    clean: false,
    outDir: "dist",
    external: [
      "@opencode-ai/plugin",
      "@opencode-ai/plugin/tui",
      "@opentui/core",
      "@opentui/solid",
      "solid-js",
    ],
    esbuildPlugins: [
      solidPlugin({ solid: { generate: "universal", moduleName: "@opentui/solid" } }),
    ],
  },
  {
    entry: {
      "tui-v2": "src/v2/index.ts",
    },
    format: ["esm"],
    target: "node22",
    dts: {
      entry: {
        "tui-v2": "src/v2/index.ts",
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
