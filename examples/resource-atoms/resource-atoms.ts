/**
 * @module examples/resource-atoms/resource-atoms
 *
 * `makeResourceAtoms(runtime, tag)` — derive a reactive atom set from a `Resource`
 * tag. It's a projection of the `Spec` (alongside `ServiceOf` / RPC group / client
 * / server): one atom per method, classified from the contract metadata —
 *
 * - **query, no payload** → a live read `Atom` (keyed for refresh);
 * - **anything else** (a payload, or a `mutate`) → a `runtime.fn`.
 *
 * Everything comes from the tag: atom **types** from its spec, the read/command
 * split from `methodMeta(...).kind`, the reactivity key from `tag.id`.
 */

import { Effect, Schema } from "effect";
import { Atom, type AsyncResult } from "effect/unstable/reactivity";
import { methodMeta, specOf } from "../../src/Resource";
import type { AnyMethod, ResourceTag, Spec } from "../../src/Resource";

/** One spec method → its atom kind, by the contract. */
type AtomOf<M extends AnyMethod> = M["payload"] extends Schema.Struct.Fields
  ? Atom.AtomResultFn<
      Schema.Struct<M["payload"]>["Type"],
      M["success"]["Type"],
      M["error"]["Type"]
    >
  : M["kind"] extends "query"
    ? Atom.Atom<AsyncResult.AsyncResult<M["success"]["Type"], M["error"]["Type"]>>
    : Atom.AtomResultFn<void, M["success"]["Type"], M["error"]["Type"]>;

/** The atom set inferred from a tag's spec — local methods (streams) have no atom. */
export type ResourceAtoms<S extends Spec> = {
  readonly [K in keyof S as S[K] extends AnyMethod ? K : never]: S[K] extends AnyMethod
    ? AtomOf<S[K]>
    : never;
};

export const makeResourceAtoms = <Self extends R, S extends Spec, R, ER>(
  runtime: Atom.AtomRuntime<R, ER>,
  tag: ResourceTag<Self, S>,
): ResourceAtoms<S> => {
  const reactivityKey = [tag.id];
  const keys = { reactivityKeys: reactivityKey };
  const call = (service: unknown, key: string): unknown =>
    (service as Record<string, unknown>)[key];

  const atoms: Record<string, unknown> = {};
  for (const [key, method] of Object.entries(specOf(tag))) {
    // local methods (streams) carry no payload and produce no atom — skip them.
    if (!("payload" in method)) {
      continue;
    }
    const hasPayload = method.payload !== undefined;
    const isReadAtom = !hasPayload && methodMeta(method).kind === "query";
    if (isReadAtom) {
      atoms[key] = Atom.withReactivity(reactivityKey)(
        runtime.atom(
          Effect.gen(function* () {
            const service = yield* tag;
            return yield* (call(service, key) as Effect.Effect<unknown>);
          }),
        ),
      );
    } else {
      atoms[key] = runtime.fn(
        (arg: unknown) =>
          Effect.gen(function* () {
            const service = yield* tag;
            const target = call(service, key);
            return yield* (hasPayload
              ? (target as (p: unknown) => Effect.Effect<unknown>)(arg)
              : (target as Effect.Effect<unknown>));
          }),
        keys,
      );
    }
  }
  // Boundary: dynamic build → mapped type; each method wired per its contract kind.
  return atoms as ResourceAtoms<S>;
};
