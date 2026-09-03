/**
 * Permission asks, per session.
 *
 * The server can pause a run to ask before a tool acts — it emits
 * `permission.asked` (v1) or `permission.v2.asked` (v2) and waits for a reply.
 * Nothing in this app answered those, so any agent configured to ask would
 * hang indefinitely with no visible cause: the run simply stopped, mid-turn,
 * looking identical to a slow model.
 *
 * Default is `full`: asks are answered `once` automatically, so an agent has
 * full control and never stalls. `ask` hands each request to the UI instead.
 * Toggled per session from the chat's overflow menu.
 *
 * `once` rather than `always` even on auto-approve — `always` writes a saved
 * rule server-side that outlives this session and applies beyond it, which is
 * not what a per-session toggle should silently do.
 *
 * Both the per-session choice and the default for new sessions persist across
 * launches, so a session set to ask stays that way and one set to allow all
 * does not have to be re-approved every launch.
 *
 * @internal
 */
import { setSessionPermissionModes } from "./settings";

export type PermissionMode = "full" | "ask";
export type PermissionReply = "once" | "always" | "reject";

const modes = new Map<string, PermissionMode>();

/** What a session with no explicit choice uses. Held here rather than read
 * from storage on demand because the event handler that needs it runs inside
 * the stream loop, where an async read would race the reply. App.tsx primes
 * it at boot from `settings.getDefaultPermissionMode`. */
let defaultMode: PermissionMode = "full";

export const primeDefaultPermissionMode = (mode: PermissionMode): void => {
  defaultMode = mode;
};

export const getDefaultPermissionModeSync = (): PermissionMode => defaultMode;

export const getPermissionMode = (sessionID: string): PermissionMode => modes.get(sessionID) ?? defaultMode;

export const setPermissionMode = (sessionID: string, mode: PermissionMode): void => {
  modes.set(sessionID, mode);
  // Write-through, fire and forget: the in-memory map is the source of truth
  // for this launch, and a failed write only costs the choice on next launch.
  void setSessionPermissionModes(Object.fromEntries(modes));
};

/** Restores saved per-session choices. Called once at boot, before any
 * session opens — see App.tsx. */
export const primeSessionPermissionModes = (saved: Record<string, PermissionMode>): void => {
  for (const [sessionID, mode] of Object.entries(saved)) modes.set(sessionID, mode);
};

/** A pending ask, normalized across the v1 and v2 event shapes. */
export type PendingPermission = {
  readonly requestID: string;
  readonly sessionID: string;
  /** What is being asked for, e.g. a tool name or action. */
  readonly action: string;
  /** Concrete targets — file paths, commands — when the server names them. */
  readonly resources: ReadonlyArray<string>;
  readonly api: "v1" | "v2";
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const asStrings = (value: unknown): ReadonlyArray<string> =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

/**
 * Narrowed by runtime check rather than off the SDK's `Event` union: neither
 * ask event is in the pinned v1 types, and the running server is newer. Fails
 * closed — an unrecognized shape is ignored rather than throwing mid-stream.
 */
export const asPendingPermission = (event: unknown): PendingPermission | undefined => {
  if (!isRecord(event)) return undefined;

  if (event.type === "permission.asked" && isRecord(event.properties)) {
    const p = event.properties;
    if (typeof p.id !== "string" || typeof p.sessionID !== "string") return undefined;
    return {
      requestID: p.id,
      sessionID: p.sessionID,
      action: typeof p.permission === "string" ? p.permission : "this action",
      resources: asStrings(p.patterns),
      api: "v1",
    };
  }

  if (event.type === "permission.v2.asked") {
    // v2 carries its payload under `data`, not `properties`.
    const p = isRecord(event.data) ? event.data : isRecord(event.properties) ? event.properties : undefined;
    if (p === undefined) return undefined;
    if (typeof p.id !== "string" || typeof p.sessionID !== "string") return undefined;
    return {
      requestID: p.id,
      sessionID: p.sessionID,
      action: typeof p.action === "string" ? p.action : "this action",
      resources: asStrings(p.resources),
      api: "v2",
    };
  }

  return undefined;
};

/**
 * Answers an ask. Uses raw fetch rather than the SDK client because the v2
 * endpoints do not exist in the pinned v1 surface.
 *
 * Throws on a non-2xx so callers can surface it: a silently dropped reply
 * leaves the run wedged, which is the exact failure this module exists to fix.
 */
export const replyToPermission = async (
  address: string,
  pending: PendingPermission,
  reply: PermissionReply,
): Promise<void> => {
  const path =
    pending.api === "v1"
      ? `/permission/${pending.requestID}/reply`
      : `/api/session/${pending.sessionID}/permission/${pending.requestID}/reply`;

  const response = await fetch(`${address}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reply }),
  });

  if (!response.ok) {
    throw new Error(`Permission reply failed: HTTP ${response.status} ${await response.text()}`);
  }
};
