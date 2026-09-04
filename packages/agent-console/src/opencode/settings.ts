/**
 * localStorage-backed settings, mirrored to a durable file
 * (settingsFile.ts, `~/.config/agent-console/settings.json` on the
 * server's machine) on every change — there's no server-side user/account
 * model, so "where do I look for repos" and "how should new worktrees be
 * laid out" live on the device by default, but a browser cache wipe
 * shouldn't lose them outright.
 *
 * @internal
 */
import { readSettingsFile, writeSettingsFile } from "./settingsFile";

const ROOT_DIR_KEY = "agent-console:rootDir";
const WORKTREE_TEMPLATE_KEY = "agent-console:worktreeTemplate";
const LAST_SCAN_KEY = "agent-console:lastScanAt";

/** Placeholders: {root}, {repo}, {name}. Only used when *creating* a new
 * worktree — existing repos/worktrees are discovered by scanning (see
 * repoScan.ts), never assumed to follow this or any other convention. */
export const DEFAULT_WORKTREE_TEMPLATE = "{root}/{repo}/worktrees/{name}";

const readString = (key: string): string | undefined => {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
};

export const getRootDir = (): string | undefined => readString(ROOT_DIR_KEY);

export const getWorktreeTemplate = (): string => readString(WORKTREE_TEMPLATE_KEY) ?? DEFAULT_WORKTREE_TEMPLATE;

/** Fire-and-forget — a failed write leaves localStorage as the only copy
 * for this device, same as before the durable file existed; not surfaced
 * as a blocking error since nothing about the current session depends on
 * it succeeding. */
const persistToFile = (): void => {
  void writeSettingsFile({ rootDir: getRootDir() ?? "", worktreeTemplate: getWorktreeTemplate() });
};

export const setRootDir = (value: string): void => {
  localStorage.setItem(ROOT_DIR_KEY, value);
  persistToFile();
};

export const setWorktreeTemplate = (value: string): void => {
  localStorage.setItem(WORKTREE_TEMPLATE_KEY, value);
  persistToFile();
};

/** Cold-start recovery: called only when localStorage has no rootDir at
 * all (a real first run, or a cache wipe) — tries the durable file before
 * falling back to asking. Restores into localStorage (not just returning
 * the value) so every other `get*` call here keeps working unchanged.
 * Returns whether it found anything. */
export const restoreFromFile = async (): Promise<boolean> => {
  const restored = await readSettingsFile();
  if (restored === undefined) return false;
  localStorage.setItem(ROOT_DIR_KEY, restored.rootDir);
  localStorage.setItem(WORKTREE_TEMPLATE_KEY, restored.worktreeTemplate);
  return true;
};

export const resolveWorktreePath = (rootDir: string, repo: string, name: string): string =>
  getWorktreeTemplate()
    .replaceAll("{root}", rootDir)
    .replaceAll("{repo}", repo)
    .replaceAll("{name}", name);

export const getLastScanAt = (): number | undefined => {
  const raw = readString(LAST_SCAN_KEY);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const setLastScanAt = (ms: number): void => {
  localStorage.setItem(LAST_SCAN_KEY, String(ms));
};
