/**
 * NWSL SDP date/time decoding standard.
 *
 * **Wire format:** ISO-8601 strings (full instants or date-only such as `YYYY-MM-DD`), as returned by the API.
 *
 * **Decoded type:** `DateTime.Utc` from `effect` — use {@link import("effect/DateTime").lessThan}, {@link import("effect/DateTime").Order},
 * {@link import("effect/DateTime").add}, {@link import("effect/DateTime").subtract}, and {@link import("effect/DateTime").distance}
 * instead of mutating `Date`.
 *
 * **Not converted:** free-text offsets (e.g. `localTimeUtcOffset`) stay `string` until we confirm a stable format.
 */
import { Schema } from "effect";

/** Required instant (rare; prefer {@link NwslOptionalInstant} when the API can omit or null). */
export const NwslInstant = Schema.DateTimeUtcFromString;

/** Missing key, `null`, or an instant — matches, metadata, season bounds, DOB, etc. */
export const NwslOptionalInstant = Schema.optional(Schema.NullOr(Schema.DateTimeUtcFromString));
