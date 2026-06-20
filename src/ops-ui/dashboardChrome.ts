/**
 * Dashboard chrome state for fixed top/side/bottom regions.
 *
 * @module ops-ui/dashboardChrome
 */
// @effect-diagnostics globalThis:off globalThisInEffect:off — browser-local chrome persistence lives in ops-ui.

import { useCallback, useMemo, useState } from "react";

export interface DashboardChromeState {
  readonly leftBarOpen: boolean;
  readonly rightBarOpen: boolean;
  readonly bottomBarOpen: boolean;
}

export type DashboardChromeChange = (state: DashboardChromeState) => void;

export const defaultDashboardChromeState: DashboardChromeState = {
  leftBarOpen: true,
  rightBarOpen: false,
  bottomBarOpen: true,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const parseDashboardChromeState = (value: unknown): DashboardChromeState | null => {
  if (!isRecord(value)) {
    return null;
  }
  const leftBarOpen = value["leftBarOpen"];
  const rightBarOpen = value["rightBarOpen"];
  const bottomBarOpen = value["bottomBarOpen"];
  if (
    typeof leftBarOpen !== "boolean" ||
    typeof rightBarOpen !== "boolean" ||
    typeof bottomBarOpen !== "boolean"
  ) {
    return null;
  }
  return { leftBarOpen, rightBarOpen, bottomBarOpen };
};

const readStoredChrome = (storageKey: string | undefined): DashboardChromeState | null => {
  if (storageKey === undefined || typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(storageKey);
    return raw === null ? null : parseDashboardChromeState(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
};

const writeStoredChrome = (storageKey: string | undefined, state: DashboardChromeState): void => {
  if (storageKey === undefined || typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // Chrome persistence should never break operator controls.
  }
};

export interface UseDashboardChromeOptions {
  readonly chrome?: DashboardChromeState;
  readonly chromeStorageKey?: string;
  readonly onChromeChange?: DashboardChromeChange;
}

export interface DashboardChromeController {
  readonly chrome: DashboardChromeState;
  readonly setChrome: (update: (state: DashboardChromeState) => DashboardChromeState) => void;
  readonly resetChrome: () => void;
  readonly toggleLeftBar: () => void;
  readonly toggleRightBar: () => void;
  readonly toggleBottomBar: () => void;
}

export const useDashboardChrome = ({
  chrome,
  chromeStorageKey,
  onChromeChange,
}: UseDashboardChromeOptions): DashboardChromeController => {
  const [internalChrome, setInternalChrome] = useState<DashboardChromeState>(() =>
    readStoredChrome(chromeStorageKey) ?? chrome ?? defaultDashboardChromeState,
  );
  const current = chrome ?? internalChrome;

  const commit = useCallback(
    (next: DashboardChromeState) => {
      if (chrome === undefined) {
        setInternalChrome(next);
        writeStoredChrome(chromeStorageKey, next);
      }
      onChromeChange?.(next);
    },
    [chrome, chromeStorageKey, onChromeChange],
  );

  const setChrome = useCallback(
    (update: (state: DashboardChromeState) => DashboardChromeState) => {
      commit(update(current));
    },
    [commit, current],
  );

  const resetChrome = useCallback(() => commit(defaultDashboardChromeState), [commit]);
  const toggleLeftBar = useCallback(
    () => setChrome((state) => ({ ...state, leftBarOpen: !state.leftBarOpen })),
    [setChrome],
  );
  const toggleRightBar = useCallback(
    () => setChrome((state) => ({ ...state, rightBarOpen: !state.rightBarOpen })),
    [setChrome],
  );
  const toggleBottomBar = useCallback(
    () => setChrome((state) => ({ ...state, bottomBarOpen: !state.bottomBarOpen })),
    [setChrome],
  );

  return useMemo(
    () => ({
      chrome: current,
      resetChrome,
      setChrome,
      toggleBottomBar,
      toggleLeftBar,
      toggleRightBar,
    }),
    [current, resetChrome, setChrome, toggleBottomBar, toggleLeftBar, toggleRightBar],
  );
};
