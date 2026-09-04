/**
 * Background wallpapers, in three tiers — app-wide, per-repo, per-worktree —
 * resolved most-specific first (worktree → repo → app → none). The picked image
 * is copied into the app's document directory (persistent) and its uri recorded
 * per scope in AsyncStorage.
 *
 * @internal
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { File, Paths } from "expo-file-system";

const STORAGE_KEY = "agent-console-native:wallpapers";

export type WallpaperScope = {
  readonly repo?: string;
  readonly worktree?: string;
};

let inMemory: Map<string, string> | undefined;

const readMap = async (): Promise<Map<string, string>> => {
  if (inMemory !== undefined) return inMemory;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    inMemory = raw === null ? new Map() : new Map(Object.entries(JSON.parse(raw) as Record<string, string>));
  } catch {
    inMemory = new Map();
  }
  return inMemory;
};

const persist = async (map: Map<string, string>): Promise<void> => {
  inMemory = map;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(map)));
  } catch {
    // Best-effort local storage — a lost write just means re-picking.
  }
};

/** The single storage key for a scope. `{}` → "app". */
export const scopeKey = (scope: WallpaperScope): string => {
  if (scope.repo !== undefined && scope.worktree !== undefined) return `worktree:${scope.repo}/${scope.worktree}`;
  if (scope.repo !== undefined) return `repo:${scope.repo}`;
  return "app";
};

/** Keys to try for a scope, most specific first. */
const candidates = (scope: WallpaperScope): ReadonlyArray<string> => {
  const keys: string[] = [];
  if (scope.repo !== undefined && scope.worktree !== undefined) keys.push(`worktree:${scope.repo}/${scope.worktree}`);
  if (scope.repo !== undefined) keys.push(`repo:${scope.repo}`);
  keys.push("app");
  return keys;
};

export const loadWallpapers = (): Promise<ReadonlyMap<string, string>> => readMap();

/** First wallpaper set for this scope, most specific first. */
export const resolveWallpaper = (map: ReadonlyMap<string, string>, scope: WallpaperScope): string | undefined => {
  for (const key of candidates(scope)) {
    const uri = map.get(key);
    if (uri !== undefined) return uri;
  }
  return undefined;
};

const extensionOf = (uri: string): string => {
  const match = /\.([a-zA-Z0-9]+)(?:\?|#|$)/.exec(uri);
  return match !== null ? match[1].toLowerCase() : "jpg";
};

/** Copy a picked image into the document dir and record it for `key`. */
export const setWallpaper = async (key: string, sourceUri: string): Promise<void> => {
  const map = new Map(await readMap());
  const filename = `wallpaper-${key.replace(/[^a-zA-Z0-9]+/g, "_")}.${extensionOf(sourceUri)}`;
  const dest = new File(Paths.document, filename);
  try {
    dest.delete();
  } catch {
    // Not there yet — copy below will create it.
  }
  await new File(sourceUri).copy(dest);
  map.set(key, dest.uri);
  await persist(map);
};

/** Remove the wallpaper for `key` and delete its file. */
export const clearWallpaper = async (key: string): Promise<void> => {
  const map = new Map(await readMap());
  const uri = map.get(key);
  if (uri !== undefined) {
    try {
      new File(uri).delete();
    } catch {
      // Already gone — fine.
    }
  }
  map.delete(key);
  await persist(map);
};
