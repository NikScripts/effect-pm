/**
 * Incremental part updates — the events that make text and reasoning stream
 * rather than appearing all at once.
 *
 * The server emits `message.part.delta` alongside `message.part.updated`:
 * `updated` fires twice per part (empty on creation, complete at the end),
 * while `delta` carries each chunk in between. Measured on this server, a
 * reasoning part sat "empty" for 62 seconds between its two `updated` events
 * — all of that content was arriving as deltas the client was ignoring.
 *
 * This event is not in the pinned v1 SDK's `Event` union; the running server
 * is newer than the generated types. Rather than cast the SDK's union to
 * something it does not declare, the payload is widened to `unknown` at the
 * call site and narrowed here by an actual runtime check — so if the shape
 * ever changes, this fails closed (deltas ignored, `updated` still lands the
 * final text) instead of throwing mid-stream.
 *
 * @internal
 */
import type { Transcript } from "./useSessionStream";

export type PartDeltaEvent = {
  readonly type: "message.part.delta";
  readonly properties: {
    readonly sessionID: string;
    readonly messageID: string;
    readonly partID: string;
    /** Which field of the part the chunk appends to, e.g. "text". */
    readonly field: string;
    readonly delta: string;
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const isPartDeltaEvent = (event: unknown): event is PartDeltaEvent => {
  if (!isRecord(event) || event.type !== "message.part.delta") return false;
  const properties = event.properties;
  if (!isRecord(properties)) return false;
  return (
    typeof properties.sessionID === "string" &&
    typeof properties.messageID === "string" &&
    typeof properties.partID === "string" &&
    typeof properties.field === "string" &&
    typeof properties.delta === "string"
  );
};

/**
 * Appends one chunk to the part it belongs to.
 *
 * Deltas for a part that hasn't been announced yet are dropped: the part's
 * `type` is only known from `message.part.updated`, and guessing it would put
 * the wrong renderer on the content. In practice the empty `updated` always
 * arrives first.
 */
export const withPartDelta = (transcript: Transcript, event: PartDeltaEvent): Transcript => {
  const { messageID, partID, field, delta } = event.properties;
  if (field !== "text" || delta === "") return transcript;

  const message = transcript.messages.get(messageID);
  if (message === undefined) return transcript;

  const part = message.parts.get(partID);
  if (part === undefined || (part.type !== "text" && part.type !== "reasoning")) return transcript;

  const parts = new Map(message.parts).set(partID, { ...part, text: part.text + delta });
  const messages = new Map(transcript.messages).set(messageID, { ...message, parts });
  return { ...transcript, messages };
};
