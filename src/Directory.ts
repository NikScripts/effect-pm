/**
 * Directory — node presence catalog for HyperServices (advertise / membership push).
 *
 * Sibling of {@link Lookup} (not nested under it). Wire id stays
 * `hyperlink-ts/Lookup/Directory` for protocol stability.
 *
 * ```ts
 * import * as Directory from "hyperlink-ts/Directory"
 *
 * const rows = yield* Directory.nodesServing(Jobs)
 * yield* Directory.changes.pipe(Stream.runDrain)
 * const dir = yield* Directory.Service
 * ```
 *
 * Never `import { Directory } from "hyperlink-ts/Lookup"`.
 *
 * @module Directory
 */
import { Effect, Option, Ref, Schema, Stream, type Scope } from "effect";
import * as Hyperlink from "./Hyperlink";

/** Kind stamped on Lookup-family HyperServices. @public */
export const kind = "hyperlink-ts/Lookup";

/**
 * Directory row — dial target plus HyperService keys this node serves (`listen` catalog).
 *
 * @category wire schemas
 * @public
 */
export class DirectoryEntry extends Schema.Class<DirectoryEntry>("LookupDirectoryEntry")({
  nodeKey: Schema.String,
  kind: Schema.Literals(["Http", "WebSocket", "IpcSocket"]),
  url: Schema.optionalKey(Schema.String),
  path: Schema.optionalKey(Schema.String),
  serves: Schema.Array(Schema.String),
}) {}

/**
 * Directory row upserted (first advertise, serves refresh, or A→B dial replace).
 * `dialChanged` is true when the dial target moved (membership push for peer rebind).
 *
 * @category wire schemas
 * @public
 */
export class DirectoryUpserted extends Schema.TaggedClass<DirectoryUpserted>()(
  "DirectoryUpserted",
  {
    entry: DirectoryEntry,
    previous: Schema.optionalKey(DirectoryEntry),
    dialChanged: Schema.Boolean,
  },
) {}

/**
 * Directory row removed (unregister / dial-matched remove).
 *
 * @category wire schemas
 * @public
 */
export class DirectoryRemoved extends Schema.TaggedClass<DirectoryRemoved>()(
  "DirectoryRemoved",
  {
    nodeKey: Schema.String,
    previous: DirectoryEntry,
  },
) {}

/**
 * Membership-push event from {@link changes}.
 *
 * @category wire schemas
 * @public
 */
export const DirectoryChange = Schema.Union([
  DirectoryUpserted,
  DirectoryRemoved,
]);

/**
 * Membership-push event type.
 *
 * @category models
 * @public
 */
export type DirectoryChange = typeof DirectoryChange.Type;

/**
 * Advertise / refresh a directory row.
 *
 * @category wire schemas
 * @public
 */
export class AdvertiseRequest extends Schema.Class<AdvertiseRequest>(
  "LookupAdvertiseRequest",
)({
  nodeKey: Schema.String,
  kind: Schema.Literals(["Http", "WebSocket", "IpcSocket"]),
  url: Schema.optionalKey(Schema.String),
  path: Schema.optionalKey(Schema.String),
  serves: Schema.Array(Schema.String),
  /**
   * Advertiser preference after call-site∋node resolve — may still be `"inherit"`.
   * Lookup finishes resolve with its node stamp. Omit → inherit.
   */
  onConflict: Schema.optionalKey(
    Schema.Literals([
      "livenessReplace",
      "askIncumbent",
      "reject",
      "inherit",
    ]),
  ),
}) {}

/**
 * Unregister payload — remove a directory row by `nodeKey`.
 * When dial fields are present, remove only if the stored dial still matches
 * (askIncumbent-safe finalizers).
 *
 * @category wire schemas
 * @public
 */
export class UnregisterRequest extends Schema.Class<UnregisterRequest>(
  "LookupUnregisterRequest",
)({
  nodeKey: Schema.String,
  kind: Schema.optionalKey(Schema.Literals(["Http", "WebSocket", "IpcSocket"])),
  url: Schema.optionalKey(Schema.String),
  path: Schema.optionalKey(Schema.String),
}) {}

/**
 * List nodes that advertised a given HyperService key in `serves`.
 *
 * @category wire schemas
 * @public
 */
export class NodesServingRequest extends Schema.Class<NodesServingRequest>(
  "LookupNodesServingRequest",
)({
  serviceKey: Schema.String,
}) {}

/**
 * Advertise rejected — an incumbent with the same `nodeKey` still answers a node-handle ping.
 *
 * @category errors
 * @public
 */
export class IncumbentAlive extends Schema.TaggedErrorClass<IncumbentAlive>()(
  "IncumbentAlive",
  {
    nodeKey: Schema.String,
    incumbent: DirectoryEntry,
  },
) {}

const directorySpec = {
  advertise: Hyperlink.effectFn({
    payload: AdvertiseRequest,
    success: DirectoryEntry,
    error: IncumbentAlive,
  }).annotate({
    description:
      "Register or refresh a node directory row. Same dial target refreshes serves; " +
      "a different dial target runs onConflict (default livenessReplace via node-handle ping; " +
      "askIncumbent asks the incumbent handle's yield on a live peer).",
  }),
  unregister: Hyperlink.effectFn({
    payload: UnregisterRequest,
    success: Schema.Boolean,
  }).annotate({
    description:
      "Remove a directory row by nodeKey (clean listen scope close). " +
      "With dial fields, removes only if the stored dial still matches.",
  }),
  nodesServing: Hyperlink.effectFn({
    payload: NodesServingRequest,
    success: Schema.Array(DirectoryEntry),
  }).annotate({
    description: "List advertised nodes whose serves[] includes that HyperService key.",
  }),
  changes: Hyperlink.stream(DirectoryChange).annotate({
    description:
      "Live directory membership push — upserts (incl. dialChanged on A→B swap) and removes. " +
      "Nodes subscribe to rebind peer dials without restarting.",
  }),
};

/**
 * Directory Tag — Context key for the Directory HyperService.
 *
 * @category services
 * @public
 */
export class Service extends Hyperlink.Service<Service>()(
  "hyperlink-ts/Lookup/Directory",
  directorySpec,
  { kind },
) {}

/** Tag or wire key → `serviceKey` string. @internal */
const serviceKeyOf = (service: string | { readonly key: string }): string =>
  typeof service === "string" ? service : service.key;

/**
 * List directory rows that advertise a HyperService (Tag or wire key).
 *
 * @category constructors
 * @public
 */
export const nodesServing = (
  service: string | { readonly key: string },
): Effect.Effect<ReadonlyArray<DirectoryEntry>, never, Service> =>
  Effect.flatMap(Service, (svc) =>
    svc.nodesServing(
      new NodesServingRequest({ serviceKey: serviceKeyOf(service) }),
    ),
  );

/**
 * Live directory membership push — flat sugar over Tag `changes`.
 *
 * @category constructors
 * @public
 */
export const changes: Stream.Stream<DirectoryChange, never, Service> =
  Stream.unwrap(Effect.map(Service, (dir) => dir.changes));

/**
 * Live dial table driven by {@link changes} — for node-level peer rebind.
 *
 * @category constructors
 * @public
 */
export const directoryTable = (): Effect.Effect<
  {
    readonly get: Effect.Effect<ReadonlyMap<string, DirectoryEntry>>;
    readonly getNode: (
      nodeKey: string,
    ) => Effect.Effect<Option.Option<DirectoryEntry>>;
  },
  never,
  Service | Scope.Scope
> =>
  Effect.gen(function* () {
    const table = yield* Ref.make(new Map<string, DirectoryEntry>());
    yield* changes.pipe(
      Stream.runForEach((event) => {
        if (event._tag === "DirectoryRemoved") {
          return Ref.update(table, (current) => {
            const next = new Map(current);
            next.delete(event.nodeKey);
            return next;
          });
        }
        return Ref.update(table, (current) => {
          const next = new Map(current);
          next.set(event.entry.nodeKey, event.entry);
          return next;
        });
      }),
      Effect.forkScoped,
    );
    return {
      get: Ref.get(table),
      getNode: (nodeKey: string) =>
        Ref.get(table).pipe(
          Effect.map((current) => Option.fromNullishOr(current.get(nodeKey))),
        ),
    };
  });
