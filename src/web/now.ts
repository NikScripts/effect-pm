/**
 * @module web/now
 *
 * Current epoch milliseconds for the browser dashboard (log timestamps, cache freshness).
 * The widgets run outside Effect (plain React), so a direct `Date.now()` is correct here —
 * not `Clock`. Confined to this one helper so the rest of `src/web` stays clean.
 *
 * @since 1.0.0
 */
import { utcDateFromMillis } from "../internal/utcDate";

/** Current epoch milliseconds. @since 1.0.0 */
// @effect-diagnostics-next-line globalDate:off
export const now = (): number => Date.now();

/** A `Date` for display formatting from epoch millis (UTC-constructed, formatted locally). @since 1.0.0 */
export const dateFromMillis = (millis: number): Date => utcDateFromMillis(millis);

/** A compact 24-hour clock string (`HH:MM:SS`, no AM/PM) for log timestamps. @since 1.0.0 */
export const fmtClock = (millis: number): string => dateFromMillis(millis).toLocaleTimeString([], { hour12: false });

/** Parse an `<input type="datetime-local">` value (local wall time) to epoch millis — `undefined`
 *  if blank/invalid. Confined here since it constructs a `Date` to interpret the local zone. @since 1.0.0 */
export const millisFromLocalInput = (value: string): number | undefined => {
  if (value === "") return undefined;
  // @effect-diagnostics-next-line globalDate:off
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? undefined : ms;
};
