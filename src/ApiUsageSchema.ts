/**
 * Wire schemas for API usage observability.
 *
 * @module ApiUsageSchema
 */
import { Schema } from "effect";

/**
 * Per-endpoint counts within one metrics window.
 *
 * @public
 */
export const apiUsageEndpointMetrics = Schema.Struct({
  group: Schema.String,
  endpoint: Schema.String,
  requests: Schema.Number,
  errors: Schema.Number,
  avgDurationMs: Schema.optionalKey(Schema.Number),
});

/**
 * Windowed API usage metrics — element of the {@link ApiMetrics} `metrics` stream.
 *
 * @public
 */
export const apiUsageMetrics = Schema.Struct({
  windowStart: Schema.DateTimeUtc,
  windowEnd: Schema.DateTimeUtc,
  windowMillis: Schema.Number,
  requests: Schema.Number,
  errors: Schema.Number,
  inFlight: Schema.Number,
  throughputPerSec: Schema.Number,
  byEndpoint: Schema.Array(apiUsageEndpointMetrics),
});

/**
 * Point-in-time API usage snapshot — element of the {@link ApiMetrics} `usage` ref (`usage.get`).
 *
 * @public
 */
export const apiUsageSnapshot = Schema.Struct({
  clientId: Schema.String,
  inFlight: Schema.Number,
  requestsTotal: Schema.Number,
  errorsTotal: Schema.Number,
  topEndpoints: Schema.Array(
    Schema.Struct({
      group: Schema.String,
      endpoint: Schema.String,
      requests: Schema.Number,
      errors: Schema.Number,
    }),
  ),
});

/**
 * @public
 */
export type ApiUsageMetrics = typeof apiUsageMetrics.Type;

/**
 * @public
 */
export type ApiUsageSnapshot = typeof apiUsageSnapshot.Type;
