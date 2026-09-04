/**
 * Live Activity control.
 *
 * iOS only, and only on a build that contains the native module — every entry
 * point degrades to a no-op rather than throwing, so a session behaves
 * normally on a binary without it.
 *
 * Loaded with `requireOptionalNativeModule`, not a static import: a missing
 * native module must not take down the bundle, and a dynamic `import()` in
 * React Native fetches an async chunk and fails with
 * "Expected HMRClient.setup() call at startup" regardless of whether the
 * module exists.
 *
 * @internal
 */
import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

type LiveActivityNative = {
  readonly isSupported: () => boolean;
  readonly start: (
    sessionID: string,
    repo: string,
    worktree: string,
    title: string,
    action: string,
  ) => Promise<string | null>;
  readonly update: (sessionID: string, status: string, action: string, messageCount: number) => Promise<boolean>;
  readonly end: (sessionID: string, status: string) => Promise<boolean>;
  readonly endAll: () => Promise<number>;
};

const native =
  Platform.OS === "ios" ? requireOptionalNativeModule<LiveActivityNative>("LiveActivity") : null;

export const liveActivitySupported = (): boolean => {
  if (native === null) return false;
  try {
    return native.isSupported();
  } catch {
    return false;
  }
};

export const startLiveActivity = async (input: {
  readonly sessionID: string;
  readonly repo: string;
  readonly worktree: string;
  readonly title: string;
  readonly action: string;
}): Promise<void> => {
  if (native === null) return;
  await native
    .start(input.sessionID, input.repo, input.worktree, input.title, input.action)
    .catch(() => null);
};

export const updateLiveActivity = async (input: {
  readonly sessionID: string;
  readonly status: "working" | "done" | "error";
  readonly action: string;
  readonly messageCount: number;
}): Promise<void> => {
  if (native === null) return;
  await native.update(input.sessionID, input.status, input.action, input.messageCount).catch(() => false);
};

export const endLiveActivity = async (sessionID: string, status: "done" | "error"): Promise<void> => {
  if (native === null) return;
  await native.end(sessionID, status).catch(() => false);
};

export const endAllLiveActivities = async (): Promise<void> => {
  if (native === null) return;
  await native.endAll().catch(() => 0);
};
