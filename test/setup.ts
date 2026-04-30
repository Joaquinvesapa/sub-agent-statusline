import { afterEach } from "vitest";
import { cleanupRegisteredTempDirs } from "./helpers/runtime-harness.js";

const envKeys = [
  "NO_COLOR",
  "OPENCODE_SUBAGENT_STATUSLINE_COLOR",
  "OPENCODE_SUBAGENT_STATUSLINE_INSTANCE",
  "OPENCODE_SUBAGENT_STATUSLINE_PRESERVE_STATE",
  "OPENCODE_SUBAGENT_STATUSLINE_STATE",
  "XDG_RUNTIME_DIR",
];

const originalEnv = new Map(
  envKeys.map((key) => [key, process.env[key]]),
);

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();

  for (const key of envKeys) {
    const original = originalEnv.get(key);
    if (original === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = original;
    }
  }

  await cleanupRegisteredTempDirs();
});
