/**
 * OpenCode V2 entrypoint (package root and `./tui`).
 *
 * Default-exports only the `Plugin.define` definition from the V2 monitor;
 * any extra named export would be rejected by the host plugin loader.
 */
export { default } from "./tui.js";