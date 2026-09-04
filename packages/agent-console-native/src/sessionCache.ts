/**
 * On-device session-list cache — same "store whatever makes the app feel
 * faster" reasoning as repoScanCache.ts. Shows the last-known list
 * instantly on cold start (no blank/loading flash) while a fresh fetch
 * runs in the background.
 *
 * @internal
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Session } from "@opencode-ai/sdk";

const STORAGE_KEY = "agent-console-native:sessions";

let inMemory: ReadonlyArray<Session> | undefined;

export const getCachedSessions = async (): Promise<ReadonlyArray<Session> | undefined> => {
  if (inMemory !== undefined) return inMemory;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw === null) return undefined;
    const parsed = JSON.parse(raw) as ReadonlyArray<Session>;
    inMemory = parsed;
    return parsed;
  } catch {
    return undefined;
  }
};

export const setCachedSessions = async (sessions: ReadonlyArray<Session>): Promise<void> => {
  inMemory = sessions;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    // Storage full/unavailable — cache just won't survive a restart, non-fatal.
  }
};
