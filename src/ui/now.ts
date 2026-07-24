/**
 * @module ui/now
 *
 * Current epoch milliseconds for dashboard UIs (log timestamps, cache freshness).
 * The widgets run outside Effect (plain React), so a direct `Date.now()` is correct here —
 * not `Clock`. Confined to this one helper so renderer modules stay clean.
 *
 */
import { utcDateFromMillis } from "../internal/utcDate";

/** Current epoch milliseconds. */
export const now = (): number => Date.now();

/** A `Date` for display formatting from epoch millis (UTC-constructed, formatted locally). */
export const dateFromMillis = (millis: number): Date => utcDateFromMillis(millis);

/** A compact 24-hour clock string (`HH:MM:SS`, no AM/PM) for log timestamps. */
export const fmtClock = (millis: number): string => dateFromMillis(millis).toLocaleTimeString([], { hour12: false });

/** Parse an `<input type="datetime-local">` value (local wall time) to epoch millis — `undefined`
 *  if blank/invalid. Confined here since it constructs a `Date` to interpret the local zone. */
export const millisFromLocalInput = (value: string): number | undefined => {
  if (value === "") return undefined;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? undefined : ms;
};

/** Epoch ms → the value an `<input type="datetime-local">` shows (local wall time). */
export const toLocalInput = (millis: number): string => {
  const d = dateFromMillis(millis);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

const DAY_MS = 86_400_000;

/** Local midnight (epoch ms) of the day containing `millis`. */
export const startOfDayMillis = (millis: number): number => {
  const d = dateFromMillis(millis);
  return (
    millis -
    (d.getHours() * 3_600_000 + d.getMinutes() * 60_000 + d.getSeconds() * 1_000 + d.getMilliseconds())
  );
};

/** Local midnight (epoch ms) of the Sunday that starts the week containing `millis`. */
export const startOfWeekMillis = (millis: number): number =>
  startOfDayMillis(millis) - dateFromMillis(millis).getDay() * DAY_MS;

/** A short weekday + day-of-month label for a day, e.g. "Mon 3". */
export const fmtDayLabel = (millis: number): string =>
  dateFromMillis(millis).toLocaleDateString([], { weekday: "short", day: "numeric" });
