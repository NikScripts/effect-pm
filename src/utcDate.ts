/**
 * UTC **`Date`** construction via {@link DateTime} instead of `new Date(...)`.
 *
 * @remarks
 * Keeps tests and examples aligned with **`globalDate`** / **`globalDateInEffect`**
 * rules from `@effect/language-service`: wall-clock instants are built from
 * `DateTime` and converted with {@link DateTime.toDateUtc}.
 *
 * Not part of the published package entrypoint; import from `src/utcDate` in
 * this repo only.
 *
 * @module utcDate
 */

import { DateTime } from "effect";

/**
 * @param millis - Epoch milliseconds (UTC interpretation matches `DateTime.makeUnsafe`).
 * @returns A `Date` in UTC (via `DateTime.toDateUtc`).
 * @internal
 */
export const utcDateFromMillis = (millis: number): Date =>
  DateTime.toDateUtc(DateTime.makeUnsafe(millis));

/**
 * @param iso - ISO-8601 instant string accepted by `DateTime.makeUnsafe`.
 * @returns A `Date` in UTC (via `DateTime.toDateUtc`).
 * @internal
 */
export const utcDateFromIso = (iso: string): Date =>
  DateTime.toDateUtc(DateTime.makeUnsafe(iso));
