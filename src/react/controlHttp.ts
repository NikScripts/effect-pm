/**
 * Browser-safe HTTP helpers for {@link ControlService} REST routes.
 *
 * @module react/controlHttp
 * @internal
 */
// @effect-diagnostics asyncFunction:off globalFetch:off strictBooleanExpressions:off — browser-facing Promise fetch API for React adapters.

import { Data, Schema } from "effect";
import type { ControlResponse } from "../ControlProtocol.js";
import { ControlResponseSchema } from "../ControlProtocol.js";
import {
  ProcessGroupContractSchema,
  type ProcessGroupDetails,
  type QueueDetails,
} from "../ProcessGroup.js";

/** Combined group status payload from `GET /status`. */
export interface ControlPlaneGroupStatus {
  readonly processes: ReadonlyArray<ProcessGroupDetails>;
  readonly queues: ReadonlyArray<QueueDetails>;
}

/** @public */
export class ControlPlaneRequestError extends Data.TaggedError("ControlPlaneRequestError")<{
  readonly reason: string;
}> {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** @internal */
export const isProcessGroupDetails = (value: unknown): value is ProcessGroupDetails =>
  isRecord(value)
  && typeof value["name"] === "string"
  && typeof value["type"] === "string"
  && typeof value["status"] === "string"
  && typeof value["uptime"] === "number";

/** @internal */
export const isQueueDetails = (value: unknown): value is QueueDetails =>
  isRecord(value)
  && typeof value["name"] === "string"
  && isRecord(value["size"])
  && typeof value["completed"] === "number";

const decodeControlResponseUnknown = (value: unknown): ControlResponse<unknown> => {
  const parsed = Schema.decodeUnknownOption(ControlResponseSchema)(value);
  if (parsed._tag === "Some") {
    return parsed.value;
  }
  return { success: false, error: "Malformed control-service response" };
};

const decodeGroupStatusData = (value: unknown): ControlPlaneGroupStatus | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const processes = Array.isArray(value["processes"])
    ? value["processes"].filter(isProcessGroupDetails)
    : [];
  const queues = Array.isArray(value["queues"])
    ? value["queues"].filter(isQueueDetails)
    : [];
  return { processes, queues };
};

export type ControlHttpRequestOptions = {
  readonly baseUrl: string;
  readonly defaultInit?: RequestInit;
  readonly mergeRequestInit?: (init: RequestInit) => RequestInit;
};

const normalizeBaseUrl = (baseUrl: string): string =>
  baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;

const mergeInit = (
  options: ControlHttpRequestOptions,
  init?: RequestInit,
): RequestInit => {
  const merged: RequestInit = {
    ...options.defaultInit,
    ...init,
    headers: {
      ...(options.defaultInit?.headers ?? {}),
      ...(init?.headers ?? {}),
    },
  };
  return options.mergeRequestInit !== undefined
    ? options.mergeRequestInit(merged)
    : merged;
};

const controlUrl = (options: ControlHttpRequestOptions, path: string): string =>
  `${normalizeBaseUrl(options.baseUrl)}${path.startsWith("/") ? path : `/${path}`}`;

const readJson = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (text.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ControlPlaneRequestError({ reason: "Response body is not valid JSON" });
  }
};

const assertOkControlResponse = (
  response: Response,
  body: ControlResponse<unknown>,
): ControlResponse<unknown> => {
  if (response.ok && body.success) {
    return body;
  }
  throw new ControlPlaneRequestError({
    reason: body.error ?? `HTTP ${String(response.status)}`,
  });
};

/** @internal */
export const controlHttpGet = async (
  options: ControlHttpRequestOptions,
  path: string,
  init?: RequestInit,
): Promise<ControlResponse<unknown>> => {
  const response = await fetch(controlUrl(options, path), mergeInit(options, {
    ...init,
    method: "GET",
  }));
  const json = await readJson(response);
  return assertOkControlResponse(response, decodeControlResponseUnknown(json));
};

/** @internal */
export const controlHttpPost = async (
  options: ControlHttpRequestOptions,
  path: string,
  init?: RequestInit,
): Promise<ControlResponse<unknown>> => {
  const response = await fetch(controlUrl(options, path), mergeInit(options, {
    ...init,
    method: "POST",
  }));
  const json = await readJson(response);
  return assertOkControlResponse(response, decodeControlResponseUnknown(json));
};

/** @internal */
export const controlHttpGetContract = async (
  options: ControlHttpRequestOptions,
  init?: RequestInit,
): Promise<typeof ProcessGroupContractSchema.Type> => {
  const response = await fetch(controlUrl(options, "/contract"), mergeInit(options, {
    ...init,
    method: "GET",
  }));
  const json = await readJson(response);
  if (!response.ok) {
    const asControl = decodeControlResponseUnknown(json);
    throw new ControlPlaneRequestError({
      reason: asControl.error ?? `HTTP ${String(response.status)}`,
    });
  }
  return Schema.decodeUnknownPromise(ProcessGroupContractSchema)(json);
};

/** @internal */
export const controlHttpGetGroupStatus = async (
  options: ControlHttpRequestOptions,
  init?: RequestInit,
): Promise<ControlPlaneGroupStatus> => {
  const body = await controlHttpGet(options, "/status", init);
  const status = decodeGroupStatusData(body.data);
  if (status === undefined) {
    throw new ControlPlaneRequestError({ reason: "Invalid group status payload" });
  }
  return status;
};
