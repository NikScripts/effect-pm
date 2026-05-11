import { DateTime } from "effect";

/**
 * UTC `Date` from epoch milliseconds without `new Date()` (satisfies `effect(globalDate)`).
 *
 * @internal
 */
export const utcDateFromMillis = (millis: number): Date =>
  DateTime.toDateUtc(DateTime.makeUnsafe(millis));

/**
 * UTC `Date` from an ISO-8601 string without `new Date()` (satisfies `effect(globalDate)`).
 *
 * @internal
 */
export const utcDateFromIso = (iso: string): Date =>
  DateTime.toDateUtc(DateTime.makeUnsafe(iso));
