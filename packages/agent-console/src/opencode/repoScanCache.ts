/**
 * Caches the (expensive — one shell round-trip per repo) repoScan.ts result,
 * persisted to localStorage so it survives a reload, with staleness-based
 * auto-refresh plus a manual trigger (Settings' "Rescan" button).
 *
 * @internal
 */
import { type ScannedRepo, scanRepos } from "./repoScan";
import { getLastScanAt, setLastScanAt } from "./settings";

const STORAGE_KEY = "agent-console:repoScan";

/** How stale the cache can get before a Home mount triggers a background
 * rescan on its own — "occasional", not on every render. */
const STALE_AFTER_MS = 30 * 60 * 1000;

let inMemory: ReadonlyArray<ScannedRepo> | undefined;
let inFlight: Promise<ReadonlyArray<ScannedRepo>> | undefined;

const readPersisted = (): ReadonlyArray<ScannedRepo> | undefined => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return undefined;
    return JSON.parse(raw) as ReadonlyArray<ScannedRepo>;
  } catch {
    return undefined;
  }
};

const persist = (repos: ReadonlyArray<ScannedRepo>): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(repos));
  } catch {
    // Storage full/unavailable — cache just won't survive reload, non-fatal.
  }
};

/** Cached repos, synchronously — `undefined` only on a genuine cold start
 * (nothing in memory or localStorage yet). */
export const getCachedRepos = (): ReadonlyArray<ScannedRepo> | undefined => {
  if (inMemory !== undefined) return inMemory;
  const persisted = readPersisted();
  if (persisted !== undefined) inMemory = persisted;
  return persisted;
};

export const isStale = (): boolean => {
  const lastScan = getLastScanAt();
  return lastScan === undefined || Date.now() - lastScan > STALE_AFTER_MS;
};

/** Runs a fresh scan, updates both caches. Concurrent callers share one
 * in-flight scan rather than each kicking off their own. */
export const rescan = (rootDir: string): Promise<ReadonlyArray<ScannedRepo>> => {
  if (inFlight !== undefined) return inFlight;
  inFlight = scanRepos(rootDir)
    .then((repos) => {
      inMemory = repos;
      persist(repos);
      setLastScanAt(Date.now());
      return repos;
    })
    .finally(() => {
      inFlight = undefined;
    });
  return inFlight;
};
