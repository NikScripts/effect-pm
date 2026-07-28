/**
 * Build Hyperlink Spec + handle shape for {@link Gate.HttpApiClient}.
 *
 * Routes are {@link Hyperlink.local}; the nest (default `"metrics"`) is wireable
 * limiter + usage observation (ApiMetrics absorb).
 *
 * @module internal/httpApiClientSpec
 * @internal
 */

import { Data, Schema } from "effect";
import { HttpApi } from "effect/unstable/httpapi";
import type { HttpApi as HttpApiType, HttpApiGroup } from "effect/unstable/httpapi";
import * as Hyperlink from "../Hyperlink";
import {
  apiUsageMetrics,
  apiUsageSnapshot,
} from "../ApiUsageSchema";
import { gateMetricsNestSpec } from "./gateSchema";

/** Fail-loud when an HttpApi group id collides with the metrics nest key. @public */
export class MetricsKeyCollision extends Data.TaggedError("MetricsKeyCollision")<{
  readonly metricsKey: string;
  readonly apiId: string;
}> {
  override get message(): string {
    return (
      `HttpApi group id "${this.metricsKey}" collides with Gate.HttpApiClient nest key ` +
      `on api "${this.apiId}". Rename the group or pass metricsKey: "…" (const).`
    );
  }
}

/**
 * Extended nest: R2 limiter fields + absorbed ApiMetrics `usage` / `windows`.
 *
 * @internal
 */
export const httpApiMetricsNestSpec = {
  ...gateMetricsNestSpec,
  usage: Hyperlink.ref(apiUsageSnapshot).annotate({
    description:
      "Cumulative usage snapshot — totals and top endpoints (`usage.get` / `usage.changes`).",
  }),
  windows: Hyperlink.stream(apiUsageMetrics).annotate({
    description:
      "Windowed API usage (requests, errors, throughput, per-endpoint) — absorbed ApiMetrics stream.",
  }),
} as const;

export type HttpApiMetricsNestSpec = typeof httpApiMetricsNestSpec;

/**
 * Assert no HttpApi group identifier equals `metricsKey`.
 *
 * @internal
 */
export const assertNoMetricsKeyCollision = <
  ApiId extends string,
  Groups extends HttpApiGroup.Constraint,
>(
  api: HttpApiType.HttpApi<ApiId, Groups>,
  metricsKey: string,
): void => {
  HttpApi.reflect(api, {
    onGroup({ group }) {
      if (group.identifier === metricsKey) {
        throw new MetricsKeyCollision({
          metricsKey,
          apiId: api.identifier,
        });
      }
    },
    onEndpoint() {},
  });
};

type SpecBucket = Record<string, typeof Hyperlink.local | Hyperlink.Spec>;

/**
 * Build a Spec: each non-topLevel group → nested bare locals; topLevel endpoints
 * on the root; nest under `metricsKey`.
 *
 * @internal
 */
export const buildHttpApiClientSpec = <
  ApiId extends string,
  Groups extends HttpApiGroup.Constraint,
>(
  api: HttpApiType.HttpApi<ApiId, Groups>,
  metricsKey: string,
): Hyperlink.Spec => {
  assertNoMetricsKeyCollision(api, metricsKey);
  const root: SpecBucket = {};
  const groups = new Map<string, SpecBucket>();

  HttpApi.reflect(api, {
    onGroup({ group }) {
      if (!group.topLevel) {
        groups.set(group.identifier, {});
      }
    },
    onEndpoint({ group, endpoint }) {
      if (group.topLevel) {
        root[endpoint.identifier] = Hyperlink.local;
        return;
      }
      const bucket = groups.get(group.identifier);
      if (bucket !== undefined) {
        bucket[endpoint.identifier] = Hyperlink.local;
      }
    },
  });

  const spec: SpecBucket = { ...root };
  for (const [id, bucket] of groups) {
    spec[id] = bucket;
  }
  spec[metricsKey] = httpApiMetricsNestSpec;
  return spec;
};

/** Idle limiter field schemas — used only for documentation / tests. @internal */
export const idleLimiterSchemas = {
  remaining: Schema.Number,
  resetAfter: Schema.Number,
  exceeded: Schema.Number,
} as const;
