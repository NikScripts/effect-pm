/**
 * @module HostStatus
 *
 * **Host status** — the reserved resource every host serves automatically (via
 * {@link Resource.serveAllHttp}): is it up, when did it start, how long has it been up, how many
 * resources does it serve, plus its runtime-wide {@link HostLogs} (`logs` stream + `logHistory`)
 * and a `ping`. The host author wires nothing; clients just point a transport at the host.
 *
 * The tag is **hostless** — query a specific host by pointing the ambient `RpcClient.Protocol` at
 * that host's `/rpc`. {@link HostStatus.clientHttp} is the batteries-included http client; for any
 * other transport, provide your own `RpcClient.Protocol` to `Resource.client(HostStatus.Tag)`.
 *
 * ```ts
 * yield* Effect.gen(function* () {
 *   const host = yield* HostStatus.Tag;
 *   const snap = yield* host.statusNow; // { up, startedAt, uptimeMillis, resourceCount }
 * }).pipe(Effect.provide(HostStatus.clientHttp("http://10.0.0.2:7777/rpc")), Effect.scoped);
 * ```
 *
 * @since 1.0.0
 */
import { Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import * as Resource from "./Resource";
import {
  HostStatusResource,
  hostStatus,
  hostResourceReadiness,
  type HostStatus as HostStatusType,
  type HostResourceReadiness as HostResourceReadinessType,
} from "./internal/hostStatusResource";

/** Live host status: `{ up, status, startedAt, uptimeMillis, resourceCount, resources }`. The
 *  `status` rollup is `degraded` (and `/health` returns 503) when any resource is not ready.
 *  @since 1.0.0 */
export const status = hostStatus;

/** Live host status. @since 1.0.0 */
export type Status = HostStatusType;

/** One served resource's readiness as reported by its host — the element of `status.resources`.
 *  @since 1.0.0 */
export const resourceReadiness = hostResourceReadiness;

/** A served resource's readiness as reported by its host. @since 1.0.0 */
export type ResourceReadiness = HostResourceReadinessType;

/**
 * The reserved host status resource tag — hostless. Drive it with {@link HostStatus.clientHttp}
 * (or any `RpcClient.Protocol` layer) pointed at a host's `/rpc`. @since 1.0.0
 */
export const Tag = HostStatusResource;

/**
 * A client layer for the host status resource pointed at a host's `/rpc` `url` (ndjson over http,
 * matching `Resource.serveAllHttp`'s default). Provide it to a program that reads
 * {@link HostStatus.Tag}. @since 1.0.0
 */
export const clientHttp = (url: string): Layer.Layer<HostStatusResource> =>
  Resource.client(HostStatusResource).pipe(
    Layer.provide(
      RpcClient.layerProtocolHttp({ url }).pipe(
        Layer.provide(RpcSerialization.layerNdjson),
        Layer.provide(FetchHttpClient.layer),
      ),
    ),
  );
