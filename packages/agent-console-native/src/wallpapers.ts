/**
 * Background wallpapers, in three scope tiers — app-wide, per-repo,
 * per-worktree — each with surface toggles for WHERE it applies: the scope's
 * home screen, all pages, and chat sessions.
 *
 * Resolution is override-not-inherit by scope: the most-specific scope with a
 * wallpaper wins entirely (a repo/worktree/session wallpaper replaces the
 * app's, it doesn't blend). That winning wallpaper then paints a given surface
 * only if its toggle for that surface is on.
 *
 * The picked image is copied into the app's document directory (persistent) and
 * the entry recorded per scope in AsyncStorage.
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

/** Where a wallpaper is allowed to paint. */
export type WallpaperSurface = "home" | "pages" | "chat";

export type WallpaperEntry = {
  readonly uri: string;
  readonly surfaces: Readonly<Record<WallpaperSurface, boolean>>;
};

/** A freshly-picked wallpaper starts as the home background only. */
export const DEFAULT_SURFACES: Readonly<Record<WallpaperSurface, boolean>> = { home: true, pages: false, chat: false };

let inMemory: Map<string, WallpaperEntry> | undefined;

const readMap = async (): Promise<Map<string, WallpaperEntry>> => {
  if (inMemory !== undefined) return inMemory;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    inMemory = raw === null ? new Map() : new Map(Object.entries(JSON.parse(raw) as Record<string, WallpaperEntry>));
  } catch {
    inMemory = new Map();
  }
  return inMemory;
};

const persist = async (map: Map<string, WallpaperEntry>): Promise<void> => {
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

export const loadWallpapers = (): Promise<ReadonlyMap<string, WallpaperEntry>> => readMap();

/**
 * The wallpaper uri to paint for a given scope + surface, or undefined. The
 * most-specific scope with an entry overrides the rest; it paints `surface`
 * only if its toggle for that surface is on.
 */
export const resolveWallpaper = (map: ReadonlyMap<string, WallpaperEntry>, scope: WallpaperScope, surface: WallpaperSurface): string | undefined => {
  for (const key of candidates(scope)) {
    const entry = map.get(key);
    if (entry !== undefined) return entry.surfaces[surface] ? entry.uri : undefined;
  }
  return undefined;
};

const extensionOf = (uri: string): string => {
  const match = /\.([a-zA-Z0-9]+)(?:\?|#|$)/.exec(uri);
  return match !== null ? match[1].toLowerCase() : "jpg";
};

/** Copy a picked image into the document dir and record it for `key`, keeping
 * existing surface toggles or defaulting to home-only. */
export const setWallpaperImage = async (key: string, sourceUri: string): Promise<void> => {
  const map = new Map(await readMap());
  const filename = `wallpaper-${key.replace(/[^a-zA-Z0-9]+/g, "_")}.${extensionOf(sourceUri)}`;
  const dest = new File(Paths.document, filename);
  try {
    dest.delete();
  } catch {
    // Not there yet — copy below will create it.
  }
  await new File(sourceUri).copy(dest);
  const existing = map.get(key);
  map.set(key, { uri: dest.uri, surfaces: existing?.surfaces ?? DEFAULT_SURFACES });
  await persist(map);
};

/** Toggle whether `key`'s wallpaper paints `surface`. No-op if none set. */
export const setWallpaperSurface = async (key: string, surface: WallpaperSurface, on: boolean): Promise<void> => {
  const map = new Map(await readMap());
  const entry = map.get(key);
  if (entry === undefined) return;
  map.set(key, { ...entry, surfaces: { ...entry.surfaces, [surface]: on } });
  await persist(map);
};

/** Remove the wallpaper for `key` and delete its file. */
export const clearWallpaper = async (key: string): Promise<void> => {
  const map = new Map(await readMap());
  const entry = map.get(key);
  if (entry !== undefined) {
    try {
      new File(entry.uri).delete();
    } catch {
      // Already gone — fine.
    }
  }
  map.delete(key);
  await persist(map);
};
