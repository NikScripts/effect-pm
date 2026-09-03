/**
 * Push registration and tap handling.
 *
 * The device registers its Expo push token with the vite backend, which is the
 * thing that can actually observe a run finishing — this app only holds an SSE
 * connection while the chat is focused and foregrounded, so it is by
 * definition not watching when a notification would matter.
 *
 * Native modules are loaded with `require` inside a try/catch rather than at
 * module scope, because a top-level import of a module missing from the binary
 * throws before the app can mount. They are NOT loaded with dynamic `import()`:
 * in React Native that fetches an async chunk through the dev server and fails
 * with "Expected HMRClient.setup() call at startup" whether or not the module
 * exists. `require` is synchronous, needs no chunk, and still only evaluates
 * when this code runs.
 *
 * The module is validated structurally instead of being trusted, so a partial
 * or unlinked native module reports what is missing rather than throwing
 * somewhere further along.
 *
 * @internal
 */
declare const require: (moduleName: string) => unknown;

/** Only the members used here. Deliberately not the module's full type: this
 * is what we depend on, and what a runtime check can honestly verify. */
export type NotificationsApi = {
  readonly getPermissionsAsync: () => Promise<{ readonly granted: boolean }>;
  readonly requestPermissionsAsync: () => Promise<{ readonly granted: boolean }>;
  readonly getExpoPushTokenAsync: (options: { readonly projectId: string }) => Promise<{ readonly data: string }>;
  readonly setNotificationHandler: (handler: unknown) => void;
  readonly addNotificationResponseReceivedListener: (listener: (response: unknown) => void) => { remove: () => void };
  readonly getLastNotificationResponseAsync: () => Promise<unknown>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const REQUIRED_MEMBERS = [
  "getPermissionsAsync",
  "requestPermissionsAsync",
  "getExpoPushTokenAsync",
  "setNotificationHandler",
  "addNotificationResponseReceivedListener",
  "getLastNotificationResponseAsync",
] as const;

const isNotificationsApi = (value: unknown): value is NotificationsApi =>
  isRecord(value) && REQUIRED_MEMBERS.every((member) => typeof value[member] === "function");

/** The session on screen right now, or undefined. Module state rather than
 * something the server tracks: the notification is delivered to this app, so
 * the app is the right place to decide whether to show it — and that needs no
 * endpoint, no network round trip, and cannot race with itself. */
let viewedSessionID: string | undefined;

export const setViewedSession = (sessionID: string | undefined): void => {
  viewedSessionID = sessionID;
};

let cached: NotificationsApi | undefined;
let attempted = false;
/** Why the last load failed, verbatim. Reported in Settings — a generic
 * "unavailable" sent us chasing the wrong problem twice already. */
let loadError: string | undefined;

export const getLoadError = (): string | undefined => loadError;

export const loadNotifications = (): NotificationsApi | undefined => {
  if (attempted) return cached;
  attempted = true;

  let loaded: unknown;
  try {
    loaded = require("expo-notifications");
  } catch (error: unknown) {
    loadError = `require failed: ${String(error)}`;
    return undefined;
  }

  if (!isNotificationsApi(loaded)) {
    const present = isRecord(loaded) ? REQUIRED_MEMBERS.filter((m) => typeof loaded[m] === "function") : [];
    loadError = `expo-notifications loaded but incomplete (has ${present.length}/${REQUIRED_MEMBERS.length} members)`;
    return undefined;
  }

  try {
    // A banner is still wanted while the app is open but on another screen:
    // the notification is about a session you are not looking at, which is the
    // entire point of it. Presentation only — a failure here does not stop
    // registration or delivery, so it must not fail the load.
    loaded.setNotificationHandler({
      handleNotification: async (notification: unknown) => {
        // Suppressed only for the session already on screen. Anything else —
        // another session, or this one while you are elsewhere in the app —
        // is still worth a banner. This handler runs only while the app is
        // foregrounded; backgrounded delivery is the system's call, which is
        // correct, because then you are not watching anything.
        const payload = payloadOfNotification(notification);
        const showing =
          payload?.sessionID === undefined || payload.sessionID !== viewedSessionID;
        return {
          shouldShowBanner: showing,
          shouldShowList: showing,
          shouldPlaySound: showing,
          shouldSetBadge: false,
        };
      },
    });
  } catch (error: unknown) {
    loadError = `handler setup failed (non-fatal): ${String(error)}`;
  }

  cached = loaded;
  return cached;
};

export type PushPayload = {
  readonly kind: "idle" | "permission" | "test";
  readonly sessionID?: string;
};

/** Reads a notification's data defensively — it crosses a network boundary
 * and is typed as an open record. Pure, so it never touches native code. */
export const asPushPayload = (data: unknown): PushPayload | undefined => {
  if (!isRecord(data)) return undefined;
  const kind = data.kind;
  if (kind !== "idle" && kind !== "permission" && kind !== "test") return undefined;
  return { kind, sessionID: typeof data.sessionID === "string" ? data.sessionID : undefined };
};

/** Digs the payload out of a notification without assuming its shape. */
export const payloadOfNotification = (notification: unknown): PushPayload | undefined => {
  if (!isRecord(notification)) return undefined;
  const request = notification.request;
  if (!isRecord(request)) return undefined;
  const content = request.content;
  if (!isRecord(content)) return undefined;
  return asPushPayload(content.data);
};

/** Digs the payload out of a notification response without assuming its shape. */
export const payloadOfResponse = (response: unknown): PushPayload | undefined => {
  if (!isRecord(response)) return undefined;
  const notification = response.notification;
  if (!isRecord(notification)) return undefined;
  const request = notification.request;
  if (!isRecord(request)) return undefined;
  const content = request.content;
  if (!isRecord(content)) return undefined;
  return asPushPayload(content.data);
};

export type PushResult =
  | { readonly ok: true; readonly token: string; readonly registered: boolean }
  | { readonly ok: false; readonly reason: string };

/**
 * Asks for permission, obtains an Expo push token and registers it with the
 * backend. Never throws: a build without the module, a simulator, a denied
 * prompt or a missing project id are all normal states.
 */
export const registerForPush = async (backendAddress: string): Promise<PushResult> => {
  const notifications = loadNotifications();
  if (notifications === undefined) {
    return { ok: false, reason: getLoadError() ?? "expo-notifications unavailable" };
  }

  // A simulator has no APNs registration; asking produces a confusing error
  // rather than a token.
  let deviceName = "iOS";
  try {
    const device = require("expo-device");
    if (isRecord(device)) {
      if (device.isDevice === false) return { ok: false, reason: "not a physical device" };
      if (typeof device.deviceName === "string") deviceName = device.deviceName;
    }
  } catch {
    // expo-device is optional; its absence only costs a nicer label.
  }

  const existing = await notifications.getPermissionsAsync().catch((error: unknown) => String(error));
  if (typeof existing === "string") return { ok: false, reason: `permission check failed: ${existing}` };

  let granted = existing.granted;
  if (!granted) {
    const requested = await notifications.requestPermissionsAsync().catch((error: unknown) => String(error));
    if (typeof requested === "string") return { ok: false, reason: `permission request failed: ${requested}` };
    granted = requested.granted;
  }
  if (!granted) return { ok: false, reason: "notifications denied in iOS settings" };

  let projectId: unknown;
  try {
    const constants = require("expo-constants");
    const value = isRecord(constants) && isRecord(constants.default) ? constants.default : constants;
    if (isRecord(value)) {
      const expoConfig = isRecord(value.expoConfig) ? value.expoConfig : undefined;
      const extra = expoConfig !== undefined && isRecord(expoConfig.extra) ? expoConfig.extra : undefined;
      const eas = extra !== undefined && isRecord(extra.eas) ? extra.eas : undefined;
      projectId = eas?.projectId;
    }
  } catch (error: unknown) {
    return { ok: false, reason: `expo-constants unavailable: ${String(error)}` };
  }
  if (typeof projectId !== "string") return { ok: false, reason: "no EAS projectId in app config" };

  const token = await notifications
    .getExpoPushTokenAsync({ projectId })
    .then((result) => result.data)
    .catch((error: unknown) => String(error));
  if (!token.startsWith("ExponentPushToken")) return { ok: false, reason: `token failed: ${token}` };

  const response = await fetch(`${backendAddress}/push/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, deviceName }),
  }).catch(() => undefined);

  return { ok: true, token, registered: response?.ok === true };
};
