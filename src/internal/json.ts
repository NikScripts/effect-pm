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

export const responseBodyJson = Schema.fromJsonString(Schema.Unknown);
export const unknownJsonString = Schema.UnknownFromJsonString;

export const isRecord = (
  value: unknown,
): value is { readonly [key: string]: unknown } =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isString = (value: unknown): value is string =>
  typeof value === "string";

export const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export const isBoolean = (value: unknown): value is boolean =>
  typeof value === "boolean";

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

export const dateFromMillis = (millis: number): Date =>
  DateTime.toDateUtc(DateTime.makeUnsafe(millis));

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

export const dateFromUnknown = (value: unknown): Date | null => {
  const millis = epochMillisFromUnknown(value);
  return millis === null ? null : dateFromMillis(millis);
};
