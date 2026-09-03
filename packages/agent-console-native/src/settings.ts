/**
 * Persistent settings — AsyncStorage, not localStorage. Unlike the web app
 * (packages/agent-console), a native app has no "page origin" to resolve a
 * relative API path against (no Vite dev-server proxy either) — it needs an
 * explicit, user-configured server address before it can talk to OpenCode
 * at all. AsyncStorage reads are async (unlike localStorage), so callers
 * need a loading state while this resolves — there's no synchronous
 * equivalent here.
 *
 * Workspace layout prefs:
 * - root folder — discovery base
 * - repo template — where clone/create puts the **main** checkout
 * - worktree template — where “Create new…” puts **linked** worktrees
 * - default worktree — which checkout the composer picks first
 *
 * Existing checkouts are still discovered by scanning; templates only
 * decide where *new* paths are written.
 *
 * @internal
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { PermissionMode } from "./sessionPermissions";

const SERVER_ADDRESS_KEY = "agent-console-native:serverAddress";
const ROOT_DIR_KEY = "agent-console-native:rootDir";
const REPO_TEMPLATE_KEY = "agent-console-native:repoTemplate";
const WORKTREE_TEMPLATE_KEY = "agent-console-native:worktreeTemplate";
const DEFAULT_WORKTREE_PREF_KEY = "agent-console-native:defaultWorktreePreference";
const LAST_WORKTREE_BY_REPO_KEY = "agent-console-native:lastWorktreeByRepo";
const DEFAULT_PERMISSION_MODE_KEY = "agent-console-native:defaultPermissionMode";
const SESSION_PERMISSION_MODES_KEY = "agent-console-native:sessionPermissionModes";

/** Placeholders: `{root}`, `{repo}`. Destination for clone / `git init`. */
export const DEFAULT_REPO_TEMPLATE = "{root}/{repo}";

/** Placeholders: `{root}`, `{repo}`, `{name}`. Destination for linked worktrees. */
export const DEFAULT_WORKTREE_TEMPLATE = "{root}/{repo}/worktrees/{name}";

/** Which worktree to select when the user picks a repo in the composer. */
export type DefaultWorktreePreference = "main" | "last";

export const resolveRepoPath = (
  rootDir: string,
  repo: string,
  template: string = DEFAULT_REPO_TEMPLATE,
): string => template.replaceAll("{root}", rootDir).replaceAll("{repo}", repo);

export const resolveWorktreePath = (
  rootDir: string,
  repo: string,
  name: string,
  template: string = DEFAULT_WORKTREE_TEMPLATE,
): string =>
  template.replaceAll("{root}", rootDir).replaceAll("{repo}", repo).replaceAll("{name}", name);

export const getServerAddress = async (): Promise<string | undefined> => {
  const value = await AsyncStorage.getItem(SERVER_ADDRESS_KEY);
  return value ?? undefined;
};

export const setServerAddress = (value: string): Promise<void> =>
  AsyncStorage.setItem(SERVER_ADDRESS_KEY, value);

export const clearServerAddress = (): Promise<void> =>
  AsyncStorage.removeItem(SERVER_ADDRESS_KEY);

export const getRootDir = async (): Promise<string | undefined> => {
  const value = await AsyncStorage.getItem(ROOT_DIR_KEY);
  return value ?? undefined;
};

export const setRootDir = (value: string): Promise<void> => AsyncStorage.setItem(ROOT_DIR_KEY, value);

export const getRepoTemplate = async (): Promise<string> => {
  const value = await AsyncStorage.getItem(REPO_TEMPLATE_KEY);
  return value !== null && value.length > 0 ? value : DEFAULT_REPO_TEMPLATE;
};

export const setRepoTemplate = (value: string): Promise<void> =>
  AsyncStorage.setItem(REPO_TEMPLATE_KEY, value.trim().length === 0 ? DEFAULT_REPO_TEMPLATE : value.trim());

export const getWorktreeTemplate = async (): Promise<string> => {
  const value = await AsyncStorage.getItem(WORKTREE_TEMPLATE_KEY);
  return value !== null && value.length > 0 ? value : DEFAULT_WORKTREE_TEMPLATE;
};

export const setWorktreeTemplate = (value: string): Promise<void> =>
  AsyncStorage.setItem(
    WORKTREE_TEMPLATE_KEY,
    value.trim().length === 0 ? DEFAULT_WORKTREE_TEMPLATE : value.trim(),
  );

export const getDefaultWorktreePreference = async (): Promise<DefaultWorktreePreference> => {
  const value = await AsyncStorage.getItem(DEFAULT_WORKTREE_PREF_KEY);
  return value === "last" ? "last" : "main";
};

export const setDefaultWorktreePreference = (value: DefaultWorktreePreference): Promise<void> =>
  AsyncStorage.setItem(DEFAULT_WORKTREE_PREF_KEY, value);

export const getLastWorktreeByRepo = async (): Promise<Record<string, string>> => {
  const raw = await AsyncStorage.getItem(LAST_WORKTREE_BY_REPO_KEY);
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
  } catch {
    return {};
  }
};

export const setLastWorktreeForRepo = async (repo: string, worktreeKey: string): Promise<void> => {
  const current = await getLastWorktreeByRepo();
  await AsyncStorage.setItem(
    LAST_WORKTREE_BY_REPO_KEY,
    JSON.stringify({ ...current, [repo]: worktreeKey }),
  );
};

/** What new sessions start as. "full" unless explicitly changed — an
 * unreadable or unset value falls back to that rather than to the stricter
 * mode, so a storage failure cannot silently start gating every action. */
export const getDefaultPermissionMode = async (): Promise<PermissionMode> => {
  const value = await AsyncStorage.getItem(DEFAULT_PERMISSION_MODE_KEY);
  return value === "ask" ? "ask" : "full";
};

export const setDefaultPermissionMode = (value: PermissionMode): Promise<void> =>
  AsyncStorage.setItem(DEFAULT_PERMISSION_MODE_KEY, value);

/** Per-session overrides, stored as one blob rather than a key each: the
 * whole map is needed at boot anyway, and a single read avoids a multi-get
 * that grows with session count. Unparseable storage yields an empty map —
 * sessions fall back to the default rather than the read throwing at boot. */
export const getSessionPermissionModes = async (): Promise<Record<string, PermissionMode>> => {
  const raw = await AsyncStorage.getItem(SESSION_PERMISSION_MODES_KEY);
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, PermissionMode] => entry[1] === "full" || entry[1] === "ask"),
    );
  } catch {
    return {};
  }
};

export const setSessionPermissionModes = (value: Record<string, PermissionMode>): Promise<void> =>
  AsyncStorage.setItem(SESSION_PERMISSION_MODES_KEY, JSON.stringify(value));
