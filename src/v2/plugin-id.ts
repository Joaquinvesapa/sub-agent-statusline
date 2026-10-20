/**
 * Plugin id shared by the V2 TUI and server entrypoints.
 *
 * Kept in its own module so the server entrypoint can import it without
 * pulling in OpenTUI or Solid.
 */
export const PLUGIN_ID = "subagent-monitor";
