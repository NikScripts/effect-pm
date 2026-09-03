/**
 * App-wide dependencies (the connected client, the server address, the
 * configured repo root) — provided once at the navigator's root, read by
 * any screen via `useAppContext()`. These aren't navigation params: they're
 * singletons for this run of the app, not per-route data, so threading
 * them through every route's params would be the wrong tool (that's what
 * `sessionID` on the Chat route is for — genuine per-route data).
 *
 * @internal
 */
import * as React from "react";
import type { OpencodeClient } from "./client";

type AppContextValue = {
  readonly client: OpencodeClient;
  readonly address: string;
  readonly rootDir: string;
  /** Persist and apply a new discovery root without tearing down the
   * connected session (unlike `onChangeServer`). */
  readonly onChangeRootDir: (rootDir: string) => void;
  /** Clears the saved server address and resets the app back to the
   * server-setup flow — not a normal in-stack navigation, since it tears
   * down the whole connected session, so it's a callback from the root
   * rather than something a screen could reach via `navigation`. */
  readonly onChangeServer: () => void;
};

const AppContext = React.createContext<AppContextValue | undefined>(undefined);

export const AppContextProvider = AppContext.Provider;

export const useAppContext = (): AppContextValue => {
  const value = React.useContext(AppContext);
  if (value === undefined) throw new Error("useAppContext() called outside AppContextProvider");
  return value;
};
