/**
 * Per-session read state — the timestamp you last had a session open. A
 * session counts as "unread" when its `time.updated` is newer than this, i.e.
 * the agent did something since you last looked. Local-only convenience (same
 * best-effort AsyncStorage reasoning as sessionCache.ts); losing it just resets
 * everything to unread.
 *
 * @internal
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "agent-console-native:sessionReads";

let inMemory: ReadonlyMap<string, number> | undefined;

export const loadReads = async (): Promise<ReadonlyMap<string, number>> => {
  if (inMemory !== undefined) return inMemory;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      inMemory = new Map();
      return inMemory;
    }
    const parsed = JSON.parse(raw) as Record<string, number>;
    const map = new Map<string, number>(Object.entries(parsed));
    inMemory = map;
    return map;
  } catch {
    return new Map();
  }
};

/** Record that `sessionID` was seen at `at` (ms). Merges into the stored map. */
export const markSessionRead = async (sessionID: string, at: number): Promise<void> => {
  const current = await loadReads();
  const next = new Map(current);
  next.set(sessionID, at);
  inMemory = next;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(next)));
  } catch {
    // Storage full/unavailable — read state just won't survive a restart, non-fatal.
  }
};
