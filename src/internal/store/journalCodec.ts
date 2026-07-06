/**
 * MessagePack encode/decode for {@link EventJournal} store row payloads.
 *
 * Uses {@link Msgpack.schema} from `effect/unstable/encoding/Msgpack` — no direct
 * `msgpackr` dependency in this package.
 *
 * @module internal/store/journalCodec
 * @internal
 */

import { Effect, Schema } from "effect";
import * as Msgpack from "effect/unstable/encoding/Msgpack";
import { toJsonValue } from "./helpers";
import { StoreJournalDecodeError, StoreJournalEncodeError } from "./errors";

const journalPayloadBytes = Msgpack.schema(Schema.Json);

/** @internal */
export const encodeJournalPayload = (
  payload: unknown,
): Effect.Effect<Uint8Array<ArrayBuffer>, StoreJournalEncodeError> =>
  Schema.encodeUnknownEffect(journalPayloadBytes)(toJsonValue(payload)).pipe(
    Effect.mapError(
      (cause) =>
        new StoreJournalEncodeError({
          cause,
          detail: "Failed to MessagePack-encode store row payload",
        }),
    ),
  );

/** @internal */
export const decodeJournalPayload = (
  bytes: Uint8Array,
): Effect.Effect<unknown, StoreJournalDecodeError> =>
  Schema.decodeUnknownEffect(journalPayloadBytes)(bytes).pipe(
    Effect.mapError(
      (cause) =>
        new StoreJournalDecodeError({
          cause,
          detail: "Failed to MessagePack-decode store row payload",
        }),
    ),
  );
