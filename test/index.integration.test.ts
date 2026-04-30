import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { SubagentStatusline } from "../src/index.js";
import type { StatuslineState } from "../src/state.js";
import {
  createRuntimeHarness,
  pathExists,
  readJsonFixture,
  readRuntimeState,
  readStatusText,
} from "./helpers/runtime-harness.js";

async function createPlugin() {
  return SubagentStatusline({} as Parameters<typeof SubagentStatusline>[0]);
}

describe("SubagentStatusline runtime", () => {
  it("initializes empty runtime files and persists supported event changes", async () => {
    const harness = await createRuntimeHarness();
    const plugin = await createPlugin();
    const event = await readJsonFixture("session-created");

    expect(await readStatusText(harness.textPath)).toBe("↳ 0 running · 0 done · 0 error · Σ 0 total");

    await expect(plugin.event?.({ event } as never)).resolves.toBeUndefined();

    const state = await readRuntimeState<StatuslineState>(harness.statePath);
    expect(state.children.ses_child_1).toMatchObject({
      title: "Review auth changes",
      status: "running",
    });
    expect(await readStatusText(harness.textPath)).toContain("Review auth changes");
  });

  it("preserves startup state when preserve-state is enabled", async () => {
    const harness = await createRuntimeHarness({ preserveState: true });
    await writeFile(
      harness.statePath,
      JSON.stringify({
        children: {},
        countedChildIDs: { existing: true },
        totalExecuted: 7,
        updatedAt: "2026-04-30T10:00:00.000Z",
      }),
      "utf8",
    );

    await createPlugin();

    expect(await readRuntimeState<StatuslineState>(harness.statePath)).toMatchObject({
      totalExecuted: 7,
      countedChildIDs: { existing: true },
    });
    expect(await pathExists(harness.textPath)).toBe(false);
  });

  it("handles malformed events and write failures without throwing", async () => {
    const harness = await createRuntimeHarness({ preserveState: true });
    await mkdir(harness.statePath, { recursive: true });
    const plugin = await createPlugin();
    const malformed = await readJsonFixture("malformed");
    const valid = await readJsonFixture("session-created");

    await expect(plugin.event?.({ event: malformed } as never)).resolves.toBeUndefined();
    await expect(plugin.event?.({ event: valid } as never)).resolves.toBeUndefined();
  });
});
