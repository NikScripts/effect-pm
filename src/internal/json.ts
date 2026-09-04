import { DateTime, Option, Schema } from "effect";

/**
 * Structural JSON value compatible with persisted payloads and queue attributes.
 *
 * @internal
 */
export type JsonValue =
  | null
  | string
  | number
  | boolean
  | { readonly [key: string]: JsonValue }
  | ReadonlyArray<JsonValue>;

/** Codec: JSON string ↔ unknown value. @internal */
export const responseBodyJson = Schema.fromJsonString(Schema.Unknown);
/** Codec: JSON string ↔ unknown (alias of the Schema primitive). @internal */
export const unknownJsonString = Schema.UnknownFromJsonString;

/** Narrow to a non-array JSON object. @internal */
export const isRecord = (
  value: unknown,
): value is { readonly [key: string]: unknown } =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Narrow to a string. @internal */
export const isString = (value: unknown): value is string =>
  typeof value === "string";

/** Narrow to a finite number (rejects NaN/Infinity). @internal */
export const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** Narrow to a boolean. @internal */
export const isBoolean = (value: unknown): value is boolean =>
  typeof value === "boolean";

/** Deep-narrow to a {@link JsonValue}. @internal */
export const isJsonValue = (value: unknown): value is JsonValue => {
  if (value === null || isString(value) || isFiniteNumber(value) || isBoolean(value)) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (isRecord(value)) {
    return Object.values(value).every(isJsonValue);
  }
  return false;
};

/** Epoch millis → a UTC `Date`. @internal */
export const dateFromMillis = (millis: number): Date =>
  DateTime.toDateUtc(DateTime.makeUnsafe(millis));

/** Best-effort epoch millis from a number/Date/parseable string, else `null`. @internal */
export const epochMillisFromUnknown = (value: unknown): number | null => {
  if (isFiniteNumber(value)) {
    return value;
  }
  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isNaN(millis) ? null : millis;
  }
  if (isString(value)) {
    return Option.match(DateTime.make(value), {
      onNone: () => null,
      onSome: (dateTime) => DateTime.toDateUtc(dateTime).getTime(),
    });
  }
  return null;
};

/** Best-effort UTC `Date` from an unknown value, else `null`. @internal */
export const dateFromUnknown = (value: unknown): Date | null => {
  const millis = epochMillisFromUnknown(value);
  return millis === null ? null : dateFromMillis(millis);
};
