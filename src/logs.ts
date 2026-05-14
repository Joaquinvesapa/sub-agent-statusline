import { readFileSync, statSync } from "node:fs";

const MAX_SYNC_LOG_READ_BYTES = 1024 * 1024;

function safeRead<T>(reader: () => T): T | undefined {
  try {
    return reader();
  } catch {
    return undefined;
  }
}

export function readOpenCodeLogFileIfSmall(path: string): string | undefined {
  const stats = safeRead(() => statSync(path));
  if (!stats?.isFile() || stats.size > MAX_SYNC_LOG_READ_BYTES) {
    return undefined;
  }
  return safeRead(() => readFileSync(path, "utf8"));
}
