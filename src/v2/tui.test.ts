import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KeymapLayer } from "@opencode/plugin/tui/context";

const host = vi.hoisted(() => ({ context: {} as any }));

vi.mock("@opencode/plugin/tui", () => ({
  Plugin: { define: (plugin: unknown) => plugin },
  usePlugin: () => host.context,
}));

// Keep JSX inert: mount the sidebar explicitly, without a terminal renderer.
vi.mock("@opentui/solid/jsx-dev-runtime", () => ({
  jsxDEV: (type: unknown, props: unknown) => ({ type, props }),
}));

vi.mock("solid-js", async (importOriginal) => ({
  ...await importOriginal<typeof import("solid-js")>(),
  // This harness uses plain prefs, not reactive storage; recompute on each read.
  createMemo: (compute: () => unknown) => compute,
  createEffect: () => {},
  onCleanup: () => {},
}));

async function mountMonitor() {
  vi.resetModules();
  const layers: Array<() => KeymapLayer> = [];
  const slots: any[] = [];
  // Old saved preferences have no showErrors field.
  const prefs: { expanded: boolean; showCompleted: boolean; showErrors?: boolean } = {
    expanded: true, showCompleted: false,
  };
  const navigate = vi.fn();
  host.context = {
    storage: {
      store: () => [prefs, async (mutate: (draft: typeof prefs) => void) => mutate(prefs)],
    },
    data: {
      listen: () => vi.fn(),
      session: {
        family: () => ["child"],
        get: () => ({ id: "child", parentID: "parent", title: "Test child" }),
      },
    },
    ui: {
      slot: (slot: unknown) => { slots.push(slot); return vi.fn(); },
      router: { navigate },
    },
    keymap: { layer: (factory: () => KeymapLayer) => layers.push(factory) },
  };
  const { default: plugin } = await import("./tui.js");
  plugin.setup(host.context);
  const sidebar = slots.find((slot) => slot.append === "sidebar.content")
    .render({ sessionID: "parent" });
  sidebar.type(sidebar.props);
  const global = layers.find((factory) => factory().mode === "global")!;
  const list = layers.find((factory) => factory().mode !== "global")!;
  const enabled = () => {
    const value = list().enabled;
    return typeof value === "function" ? value() : value !== false;
  };
  const toggle = () => global().commands!.find((command) => command.id?.endsWith(".focus"))!.run();
  return { global, list, enabled, toggle, prefs, navigate };
}

beforeEach(() => vi.clearAllMocks());

describe("V2 monitor keyboard registration", () => {
  it("uses a leader shortcut without colliding with prompt word navigation", async () => {
    const monitor = await mountMonitor();
    const commands = monitor.global().commands!;
    expect(commands.find((command) => command.id?.endsWith(".focus"))?.bind).toBe("<leader>z");
    for (const command of commands) {
      expect(["alt+b", "alt+left", "ctrl+left"]).not.toContain(command.bind);
    }
  });

  it("keeps palette actions available without list focus", async () => {
    const monitor = await mountMonitor();
    const commands = monitor.global().commands!;
    expect(commands.filter((command) => command.palette)).toHaveLength(4);
    expect(commands.filter((command) => command.bind === false)).toHaveLength(3);
    expect(monitor.enabled()).toBe(false);
    commands.find((command) => command.id?.endsWith(".palette.history"))!.run();
    expect(monitor.prefs.showCompleted).toBe(true);
    commands.find((command) => command.id?.endsWith(".palette.errors"))!.run();
    expect(monitor.prefs.showErrors).toBe(true);
    commands.find((command) => command.id?.endsWith(".palette.monitor"))!.run();
    expect(monitor.prefs.expanded).toBe(false);
    expect(monitor.enabled()).toBe(false);
    expect(monitor.navigate).not.toHaveBeenCalled();
  });

  it("enables bare list keys only while focused and keeps the host base mode", async () => {
    const monitor = await mountMonitor();
    expect(monitor.list().mode).toBeUndefined();
    expect(monitor.list().commands!.map((command) => command.bind).sort())
      .toEqual(["c", "e", "enter", "escape", "h", "j", "k", "l"]);
    expect(monitor.enabled()).toBe(false);
    for (const command of monitor.list().commands!) expect(command.run()).toBe(false);
    expect(monitor.prefs).toEqual({ expanded: true, showCompleted: false });
    expect(monitor.navigate).not.toHaveBeenCalled();

    monitor.toggle();
    expect(monitor.enabled()).toBe(true);
    const run = (key: string) => monitor.list().commands!.find((command) => command.bind === key)!.run();
    run("j");
    run("k");
    run("enter");
    expect(monitor.navigate).toHaveBeenCalledExactlyOnceWith({ type: "session", sessionID: "child" });
    run("h");
    expect(monitor.prefs.expanded).toBe(false);
    monitor.navigate.mockClear();
    run("enter");
    expect(monitor.navigate).not.toHaveBeenCalled();
    run("l");
    expect(monitor.prefs.expanded).toBe(true);
    run("c");
    expect(monitor.prefs.showCompleted).toBe(true);
    run("e");
    expect(monitor.prefs.showErrors).toBe(true);
    run("e");
    expect(monitor.prefs.showErrors).toBe(false);
    run("escape");
    expect(monitor.enabled()).toBe(false);
    monitor.toggle();
    monitor.toggle();
    expect(monitor.enabled()).toBe(false);
  });
});
