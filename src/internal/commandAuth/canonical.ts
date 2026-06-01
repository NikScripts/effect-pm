import { Effect } from "effect";
import type {
  CommandAuthSigningInput,
  CanonicalCommandAuthRequest,
} from "../../CommandAuth";
import { CanonicalPayloadError } from "./errors";

const canonicalRequest = (
  request: CommandAuthSigningInput["envelope"]["request"],
): CanonicalCommandAuthRequest => {
  switch (request._tag) {
    case "GetContract":
    case "ReadGroupStatus":
    case "ListProcesses":
    case "ListQueues":
      return { _tag: request._tag };
    case "ReadProcessStatus":
    case "StartProcess":
    case "StopProcess":
    case "RestartProcess":
    case "RunProcessImmediately":
      return { _tag: request._tag, processId: request.processId };
    case "ReadQueueStatus":
    case "StartQueue":
    case "PauseQueue":
    case "ResumeQueue":
    case "ClearQueue":
      return { _tag: request._tag, queueId: request.queueId };
  }
};

const escapeJsonString = (value: string): string =>
  value.replace(/[\u0000-\u001f"\\]/g, (character) => {
    switch (character) {
      case "\"":
        return "\\\"";
      case "\\":
        return "\\\\";
      case "\b":
        return "\\b";
      case "\f":
        return "\\f";
      case "\n":
        return "\\n";
      case "\r":
        return "\\r";
      case "\t":
        return "\\t";
      default: {
        const code = character.charCodeAt(0).toString(16).padStart(4, "0");
        return `\\u${code}`;
      }
    }
  });

const jsonString = (value: string): string => `"${escapeJsonString(value)}"`;

const canonicalRequestText = (
  request: CanonicalCommandAuthRequest,
): string => {
  switch (request._tag) {
    case "GetContract":
    case "ReadGroupStatus":
    case "ListProcesses":
    case "ListQueues":
      return `{"_tag":${jsonString(request._tag)}}`;
    case "ReadProcessStatus":
    case "StartProcess":
    case "StopProcess":
    case "RestartProcess":
    case "RunProcessImmediately":
      return `{"_tag":${jsonString(request._tag)},"processId":${jsonString(request.processId)}}`;
    case "ReadQueueStatus":
    case "StartQueue":
    case "PauseQueue":
    case "ResumeQueue":
    case "ClearQueue":
      return `{"_tag":${jsonString(request._tag)},"queueId":${jsonString(request.queueId)}}`;
  }
};

const metadataText = (
  metadata: CommandAuthSigningInput["envelope"]["metadata"],
): string | undefined => {
  if (metadata === undefined) {
    return undefined;
  }
  const fields: string[] = [];
  if (metadata.actor !== undefined) {
    fields.push(`"actor":${jsonString(metadata.actor)}`);
  }
  if (metadata.reason !== undefined) {
    fields.push(`"reason":${jsonString(metadata.reason)}`);
  }
  if (metadata.traceId !== undefined) {
    fields.push(`"traceId":${jsonString(metadata.traceId)}`);
  }
  return `{${fields.join(",")}}`;
};

export const canonicalPayloadText = (
  input: CommandAuthSigningInput,
): Effect.Effect<string, CanonicalPayloadError> =>
  Effect.try({
    try: () => {
      const metadata = metadataText(input.envelope.metadata);
      const envelopeFields = [
        `"id":${jsonString(input.envelope.id)}`,
        ...(metadata === undefined ? [] : [`"metadata":${metadata}`]),
        `"request":${canonicalRequestText(canonicalRequest(input.envelope.request))}`,
        `"sentAt":${String(input.envelope.sentAt)}`,
      ];
      return `{"envelope":{${envelopeFields.join(",")}},"method":${jsonString(input.method)},"path":${jsonString(input.path)},"version":"effect-pm-command-auth-v1"}`;
    },
    catch: (error) =>
      new CanonicalPayloadError({
        reason: `Unable to encode canonical command auth payload: ${String(error)}`,
      }),
  });

export const canonicalPayload = (
  input: CommandAuthSigningInput,
): Effect.Effect<Uint8Array, CanonicalPayloadError> =>
  Effect.map(canonicalPayloadText(input), (text) => new TextEncoder().encode(text));
