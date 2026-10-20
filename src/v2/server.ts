/**
 * OpenCode V2 server entrypoint (`./server`).
 *
 * The host loads `<package>/server` in the server process before falling back
 * to the package root, which points at the TUI bundle. The monitor only runs
 * in the TUI, so this entry registers the plugin id without importing OpenTUI
 * or Solid: their module instances are not shared with the server host.
 *
 * Default export only; any extra named export would be rejected by the host
 * plugin loader.
 */
import { Plugin } from "@opencode/plugin";
import { PLUGIN_ID } from "./plugin-id.js";

export default Plugin.define({
  id: PLUGIN_ID,
  setup() {},
});
