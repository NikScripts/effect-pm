/**
 * Dialers — live dial-session census for Lookup impact (`planUpdate.clientsAtRisk`).
 *
 * Sibling of {@link Lookup} (not nested under it). Wire id stays
 * `hyperlink-ts/Lookup/Dialers` for protocol stability.
 *
 * ```ts
 * import * as Dialers from "hyperlink-ts/Dialers"
 *
 * const id = yield* Dialers.mintId
 * yield* Dialers.register({ dialerId: id, serviceKey: Jobs.key, target: "fleet/Worker#a" })
 * const atRisk = yield* Dialers.listForTarget("fleet/Worker#a")
 * ```
 *
 * Never `import { Dialers } from "hyperlink-ts/Lookup"`.
 *
 * @module Dialers
 */
import { Effect, Encoding, Option, Schema } from "effect";
import * as Hyperlink from "./Hyperlink";

/** Kind stamped on Lookup-family HyperServices. @public */
export const kind = "hyperlink-ts/Lookup";

/**
 * One live dial session — who is dialing which HyperService on which Directory node.
 *
 * @category wire schemas
 * @public
 */
export class DialerEntry extends Schema.Class<DialerEntry>("LookupDialerEntry")({
  /** Client-minted session id (stable for the outer `lookupClient` / peer slot). */
  dialerId: Schema.String,
  /** HyperService wire key being dialed. */
  serviceKey: Schema.String,
  /** Directory `nodeKey` the dialer currently holds. */
  target: Schema.String,
}) {}

/**
 * Upsert a dial session (register or refresh target).
 *
 * @category wire schemas
 * @public
 */
export class RegisterRequest extends Schema.Class<RegisterRequest>(
  "LookupDialersRegisterRequest",
)({
  dialerId: Schema.String,
  serviceKey: Schema.String,
  target: Schema.String,
}) {}

/**
 * Drop a dial session by id.
 *
 * @category wire schemas
 * @public
 */
export class UnregisterRequest extends Schema.Class<UnregisterRequest>(
  "LookupDialersUnregisterRequest",
)({
  dialerId: Schema.String,
}) {}

/**
 * List dial sessions currently targeting a Directory `nodeKey`.
 *
 * @category wire schemas
 * @public
 */
export class ListForTargetRequest extends Schema.Class<ListForTargetRequest>(
  "LookupDialersListForTargetRequest",
)({
  nodeKey: Schema.String,
}) {}

const dialersSpec = {
  register: Hyperlink.effectFn({
    payload: RegisterRequest,
    success: DialerEntry,
  }).annotate({
    description:
      "Upsert a live dial session (dialerId + serviceKey → Directory target). " +
      "lookupClient / peersLayer register on install and refresh target on rebind.",
  }),
  unregister: Hyperlink.effectFn({
    payload: UnregisterRequest,
    success: Schema.Boolean,
  }).annotate({
    description: "Drop a dial session (true if a row was removed).",
  }),
  listForTarget: Hyperlink.effectFn({
    payload: ListForTargetRequest,
    success: Schema.Array(DialerEntry),
  }).annotate({
    description:
      "Dial sessions currently holding this Directory nodeKey — " +
      "Lookup.planUpdate clientsAtRisk.",
  }),
};

/**
 * Dial-session census Tag — Context key for the Dialers HyperService.
 *
 * @category services
 * @public
 */
export class Tag extends Hyperlink.Tag<Tag>()(
  "hyperlink-ts/Lookup/Dialers",
  dialersSpec,
  { kind },
) {}

/**
 * Mint a dialer session id (CSPRNG hex). Caller owns the id across register /
 * unregister so rebinds can refresh `target` without churning identity.
 *
 * @category constructors
 * @public
 */
export const mintId: Effect.Effect<string> = Effect.sync(() => {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Encoding.encodeHex(bytes);
});

/**
 * Upsert a dial session (requires {@link Tag} in context).
 *
 * @category constructors
 * @public
 */
export const register = (input: {
  readonly dialerId: string;
  readonly serviceKey: string;
  readonly target: string;
}): Effect.Effect<DialerEntry, never, Tag> =>
  Effect.flatMap(Tag, (svc) =>
    svc.register(
      new RegisterRequest({
        dialerId: input.dialerId,
        serviceKey: input.serviceKey,
        target: input.target,
      }),
    ),
  );

/**
 * Soft register — no-op when {@link Tag} is absent (graphs without Lookup Dialers).
 *
 * @category constructors
 * @public
 */
export const registerOption = (input: {
  readonly dialerId: string;
  readonly serviceKey: string;
  readonly target: string;
}): Effect.Effect<void> =>
  Effect.serviceOption(Tag).pipe(
    Effect.flatMap((opt) =>
      Option.match(opt, {
        onNone: () => Effect.void,
        onSome: (svc) =>
          svc
            .register(
              new RegisterRequest({
                dialerId: input.dialerId,
                serviceKey: input.serviceKey,
                target: input.target,
              }),
            )
            .pipe(Effect.asVoid),
      }),
    ),
  );

/**
 * Drop a dial session by id.
 *
 * @category constructors
 * @public
 */
export const unregister = (
  dialerId: string,
): Effect.Effect<boolean, never, Tag> =>
  Effect.flatMap(Tag, (svc) =>
    svc.unregister(new UnregisterRequest({ dialerId })),
  );

/**
 * Soft unregister — no-op when {@link Tag} is absent.
 *
 * @category constructors
 * @public
 */
export const unregisterOption = (dialerId: string): Effect.Effect<void> =>
  Effect.serviceOption(Tag).pipe(
    Effect.flatMap((opt) =>
      Option.match(opt, {
        onNone: () => Effect.void,
        onSome: (svc) =>
          svc.unregister(new UnregisterRequest({ dialerId })).pipe(Effect.asVoid),
      }),
    ),
  );

/**
 * List dial sessions targeting a Directory `nodeKey`.
 *
 * @category constructors
 * @public
 */
export const listForTarget = (
  nodeKey: string,
): Effect.Effect<ReadonlyArray<DialerEntry>, never, Tag> =>
  Effect.flatMap(Tag, (svc) =>
    svc.listForTarget(new ListForTargetRequest({ nodeKey })),
  );
