/**
 * Push notifications for sessions the app is not watching.
 *
 * The client cannot do this itself. It only holds an SSE connection while the
 * chat is focused and the app is foregrounded (see useStreamEnabled), and iOS
 * suspends a backgrounded socket without closing it — so "the agent finished
 * while I was elsewhere" is exactly the case the client cannot observe. This
 * server is already awake and already connected, so it watches for the events
 * that matter and pushes.
 *
 * Two events are worth interrupting someone for:
 *
 * - `session.idle` — the run finished and is waiting on you.
 * - a permission ask — the run is BLOCKED and will sit there indefinitely
 *   until answered. Arguably the more urgent of the two.
 *
 * Delivery goes through Expo's push service rather than APNs directly: the
 * device tokens are Expo tokens, and hand-rolling APNs would mean managing a
 * `.p8` key, JWT signing and per-environment topics for no benefit here.
 *
 * Tokens are persisted to disk. A dev server restarts constantly, and losing
 * every registration on restart would make notifications appear broken in
 * exactly the way that is hardest to debug.
 *
 * @internal
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Connect, Plugin } from "vite";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
/** Expo needs a moment to hand the message to APNs before a receipt exists. */
const RECEIPT_DELAY_MS = 6000;
const OPENCODE_URL = process.env.AGENT_CONSOLE_OPENCODE_URL ?? "http://127.0.0.1:4096";
const TOKENS_FILE = ".agent-console/push-tokens.json";

/** Sessions the app creates for its own `git worktree` plumbing. They run and
 * go idle like any other session, and notifying about them is pure noise — the
 * client already hides them from its lists. */
const HIDDEN_TITLE_PREFIX = "[worktree-setup]";

/** A run shorter than this finished before you could have looked away, so an
 * alert about it interrupts for nothing. Permission asks ignore this: those
 * block regardless of how quickly they arrive. */
const MIN_RUN_MS = 8_000;

/** Reconnect backoff for the event stream, capped. */
const MAX_RECONNECT_MS = 30_000;

type Registration = {
  readonly token: string;
  readonly deviceName?: string;
  readonly registeredAt: number;
};

type PushMessage = {
  readonly to: string;
  readonly title: string;
  readonly body: string;
  readonly sound: "default";
  readonly data: Record<string, unknown>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readJson = async (req: Connect.IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
};

export const notificationsPlugin = (): Plugin => {
  const root = resolve(process.env.AGENT_CONSOLE_FILES_ROOT ?? process.cwd());
  const tokensPath = resolve(root, TOKENS_FILE);

  const registrations = new Map<string, Registration>();
  /** Sessions mid-run and when they started, so `session.idle` only notifies
   * for a run we actually saw start — without this, every idle event on
   * connect would fire for work that finished hours ago — and so a run's
   * duration is known when deciding whether it is worth interrupting for. */
  const busySessions = new Map<string, number>();

  /** The session currently on screen in a foregrounded app. Notifying about
   * the thing you are already watching is the most annoying case of all. */
  let activeSessionID: string | undefined;
  /** Suppresses a duplicate push when the same session is answered and
   * re-blocks quickly. */
  const lastNotifiedAt = new Map<string, number>();

  const load = async (): Promise<void> => {
    const raw = await readFile(tokensPath, "utf8").catch(() => undefined);
    if (raw === undefined) return;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      for (const entry of parsed) {
        if (isRecord(entry) && typeof entry.token === "string") {
          registrations.set(entry.token, {
            token: entry.token,
            deviceName: typeof entry.deviceName === "string" ? entry.deviceName : undefined,
            registeredAt: typeof entry.registeredAt === "number" ? entry.registeredAt : Date.now(),
          });
        }
      }
    } catch {
      // A corrupt file must not stop the server booting; registrations simply
      // start empty and the app re-registers on next launch.
    }
  };

  const persist = async (): Promise<void> => {
    await mkdir(dirname(tokensPath), { recursive: true }).catch(() => undefined);
    await writeFile(tokensPath, JSON.stringify([...registrations.values()], null, 2)).catch(() => undefined);
  };

  const send = async (message: Omit<PushMessage, "to">): Promise<void> => {
    if (registrations.size === 0) return;
    const messages: PushMessage[] = [...registrations.keys()].map((to) => ({ ...message, to }));

    const response = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(messages),
    }).catch(() => undefined);

    if (response === undefined || !response.ok) {
      console.warn("[push] send failed:", response?.status ?? "network error");
      return;
    }

    // Expo reports per-message errors in the body, not the status. A token
    // for a deleted app returns DeviceNotRegistered and must be dropped or it
    // fails on every future send.
    const payload: unknown = await response.json().catch(() => undefined);
    if (!isRecord(payload) || !Array.isArray(payload.data)) return;
    const ticketIds: string[] = [];
    payload.data.forEach((ticket: unknown, index: number) => {
      if (!isRecord(ticket)) return;
      if (ticket.status === "ok" && typeof ticket.id === "string") {
        ticketIds.push(ticket.id);
        return;
      }
      if (ticket.status !== "error") return;
      const details = isRecord(ticket.details) ? ticket.details : undefined;
      const token = messages[index]?.to;
      console.warn("[push] ticket error:", ticket.message, details?.error);
      if (details?.error === "DeviceNotRegistered" && token !== undefined) {
        registrations.delete(token);
        void persist();
      }
    });

    // An accepted ticket only means Expo queued it. Whether APNs actually
    // delivered — and why not — lives in the receipt, which is the only place
    // errors like InvalidCredentials or MismatchSenderId ever appear.
    if (ticketIds.length > 0) void checkReceipts(ticketIds);
  };

  /** Last receipt outcomes, newest first, exposed at GET /push/receipts.
   * Kept in memory: this is a debugging aid, not state worth persisting. */
  const recentReceipts: Array<{ at: number; id: string; status: string; error?: string; message?: string }> = [];

  const checkReceipts = async (ids: ReadonlyArray<string>): Promise<void> => {
    await new Promise((r) => setTimeout(r, RECEIPT_DELAY_MS));
    const response = await fetch(EXPO_RECEIPTS_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ ids }),
    }).catch(() => undefined);
    if (response === undefined || !response.ok) {
      console.warn("[push] receipt fetch failed:", response?.status ?? "network error");
      return;
    }
    const payload: unknown = await response.json().catch(() => undefined);
    if (!isRecord(payload) || !isRecord(payload.data)) return;

    for (const [id, receipt] of Object.entries(payload.data)) {
      if (!isRecord(receipt)) continue;
      const details = isRecord(receipt.details) ? receipt.details : undefined;
      const entry = {
        at: Date.now(),
        id,
        status: typeof receipt.status === "string" ? receipt.status : "unknown",
        error: typeof details?.error === "string" ? details.error : undefined,
        message: typeof receipt.message === "string" ? receipt.message : undefined,
      };
      recentReceipts.unshift(entry);
      if (recentReceipts.length > 20) recentReceipts.pop();
      if (entry.status !== "ok") {
        console.warn("[push] receipt", entry.status, entry.error ?? "", entry.message ?? "");
      } else {
        console.info("[push] receipt ok", id);
      }
    }
  };

  /** Suppress repeats within this window per session+kind. */
  const DEDUPE_MS = 3_000;
  const shouldNotify = (key: string): boolean => {
    const now = Date.now();
    const previous = lastNotifiedAt.get(key);
    if (previous !== undefined && now - previous < DEDUPE_MS) return false;
    lastNotifiedAt.set(key, now);
    return true;
  };

  /** Titles change rarely and this runs per notification, so results are kept
   * rather than re-fetched on every event. */
  const hiddenCache = new Map<string, boolean>();

  const isHidden = async (sessionID: string): Promise<boolean> => {
    const cached = hiddenCache.get(sessionID);
    if (cached !== undefined) return cached;
    const title = await titleOf(sessionID);
    const hidden = title.startsWith(HIDDEN_TITLE_PREFIX);
    hiddenCache.set(sessionID, hidden);
    return hidden;
  };

  const titleOf = async (sessionID: string): Promise<string> => {
    const response = await fetch(`${OPENCODE_URL}/session/${sessionID}`).catch(() => undefined);
    if (response === undefined || !response.ok) return "Session";
    const body: unknown = await response.json().catch(() => undefined);
    if (isRecord(body) && typeof body.title === "string") return body.title;
    return "Session";
  };

  const watch = async (): Promise<void> => {
    let delay = 1000;
    for (;;) {
      try {
        const response = await fetch(`${OPENCODE_URL}/global/event`);
        if (response.body === null) throw new Error("no body");
        delay = 1000;

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            let raw: unknown;
            try {
              raw = JSON.parse(line.slice(6));
            } catch {
              continue;
            }
            const event = isRecord(raw) && isRecord(raw.payload) ? raw.payload : raw;
            if (!isRecord(event)) continue;

            const properties = isRecord(event.properties) ? event.properties : isRecord(event.data) ? event.data : {};
            const sessionID = typeof properties.sessionID === "string" ? properties.sessionID : undefined;

            if (event.type === "message.updated" || event.type === "message.part.delta") {
              if (sessionID !== undefined && !busySessions.has(sessionID)) {
                busySessions.set(sessionID, Date.now());
              }
              continue;
            }

            if (event.type === "permission.asked" || event.type === "permission.v2.asked") {
              if (sessionID === undefined || !shouldNotify(`ask:${sessionID}`)) continue;
              if (sessionID === activeSessionID) continue;
              if (await isHidden(sessionID)) continue;
              const action =
                typeof properties.permission === "string"
                  ? properties.permission
                  : typeof properties.action === "string"
                    ? properties.action
                    : "an action";
              await send({
                title: await titleOf(sessionID),
                body: `Waiting for approval: ${action}`,
                sound: "default",
                data: { kind: "permission", sessionID },
              });
              continue;
            }

            if (event.type === "session.idle" && sessionID !== undefined) {
              const startedAt = busySessions.get(sessionID);
              busySessions.delete(sessionID);
              if (startedAt === undefined) continue;
              if (Date.now() - startedAt < MIN_RUN_MS) continue;
              if (sessionID === activeSessionID) continue;
              if (!shouldNotify(`idle:${sessionID}`)) continue;
              if (await isHidden(sessionID)) continue;
              await send({
                title: await titleOf(sessionID),
                body: "Finished.",
                sound: "default",
                data: { kind: "idle", sessionID },
              });
            }
          }
        }
      } catch {
        // opencode restarts frequently in development; reconnect quietly.
      }
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, MAX_RECONNECT_MS);
    }
  };

  const handler: Connect.NextHandleFunction = (req, res, next) => {
    const url = req.url ?? "";
    if (!url.startsWith("/push")) {
      next();
      return;
    }
    const json = (status: number, body: unknown): void => {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(body));
    };

    void (async () => {
      const path = url.split("?")[0];

      if (path === "/push/register" && req.method === "POST") {
        const body = await readJson(req);
        if (!isRecord(body) || typeof body.token !== "string" || body.token === "") {
          json(400, { error: "Expected { token: string, deviceName?: string }" });
          return;
        }
        registrations.set(body.token, {
          token: body.token,
          deviceName: typeof body.deviceName === "string" ? body.deviceName : undefined,
          registeredAt: Date.now(),
        });
        await persist();
        json(200, { registered: registrations.size });
        return;
      }

      if (path === "/push/test" && req.method === "POST") {
        // Captured before sending: a send can drop tokens it discovers are
        // dead, and reporting the count afterwards says how many survived
        // rather than how many were tried.
        const attempted = registrations.size;
        await send({
          title: "DoubleAgent",
          body: "Test notification.",
          sound: "default",
          data: { kind: "test" },
        });
        json(200, { attempted, remaining: registrations.size });
        return;
      }

      if (path === "/push/active" && req.method === "POST") {
        const body = await readJson(req);
        activeSessionID =
          isRecord(body) && typeof body.sessionID === "string" && body.sessionID !== ""
            ? body.sessionID
            : undefined;
        json(200, { activeSessionID: activeSessionID ?? null });
        return;
      }

      if (path === "/push/receipts" && req.method === "GET") {
        json(200, { data: recentReceipts });
        return;
      }

      if (path === "/push" && req.method === "GET") {
        json(200, {
          data: [...registrations.values()].map((r) => ({
            deviceName: r.deviceName,
            registeredAt: r.registeredAt,
            token: `${r.token.slice(0, 12)}…`,
          })),
        });
        return;
      }

      json(404, { error: "Not found" });
    })();
  };

  return {
    name: "agent-console-notifications",
    configureServer(server) {
      server.middlewares.use(handler);
      void load().then(() => {
        server.config.logger.info(`  ->  push:    /push/register  (${registrations.size} device(s), watching ${OPENCODE_URL})`);
        void watch();
      });
    },
  };
};
