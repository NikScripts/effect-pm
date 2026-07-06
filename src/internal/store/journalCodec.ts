/**
 * MessagePack encode/decode for {@link EventJournal} store row payloads.
 *
 * @module internal/store/journalCodec
 * @internal
 */

import { Effect } from "effect";
import * as Msgpackr from "msgpackr";
import { toJsonValue } from "./helpers";
import { StoreJournalDecodeError, StoreJournalEncodeError } from "./errors";

/** @internal */
export const encodeJournalPayload = (
  payload: unknown,
): Effect.Effect<Uint8Array<ArrayBuffer>, StoreJournalEncodeError> =>
  Effect.try({
    try: () => Msgpackr.encode(toJsonValue(payload)) as Uint8Array<ArrayBuffer>,
    catch: (cause) =>
      new StoreJournalEncodeError({
        cause,
        detail: "Failed to MessagePack-encode store row payload",
      }),
  });

/** @internal */
export const decodeJournalPayload = (
  bytes: Uint8Array,
): Effect.Effect<unknown, StoreJournalDecodeError> =>
  Effect.try({
    try: () => Msgpackr.decode(bytes) as unknown,
    catch: (cause) =>
      new StoreJournalDecodeError({
        cause,
        detail: "Failed to MessagePack-decode store row payload",
      }),
  });
