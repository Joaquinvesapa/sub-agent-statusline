import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { readOpenCodeLogFileIfSmall } from "./logs.js";
import {
  focusPromptWithDeferredRetry,
  resolveSidebarReturnFocusAction,
} from "./tui-focus.js";
import { registerSubagentCommands } from "./tui-commands.js";

describe("registerSubagentCommands", () => {
  it("registers both keymap and legacy commands when both APIs are available", () => {
    const keymapDispose = vi.fn();
    const legacyDispose = vi.fn();
    const registerLayer = vi.fn(() => keymapDispose);
    const commandRegister = vi.fn(() => legacyDispose);
    const toggleSection = vi.fn();
    const focusSidebarList = vi.fn();
    const toggleCompletedHistory = vi.fn();

    const result = registerSubagentCommands({
      api: {
        keymap: { registerLayer },
        command: { register: commandRegister },
      },
      sectionEnabled: () => true,
      toggleSection,
      focusSidebarList,
      toggleCompletedHistory,
    });

    expect(commandRegister).toHaveBeenCalledOnce();
    expect(registerLayer).toHaveBeenCalledOnce();
    expect(registerLayer).toHaveBeenCalledWith({
      commands: [
        expect.objectContaining({
          name: "subagent-statusline.toggle-sidebar-section",
          title: expect.stringContaining("Subagents"),
          run: expect.any(Function),
        }),
        expect.objectContaining({
          name: "subagent-statusline.focus-sidebar-list",
          title: "Subagents: Focus sidebar list",
          run: expect.any(Function),
        }),
        expect.objectContaining({
          name: "subagent-statusline.toggle-completed-history",
          title: "Subagents: Toggle completed history",
          run: expect.any(Function),
        }),
      ],
      bindings: [
        {
          key: "alt+b",
          cmd: "subagent-statusline.focus-sidebar-list",
        },
      ],
    });

    const layer = registerLayer.mock.calls[0]?.[0];
    layer?.commands?.[0]?.run();
    layer?.commands?.[1]?.run();
    layer?.commands?.[2]?.run();

    const legacyCommands = commandRegister.mock.calls[0]?.[0]?.();
    legacyCommands?.[0]?.onSelect?.();
    legacyCommands?.[1]?.onSelect?.();
    legacyCommands?.[2]?.onSelect?.();

    expect(toggleSection).toHaveBeenNthCalledWith(1, false);
    expect(toggleSection).toHaveBeenNthCalledWith(2, false);
    expect(focusSidebarList).toHaveBeenCalledTimes(2);
    expect(toggleCompletedHistory).toHaveBeenCalledTimes(2);

    expect(legacyCommands).toEqual([
      expect.objectContaining({
        value: "subagent-statusline.toggle-sidebar-section",
        description: "Toggle the entire subagent sidebar section",
        category: "Subagents",
      }),
      expect.objectContaining({
        title: "Subagents: Focus sidebar list",
        value: "subagent-statusline.focus-sidebar-list",
        keybind: "alt+b",
      }),
      expect.objectContaining({
        title: "Subagents: Toggle completed history",
        value: "subagent-statusline.toggle-completed-history",
        description: expect.stringContaining("Shortcut: c"),
      }),
    ]);

    result();
    expect(keymapDispose).toHaveBeenCalledOnce();
    expect(legacyDispose).toHaveBeenCalledOnce();

    result();
    expect(keymapDispose).toHaveBeenCalledOnce();
    expect(legacyDispose).toHaveBeenCalledOnce();
  });

  it("registers only keymap when legacy API is unavailable", () => {
    const dispose = vi.fn();
    const registerLayer = vi.fn(() => dispose);
    const toggleSection = vi.fn();
    const focusSidebarList = vi.fn();
    const toggleCompletedHistory = vi.fn();

    const result = registerSubagentCommands({
      api: {
        keymap: { registerLayer },
      },
      sectionEnabled: () => true,
      toggleSection,
      focusSidebarList,
      toggleCompletedHistory,
    });

    expect(registerLayer).toHaveBeenCalledOnce();
    const layer = registerLayer.mock.calls[0]?.[0];
    expect(layer?.bindings).toEqual([
      {
        key: "alt+b",
        cmd: "subagent-statusline.focus-sidebar-list",
      },
    ]);

    layer?.commands?.[0]?.run();
    layer?.commands?.[1]?.run();
    layer?.commands?.[2]?.run();
    expect(toggleSection).toHaveBeenCalledWith(false);
    expect(focusSidebarList).toHaveBeenCalledOnce();
    expect(toggleCompletedHistory).toHaveBeenCalledOnce();

    result();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("falls back to the legacy command API when keymap is unavailable", () => {
    const dispose = vi.fn();
    const register = vi.fn(() => dispose);
    const toggleSection = vi.fn();
    const focusSidebarList = vi.fn();
    const toggleCompletedHistory = vi.fn();

    const result = registerSubagentCommands({
      api: { command: { register } },
      sectionEnabled: () => false,
      toggleSection,
      focusSidebarList,
      toggleCompletedHistory,
    });

    expect(register).toHaveBeenCalledOnce();
    const legacyCommands = register.mock.calls[0]?.[0]?.();
    expect(legacyCommands).toEqual([
      expect.objectContaining({
        title: "Subagents: Enable sidebar section",
        value: "subagent-statusline.toggle-sidebar-section",
      }),
      expect.objectContaining({
        value: "subagent-statusline.focus-sidebar-list",
        keybind: "alt+b",
      }),
      expect.objectContaining({
        value: "subagent-statusline.toggle-completed-history",
        description: expect.stringContaining("sidebar list is focused"),
      }),
    ]);

    legacyCommands?.[0]?.onSelect?.();
    legacyCommands?.[1]?.onSelect?.();
    legacyCommands?.[2]?.onSelect?.();
    expect(toggleSection).toHaveBeenCalledWith(true);
    expect(focusSidebarList).toHaveBeenCalledOnce();
    expect(toggleCompletedHistory).toHaveBeenCalledOnce();

    result();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("returns a safe no-op disposer when neither API is available", () => {
    const result = registerSubagentCommands({
      api: {},
      sectionEnabled: () => false,
      toggleSection: vi.fn(),
      focusSidebarList: vi.fn(),
      toggleCompletedHistory: vi.fn(),
    });

    expect(() => result()).not.toThrow();
    expect(() => result()).not.toThrow();
  });

  it("disposes all created registrations even if one dispose throws", () => {
    const keymapDispose = vi.fn(() => {
      throw new Error("keymap dispose failed");
    });
    const legacyDispose = vi.fn();
    const registerLayer = vi.fn(() => keymapDispose);
    const register = vi.fn(() => legacyDispose);

    const result = registerSubagentCommands({
      api: {
        keymap: { registerLayer },
        command: { register },
      },
      sectionEnabled: () => false,
      toggleSection: vi.fn(),
      focusSidebarList: vi.fn(),
      toggleCompletedHistory: vi.fn(),
    });

    expect(() => result()).not.toThrow();
    expect(keymapDispose).toHaveBeenCalledOnce();
    expect(legacyDispose).toHaveBeenCalledOnce();

    result();
    expect(keymapDispose).toHaveBeenCalledOnce();
    expect(legacyDispose).toHaveBeenCalledOnce();
  });
});

describe("readOpenCodeLogFileIfSmall", () => {
  it("skips oversized OpenCode logs before reading them synchronously", async () => {
    const dir = await mkdtemp(join(tmpdir(), "subagent-statusline-logs-"));
    const smallLog = join(dir, "small.log");
    const hugeLog = join(dir, "huge.log");

    await writeFile(smallLog, "small log", "utf8");
    await writeFile(hugeLog, `${"x".repeat(1024 * 1024)}x`, "utf8");

    expect(readOpenCodeLogFileIfSmall(smallLog)).toBe("small log");
    expect(readOpenCodeLogFileIfSmall(hugeLog)).toBeUndefined();
  });
});

describe("resolveSidebarReturnFocusAction", () => {
  const pendingSidebarRefocus = {
    parentSessionID: "parent",
    childSessionID: "child",
    childRowID: "row-1",
  };

  it("returns focus-prompt for remembered child -> parent return", () => {
    expect(
      resolveSidebarReturnFocusAction({
        pendingSidebarRefocus,
        previousRouteSessionID: "child",
        routeSessionID: "parent",
      }),
    ).toBe("focus-prompt");
  });

  it("returns clear-pending when route leaves remembered child path", () => {
    expect(
      resolveSidebarReturnFocusAction({
        pendingSidebarRefocus,
        previousRouteSessionID: "child",
        routeSessionID: "another",
      }),
    ).toBe("clear-pending");
  });

  it("returns none for unrelated transitions while still on child", () => {
    expect(
      resolveSidebarReturnFocusAction({
        pendingSidebarRefocus,
        previousRouteSessionID: "parent",
        routeSessionID: "child",
      }),
    ).toBe("none");
  });

  it("returns none when no pending sidebar navigation exists", () => {
    expect(
      resolveSidebarReturnFocusAction({
        previousRouteSessionID: "child",
        routeSessionID: "parent",
      }),
    ).toBe("none");
  });
});

describe("focusPromptWithDeferredRetry", () => {
  it("retries once when prompt focus is initially unavailable", () => {
    const queue: Array<() => void> = [];
    const schedule = (callback: () => void): void => {
      queue.push(callback);
    };
    let hasPromptRef = false;
    const focus = vi.fn(() => {
      if (!hasPromptRef) {
        hasPromptRef = true;
        return false;
      }
      return true;
    });

    focusPromptWithDeferredRetry(focus, schedule);
    expect(queue).toHaveLength(1);
    queue.shift()?.();
    expect(focus).toHaveBeenCalledTimes(1);
    expect(queue).toHaveLength(1);
    queue.shift()?.();
    expect(focus).toHaveBeenCalledTimes(2);
  });
});
