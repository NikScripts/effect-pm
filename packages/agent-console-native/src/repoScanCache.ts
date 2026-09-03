/**
 * Caches the repoScan.ts result on-device (AsyncStorage) so it survives an
 * app restart, with staleness-based auto-refresh — same shape as the web
 * app's repoScanCache.ts, ported for AsyncStorage's async reads (no
 * synchronous cache read possible here, unlike localStorage).
 *
 * Home Workspaces and the composer picker share one pipeline: expand root →
 * scanRepos → subtract unclaimed folders under that same expanded root.
 * Repo labels are always `ScannedRepo.repo` from the scan (git remote name).
 * Folders never supply repo names.
 *
 * @internal
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { OpencodeClient } from "./client";
import type { FolderTarget } from "./HomeTargetPickers";
import { expandHome } from "./homeDir";
import { listOtherFolders } from "./otherFolders";
import { type ScannedRepo, scanRepos } from "./repoScan";

const STORAGE_KEY = "agent-console-native:repoScan";
const LAST_SCAN_KEY = "agent-console-native:lastScanAt";

/** Bump whenever repoScan.ts's algorithm changes — see the web app's own
 * repoScanCache.ts for why this matters: an already-open client with a
 * scan cached under an older, buggier algorithm must not keep rendering it
 * past its staleness timer. */
const SCAN_VERSION = 4;

const STALE_AFTER_MS = 30 * 60 * 1000;

type Persisted = { readonly version: number; readonly repos: ReadonlyArray<ScannedRepo> };

export type WorkspaceIndex = {
  readonly repos: ReadonlyArray<ScannedRepo>;
  readonly otherFolders: ReadonlyArray<FolderTarget>;
};

let inMemory: ReadonlyArray<ScannedRepo> | undefined;
let inFlight: Promise<ReadonlyArray<ScannedRepo>> | undefined;

export const getCachedRepos = async (): Promise<ReadonlyArray<ScannedRepo> | undefined> => {
  if (inMemory !== undefined) return inMemory;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw === null) return undefined;
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    if (parsed.version !== SCAN_VERSION || parsed.repos === undefined) return undefined;
    inMemory = parsed.repos;
    return parsed.repos;
  } catch {
    return undefined;
  }
};

export const getLastScanAt = async (): Promise<number | undefined> => {
  const raw = await AsyncStorage.getItem(LAST_SCAN_KEY);
  if (raw === null) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const isStale = async (): Promise<boolean> => {
  const at = await getLastScanAt();
  return at === undefined || Date.now() - at > STALE_AFTER_MS;
};

export const rescan = (client: OpencodeClient, rootDir: string): Promise<ReadonlyArray<ScannedRepo>> => {
  if (inFlight !== undefined) return inFlight;
  inFlight = expandHome(client, rootDir)
    .then((expanded) => scanRepos(client, expanded))
    .then(async (repos) => {
      inMemory = repos;
      const toStore: Persisted = { version: SCAN_VERSION, repos };
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
      await AsyncStorage.setItem(LAST_SCAN_KEY, String(Date.now()));
      return repos;
    })
    .finally(() => {
      inFlight = undefined;
    });
  return inFlight;
};

const indexFromRepos = async (
  client: OpencodeClient,
  rootDir: string,
  repos: ReadonlyArray<ScannedRepo>,
): Promise<WorkspaceIndex> => {
  const expanded = await expandHome(client, rootDir);
  const otherFolders = await listOtherFolders(client, expanded, repos);
  return { repos, otherFolders };
};

/** Cached scan + folder subtract under the same expanded root. */
export const readWorkspace = async (
  client: OpencodeClient,
  rootDir: string,
): Promise<WorkspaceIndex | undefined> => {
  const repos = await getCachedRepos();
  if (repos === undefined) return undefined;
  return indexFromRepos(client, rootDir, repos);
};

/** Fresh scan + folder subtract — single source for Home + composer picker. */
export const refreshWorkspace = async (
  client: OpencodeClient,
  rootDir: string,
): Promise<WorkspaceIndex> => {
  const repos = await rescan(client, rootDir);
  return indexFromRepos(client, rootDir, repos);
};
