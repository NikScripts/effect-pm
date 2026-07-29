/**
 * Advice — last-write placement board for nodeless / {@link Hyperlink.lookupClient} dial.
 *
 * Sibling of {@link Lookup} (not nested under it). Wire id stays
 * `hyperlink-ts/Lookup/Advice` for protocol stability.
 *
 * ```ts
 * import * as Advice from "hyperlink-ts/Advice"
 *
 * yield* Advice.prefer(Worker, "fleet/Worker#w2")
 * yield* Advice.changes.pipe(Stream.runDrain)
 * const board = yield* Advice.Tag
 * ```
 *
 * Or name the Tag: `import { Tag as Advice } from "hyperlink-ts/Advice"`.
 * Never `import { Advice } from "hyperlink-ts/Lookup"`.
 *
 * @module Advice
 */
import { Effect, Option, Schema, Stream } from "effect";
import * as Hyperlink from "./Hyperlink";

/** Kind stamped on Lookup-family HyperServices. @public */
export const kind = "hyperlink-ts/Lookup";

/**
 * Placement advice — prefer this directory `nodeKey` when dialing `serviceKey`.
 *
 * @category wire schemas
 * @public
 */
export class AdviseRequest extends Schema.Class<AdviseRequest>(
  "LookupAdviseRequest",
)({
  serviceKey: Schema.String,
  /** Directory row `nodeKey` to prefer (e.g. `fleet/Worker#w2`). */
  prefer: Schema.String,
}) {}

/**
 * Clear placement advice for a HyperService key.
 *
 * @category wire schemas
 * @public
 */
export class ClearAdviceRequest extends Schema.Class<ClearAdviceRequest>(
  "LookupClearAdviceRequest",
)({
  serviceKey: Schema.String,
}) {}

/**
 * Read the preferred directory `nodeKey` for a HyperService (if any).
 *
 * @category wire schemas
 * @public
 */
export class PreferredRequest extends Schema.Class<PreferredRequest>(
  "LookupPreferredRequest",
)({
  serviceKey: Schema.String,
}) {}

/**
 * Placement advice set or replaced for a HyperService key.
 *
 * @category wire schemas
 * @public
 */
export class AdvicePreferred extends Schema.TaggedClass<AdvicePreferred>()(
  "AdvicePreferred",
  {
    serviceKey: Schema.String,
    prefer: Schema.String,
    previous: Schema.optionalKey(Schema.String),
  },
) {}

/**
 * Placement advice cleared for a HyperService key.
 *
 * @category wire schemas
 * @public
 */
export class AdviceCleared extends Schema.TaggedClass<AdviceCleared>()(
  "AdviceCleared",
  {
    serviceKey: Schema.String,
    previous: Schema.String,
  },
) {}

/**
 * Placement-board event from {@link changes}.
 *
 * @category wire schemas
 * @public
 */
export const AdviceChange = Schema.Union([AdvicePreferred, AdviceCleared]);

/**
 * Placement-board event type.
 *
 * @category models
 * @public
 */
export type AdviceChange = Schema.Schema.Type<typeof AdviceChange>;

const adviceSpec = {
  advise: Hyperlink.effectFn({
    payload: AdviseRequest,
    success: Schema.String,
  }).annotate({
    description:
      "Last-write placement advice: prefer this directory nodeKey when dialing serviceKey. " +
      "Stale prefer (not in nodesServing) is ignored by lookupClient.",
  }),
  clear: Hyperlink.effectFn({
    payload: ClearAdviceRequest,
    success: Schema.Boolean,
  }).annotate({
    description: "Drop placement advice for serviceKey (true if a row was removed).",
  }),
  preferred: Hyperlink.effectFn({
    payload: PreferredRequest,
    success: Schema.Option(Schema.String),
  }).annotate({
    description: "Read the preferred directory nodeKey for serviceKey, if any.",
  }),
  changes: Hyperlink.stream(AdviceChange).annotate({
    description:
      "Live placement-board push — advise / clear events so lookupClient can move " +
      "dials when prefer flips (before the first transport error).",
  }),
};

/**
 * Placement-board Tag — Context key for the Advice HyperService.
 *
 * @category services
 * @public
 */
export class Tag extends Hyperlink.Tag<Tag>()(
  "hyperlink-ts/Lookup/Advice",
  adviceSpec,
  { kind },
) {}

/** Tag or wire key → `serviceKey` string. @internal */
const serviceKeyOf = (service: string | { readonly key: string }): string =>
  typeof service === "string" ? service : service.key;

/**
 * Publish placement advice (requires {@link Tag} in context).
 *
 * @category constructors
 * @public
 */
export const advise = (input: {
  readonly serviceKey: string;
  readonly prefer: string;
}): Effect.Effect<string, never, Tag> =>
  Effect.flatMap(Tag, (svc) =>
    svc.advise(
      new AdviseRequest({
        serviceKey: input.serviceKey,
        prefer: input.prefer,
      }),
    ),
  );

/**
 * Prefer `nodeKey` when dialing a HyperService (Tag or wire key).
 *
 * @category constructors
 * @public
 */
export const prefer = (
  service: string | { readonly key: string },
  nodeKey: string,
): Effect.Effect<string, never, Tag> =>
  advise({
    serviceKey: serviceKeyOf(service),
    prefer: nodeKey,
  });

/**
 * Prefer a directory row's `nodeKey` for a HyperService.
 *
 * @category constructors
 * @public
 */
export const preferEntry = (
  service: string | { readonly key: string },
  entry: { readonly nodeKey: string },
): Effect.Effect<string, never, Tag> =>
  advise({ serviceKey: serviceKeyOf(service), prefer: entry.nodeKey });

/**
 * Clear placement advice for a HyperService (Tag or wire key).
 *
 * @category constructors
 * @public
 */
export const clear = (
  service: string | { readonly key: string },
): Effect.Effect<boolean, never, Tag> =>
  Effect.flatMap(Tag, (svc) =>
    svc.clear(new ClearAdviceRequest({ serviceKey: serviceKeyOf(service) })),
  );

/**
 * Clear placement advice — alias of {@link clear} (Lookup recipe name).
 *
 * @category constructors
 * @public
 */
export const clearAdvice = clear;

/**
 * Read preferred directory `nodeKey` for a HyperService (Tag or wire key).
 *
 * @category constructors
 * @public
 */
export const preferred = (
  service: string | { readonly key: string },
): Effect.Effect<Option.Option<string>, never, Tag> =>
  Effect.flatMap(Tag, (svc) =>
    svc.preferred(
      new PreferredRequest({ serviceKey: serviceKeyOf(service) }),
    ),
  );

/**
 * Live placement-board push — flat sugar over Tag `changes`.
 *
 * @category constructors
 * @public
 */
export const changes: Stream.Stream<AdviceChange, never, Tag> =
  Stream.unwrap(Effect.map(Tag, (board) => board.changes));
