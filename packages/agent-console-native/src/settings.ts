/**
 * Persistent settings — AsyncStorage, not localStorage. Unlike the web app
 * (packages/agent-console), a native app has no "page origin" to resolve a
 * relative API path against (no Vite dev-server proxy either) — it needs an
 * explicit, user-configured server address before it can talk to OpenCode
 * at all. AsyncStorage reads are async (unlike localStorage), so callers
 * need a loading state while this resolves — there's no synchronous
 * equivalent here.
 *
 * @internal
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const SERVER_ADDRESS_KEY = "agent-console-native:serverAddress";
const ROOT_DIR_KEY = "agent-console-native:rootDir";

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
