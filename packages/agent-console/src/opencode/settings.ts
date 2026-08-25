/**
 * localStorage-backed settings — there's no server-side user/account model,
 * so "where do I look for repos" and "how should new worktrees be laid
 * out" live on the device, not in OpenCode.
 *
 * @internal
 */
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

export const setRootDir = (value: string): void => {
  localStorage.setItem(ROOT_DIR_KEY, value);
};

export const getWorktreeTemplate = (): string => readString(WORKTREE_TEMPLATE_KEY) ?? DEFAULT_WORKTREE_TEMPLATE;

export const setWorktreeTemplate = (value: string): void => {
  localStorage.setItem(WORKTREE_TEMPLATE_KEY, value);
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
