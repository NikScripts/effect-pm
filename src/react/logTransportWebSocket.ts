/**
 * Browser WebSocket client for {@link logTransport} live log streaming.
 *
 * @module react/logTransportWebSocket
 * @internal
 */
// @effect-diagnostics globalFetch:off strictBooleanExpressions:off — browser WebSocket log transport client.

import { Schema } from "effect";
import {
  ProcessManagerLogEntrySchema,
  type ProcessManagerLogEntry,
} from "../LogEntry.js";
import {
  logTransportWebSocketUrl,
  type LogStreamRequest,
  type LogStreamScope,
} from "../logTransport.js";
import { ControlPlaneRequestError } from "./controlHttp.js";
import type {
  ControlPlaneLogSession,
  ControlPlaneLogsParams,
} from "./ControlPlanePort.js";
import {
  logFiltersForDashboardTarget,
  type DashboardLogFilters,
  type DashboardTarget,
} from "./dashboardTarget.js";
import type { ControlHttpRequestOptions } from "./controlHttp.js";

type RpcChunkMessage = {
  readonly _tag: "Chunk";
  readonly requestId: string;
  readonly values: ReadonlyArray<unknown>;
};

type RpcExitMessage = {
  readonly _tag: "Exit";
  readonly requestId: string;
  readonly exit: unknown;
};

type RpcWireMessage =
  | RpcChunkMessage
  | RpcExitMessage
  | { readonly _tag: "Pong" }
  | { readonly _tag: "Defect"; readonly defect: unknown }
  | { readonly _tag: "ClientProtocolError"; readonly error: unknown };

const streamDone = Symbol("streamDone");

type QueueItem = ProcessManagerLogEntry | ControlPlaneRequestError | typeof streamDone;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const parseWireMessage = (line: string): RpcWireMessage | undefined => {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch {
    throw new ControlPlaneRequestError({
      reason: "Log transport line is not valid JSON",
    });
  }
  if (!isRecord(json) || typeof json["_tag"] !== "string") {
    throw new ControlPlaneRequestError({
      reason: "Log transport line is not a valid RPC message",
    });
  }
  return json as RpcWireMessage;
};

const decodeLogEntry = (value: unknown): ProcessManagerLogEntry => {
  try {
    return Schema.decodeUnknownSync(ProcessManagerLogEntrySchema)(value);
  } catch {
    throw new ControlPlaneRequestError({
      reason: "Log transport returned a malformed log entry",
    });
  }
};

const parentPath = (id: string): string => {
  const idx = id.lastIndexOf("/");
  return idx === -1 ? id : id.slice(0, idx);
};

const scopeFromDashboardFilters = (
  filters: DashboardLogFilters,
): LogStreamScope | undefined => {
  if (filters.groupId !== undefined) {
    return { _tag: "group", groupId: filters.groupId };
  }
  if (filters.processId !== undefined) {
    return {
      _tag: "process",
      groupId: parentPath(filters.processId),
      processId: filters.processId,
    };
  }
  if (filters.queueId !== undefined) {
    return {
      _tag: "queue",
      groupId: parentPath(filters.queueId),
      queueId: filters.queueId,
    };
  }
  return undefined;
};

const logStreamRequestFromParams = (
  params: ControlPlaneLogsParams<DashboardTarget>,
): LogStreamRequest => {
  const scope = scopeFromDashboardFilters(logFiltersForDashboardTarget(params.for));
  return {
    follow: params.follow !== false,
    ...(params.lines !== undefined ? { preludeLines: params.lines } : {}),
    ...(scope !== undefined ? { scope } : {}),
  };
};

const exitReason = (exit: unknown): string => {
  if (!isRecord(exit)) {
    return "Log transport stream failed";
  }
  if (exit["_tag"] === "Failure" && Array.isArray(exit["cause"])) {
    return exit["cause"]
      .map((item) => (isRecord(item) ? JSON.stringify(item) : String(item)))
      .join("; ");
  }
  return "Log transport stream ended";
};

async function* streamLogTransportEntries(
  websocketUrl: string,
  request: LogStreamRequest,
  signal: AbortSignal,
): AsyncGenerator<ProcessManagerLogEntry> {
  const requestId = "1";
  const socket = new WebSocket(websocketUrl);
  const queue: QueueItem[] = [];
  let wake: (() => void) | undefined;
  let buffered = "";
  let finished = false;

  const notify = (): void => {
    wake?.();
    wake = undefined;
  };

  const push = (item: QueueItem): void => {
    if (finished) {
      return;
    }
    if (item === streamDone) {
      finished = true;
    }
    if (item instanceof ControlPlaneRequestError) {
      finished = true;
    }
    queue.push(item);
    notify();
  };

  const take = async (): Promise<QueueItem> => {
    while (queue.length === 0) {
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
    return queue.shift()!;
  };

  const closeSocket = (): void => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(`${JSON.stringify({ _tag: "Interrupt", requestId })}\n`);
    }
    socket.close();
  };

  signal.addEventListener("abort", closeSocket, { once: true });

  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener(
      "error",
      () =>
        reject(
          new ControlPlaneRequestError({
            reason: "Log transport WebSocket failed to connect",
          }),
        ),
      { once: true },
    );
  });

  socket.send(
    `${JSON.stringify({
      _tag: "Request",
      id: requestId,
      tag: "Log.Stream",
      payload: request,
      headers: [],
    })}\n`,
  );

  const handleLines = (chunk: string): void => {
    buffered += chunk;
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";

    for (const line of lines) {
      const message = parseWireMessage(line);
      if (message === undefined) {
        continue;
      }
      switch (message._tag) {
        case "Chunk": {
          if (message.requestId !== requestId) {
            continue;
          }
          socket.send(`${JSON.stringify({ _tag: "Ack", requestId })}\n`);
          for (const value of message.values) {
            push(decodeLogEntry(value));
          }
          break;
        }
        case "Exit": {
          if (message.requestId !== requestId) {
            continue;
          }
          const exit = message.exit;
          if (isRecord(exit) && exit["_tag"] === "Success") {
            push(streamDone);
            return;
          }
          push(
            new ControlPlaneRequestError({
              reason: exitReason(exit),
            }),
          );
          return;
        }
        case "Pong":
          break;
        case "Defect":
          push(
            new ControlPlaneRequestError({
              reason: `Log transport defect: ${String(message.defect)}`,
            }),
          );
          return;
        case "ClientProtocolError":
          push(
            new ControlPlaneRequestError({
              reason: `Log transport protocol error: ${String(message.error)}`,
            }),
          );
          return;
      }
    }
  };

  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") {
      push(
        new ControlPlaneRequestError({
          reason: "Log transport WebSocket returned a non-text frame",
        }),
      );
      return;
    }
    handleLines(event.data);
  });

  socket.addEventListener("close", () => {
    if (!finished) {
      push(
        new ControlPlaneRequestError({
          reason: "Log transport WebSocket closed unexpectedly",
        }),
      );
    }
  });

  try {
    while (true) {
      const item = await take();
      if (item === streamDone) {
        return;
      }
      if (item instanceof ControlPlaneRequestError) {
        throw item;
      }
      yield item;
    }
  } finally {
    closeSocket();
  }
}

/** @internal */
export const controlHttpLogs = (
  options: ControlHttpRequestOptions,
  params: ControlPlaneLogsParams<DashboardTarget>,
): ControlPlaneLogSession => {
  const controller = new AbortController();
  const websocketUrl = logTransportWebSocketUrl(options.baseUrl);
  const request = logStreamRequestFromParams(params);
  const entries = streamLogTransportEntries(websocketUrl, request, controller.signal);
  return {
    entries,
    close: () => controller.abort(),
  };
};
