/**
 * **Resource toolkit** — schema-defined service tags with local + remote (RPC) layers.
 *
 * @remarks
 * **Slice 1 — the spec → contract foundation.** Lightweight by construction: imports
 * only `Schema` and `effect/unstable/rpc`, never a heavy implementation. This is the
 * single source for a resource's wire contract; the inferred service interface, the
 * client forwarder, and the server handlers all derive from one {@link Spec}.
 *
 * `Resource.Tag` / `Resource.Host` and the client/server layers land in later slices.
 *
 * @module Resource
 */
import { Effect, Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

/**
 * One method of a resource contract:
 * - a **bare `Schema`** — its success type, with no payload (`current: Schema.Number`,
 *   `reset: Schema.Void`); or
 * - a **descriptor** — `{ payload?, success?, error? }`, where `error` becomes the
 *   Effect error channel.
 *
 * @public
 */
export type MethodSpec =
  | Schema.Top
  | {
      readonly payload?: Schema.Struct.Fields;
      readonly success?: Schema.Top;
      readonly error?: Schema.Top;
    };

/**
 * A resource contract: method name → {@link MethodSpec}. The single source of truth.
 *
 * @public
 */
export type Spec = Record<string, MethodSpec>;

// ── type-level inference: one Spec → the service interface ──

type SuccessOf<M extends MethodSpec> = M extends Schema.Top
  ? M["Type"]
  : M extends { readonly success: Schema.Top }
    ? M["success"]["Type"]
    : void;

type ErrorOf<M extends MethodSpec> = M extends { readonly error: Schema.Top }
  ? M["error"]["Type"]
  : never;

type PayloadOf<M extends MethodSpec> = M extends {
  readonly payload: infer F extends Schema.Struct.Fields;
}
  ? Schema.Struct<F>["Type"]
  : never;

type HasPayload<M extends MethodSpec> = M extends {
  readonly payload: Schema.Struct.Fields;
}
  ? true
  : false;

/**
 * The inferred shape of one method: a **property** `Effect<Success, Error>` when there
 * is no payload, or a **function** `(payload) => Effect<Success, Error>` when there is.
 *
 * @internal
 */
export type Method<M extends MethodSpec> = HasPayload<M> extends true
  ? (payload: PayloadOf<M>) => Effect.Effect<SuccessOf<M>, ErrorOf<M>>
  : Effect.Effect<SuccessOf<M>, ErrorOf<M>>;

/**
 * The full service interface inferred from a {@link Spec}.
 *
 * @public
 */
export type ServiceOf<S extends Spec> = {
  readonly [K in keyof S]: Method<S[K]>;
};

// ── runtime: one Spec → the shared RPC contract group ──

/**
 * Build the shared RPC contract group from a {@link Spec}. A bare `Schema` becomes a
 * payload-free rpc returning that schema; a descriptor maps straight to its parts.
 *
 * @internal
 */
export const buildRpcGroup = (spec: Spec) => {
  const rpcs = Object.entries(spec).map(([tag, m]) => {
    if (Schema.isSchema(m)) {
      return Rpc.make(tag, { success: m });
    }
    const options: {
      payload?: Schema.Struct.Fields;
      success?: Schema.Top;
      error?: Schema.Top;
    } = {};
    if (m.payload !== undefined) options.payload = m.payload;
    if (m.success !== undefined) options.success = m.success;
    if (m.error !== undefined) options.error = m.error;
    return Rpc.make(tag, options);
  });
  return RpcGroup.make(...rpcs);
};
