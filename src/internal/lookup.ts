/**
 * In-memory Lookup registries — identity claims, node directory, placement advice.
 *
 * Structural shapes only (no import from `Lookup.ts`) so the public module can own Schema
 * classes without a cycle. Directory mutations publish onto {@link LookupRegistries.directoryChanges}
 * for membership-push (Track C A→B dial swap notify). Advice mutations publish onto
 * {@link LookupRegistries.adviceChanges} so {@link Hyperlink.lookupClient} can move dials
 * when prefer flips (Track D early move).
 *
 * @internal
 */
import { Effect, Option, PubSub, Ref } from "effect";

/** Wire-shaped endpoint stored for identity claims. @internal */
export type StoredEndpoint = {
  readonly nodeKey: string;
  readonly kind: "Http" | "WebSocket" | "IpcSocket";
  readonly url?: string;
  readonly path?: string;
};

/** Directory row — dial target + catalog keys this node serves. @internal */
export type StoredDirectoryEntry = StoredEndpoint & {
  readonly serves: ReadonlyArray<string>;
};

/** Claim outcome before mapping into public Schema errors. @internal */
export type ClaimOutcome =
  | { readonly _tag: "Won"; readonly endpoint: StoredEndpoint }
  | {
      readonly _tag: "Duplicate";
      readonly key: string;
      readonly original: StoredEndpoint;
    };

/** Advertise outcome before liveness / public errors. @internal */
export type AdvertiseOutcome =
  | { readonly _tag: "Accepted"; readonly entry: StoredDirectoryEntry }
  | {
      readonly _tag: "IncumbentAlive";
      readonly nodeKey: string;
      readonly incumbent: StoredDirectoryEntry;
    };

/**
 * Directory membership event (structural) — mapped to wire {@link DirectoryChange} in Lookup.
 * @internal
 */
export type StoredDirectoryChange =
  | {
      readonly _tag: "DirectoryUpserted";
      readonly entry: StoredDirectoryEntry;
      readonly previous?: StoredDirectoryEntry;
      readonly dialChanged: boolean;
    }
  | {
      readonly _tag: "DirectoryRemoved";
      readonly nodeKey: string;
      readonly previous: StoredDirectoryEntry;
    };

/**
 * Advice board event (structural) — mapped to wire {@link AdviceChange} in Lookup.
 * @internal
 */
export type StoredAdviceChange =
  | {
      readonly _tag: "AdvicePreferred";
      readonly serviceKey: string;
      readonly prefer: string;
      readonly previous?: string;
    }
  | {
      readonly _tag: "AdviceCleared";
      readonly serviceKey: string;
      readonly previous: string;
    };

/** Mutable claim map — HyperService key → winning endpoint. @internal */
export type ClaimRegistry = {
  readonly claim: (
    key: string,
    endpoint: StoredEndpoint,
  ) => Effect.Effect<ClaimOutcome>;
  /**
   * Drop a claim only when the stored dial still matches `endpoint` — safe after
   * a dead-incumbent probe so a concurrent newcomer is not wiped.
   */
  readonly removeIfSameDial: (
    key: string,
    endpoint: StoredEndpoint,
  ) => Effect.Effect<boolean>;
  readonly resolve: (
    key: string,
  ) => Effect.Effect<Option.Option<StoredEndpoint>>;
};

/** Mutable node directory — nodeKey → entry. @internal */
export type DirectoryRegistry = {
  readonly get: (
    nodeKey: string,
  ) => Effect.Effect<Option.Option<StoredDirectoryEntry>>;
  readonly set: (
    entry: StoredDirectoryEntry,
  ) => Effect.Effect<StoredDirectoryEntry>;
  readonly remove: (nodeKey: string) => Effect.Effect<boolean>;
  /**
   * Remove only when the stored dial target matches `endpoint` — safe after
   * askIncumbent handoff so a late incumbent finalizer cannot wipe the newcomer.
   */
  readonly removeIfSameDial: (
    endpoint: StoredEndpoint,
  ) => Effect.Effect<boolean>;
  readonly nodesServing: (
    serviceKey: string,
  ) => Effect.Effect<ReadonlyArray<StoredDirectoryEntry>>;
};

/** Placement advice — HyperService key → preferred directory `nodeKey`. @internal */
export type AdviceRegistry = {
  readonly set: (
    serviceKey: string,
    prefer: string,
  ) => Effect.Effect<string>;
  readonly clear: (serviceKey: string) => Effect.Effect<boolean>;
  readonly get: (
    serviceKey: string,
  ) => Effect.Effect<Option.Option<string>>;
};

/** Combined registries for one Lookup server process. @internal */
export type LookupRegistries = {
  readonly claims: ClaimRegistry;
  readonly directory: DirectoryRegistry;
  readonly advice: AdviceRegistry;
  /** Sliding fan-out of directory upserts / removes (membership push). */
  readonly directoryChanges: PubSub.PubSub<StoredDirectoryChange>;
  /** Sliding fan-out of advice prefer / clear (Track D early dial move). */
  readonly adviceChanges: PubSub.PubSub<StoredAdviceChange>;
};

/** Sliding buffer for directory / advice change subscribers. @internal */
const CHANGES_CAPACITY = 1024;

/** Build empty claim + directory + advice registries (one per lookup server). @internal */
export const makeRegistries = (): Effect.Effect<LookupRegistries> =>
  Effect.gen(function* () {
    const claimMap = yield* Ref.make(new Map<string, StoredEndpoint>());
    const directoryMap = yield* Ref.make(
      new Map<string, StoredDirectoryEntry>(),
    );
    const adviceMap = yield* Ref.make(new Map<string, string>());
    const directoryChanges = yield* PubSub.sliding<StoredDirectoryChange>(
      CHANGES_CAPACITY,
    );
    const adviceChanges = yield* PubSub.sliding<StoredAdviceChange>(
      CHANGES_CAPACITY,
    );

    const publish = (
      event: StoredDirectoryChange,
    ): Effect.Effect<void> => PubSub.publish(directoryChanges, event);

    const publishAdvice = (
      event: StoredAdviceChange,
    ): Effect.Effect<void> => PubSub.publish(adviceChanges, event);

    return {
      claims: {
        claim: (key, endpoint) =>
          Ref.modify(
            claimMap,
            (
              current,
            ): readonly [ClaimOutcome, Map<string, StoredEndpoint>] => {
              const existing = current.get(key);
              if (existing !== undefined) {
                return [
                  {
                    _tag: "Duplicate",
                    key,
                    original: existing,
                  },
                  current,
                ];
              }
              const next = new Map(current);
              next.set(key, endpoint);
              return [{ _tag: "Won", endpoint }, next];
            },
          ),
        removeIfSameDial: (key, endpoint) =>
          Ref.modify(claimMap, (current) => {
            const existing = current.get(key);
            if (existing === undefined || !sameDialTarget(existing, endpoint)) {
              return [false, current] as const;
            }
            const next = new Map(current);
            next.delete(key);
            return [true, next] as const;
          }),
        resolve: (key) =>
          Ref.get(claimMap).pipe(
            Effect.map((current) => Option.fromNullishOr(current.get(key))),
          ),
      },
      directory: {
        get: (nodeKey) =>
          Ref.get(directoryMap).pipe(
            Effect.map((current) => Option.fromNullishOr(current.get(nodeKey))),
          ),
        set: (entry) =>
          Effect.gen(function* () {
            const previous = yield* Ref.modify(directoryMap, (current) => {
              const prior = current.get(entry.nodeKey);
              const next = new Map(current);
              next.set(entry.nodeKey, entry);
              return [Option.fromNullishOr(prior), next] as const;
            });
            const dialChanged = Option.match(previous, {
              onNone: () => false,
              onSome: (prior) => !sameDialTarget(prior, entry),
            });
            yield* publish({
              _tag: "DirectoryUpserted",
              entry,
              ...(Option.isSome(previous)
                ? { previous: previous.value }
                : {}),
              dialChanged,
            });
            return entry;
          }),
        remove: (nodeKey) =>
          Effect.gen(function* () {
            const removed = yield* Ref.modify(directoryMap, (current) => {
              const prior = current.get(nodeKey);
              if (prior === undefined) {
                return [
                  Option.none<StoredDirectoryEntry>(),
                  current,
                ] as const;
              }
              const next = new Map(current);
              next.delete(nodeKey);
              return [Option.some(prior), next] as const;
            });
            if (Option.isSome(removed)) {
              yield* publish({
                _tag: "DirectoryRemoved",
                nodeKey,
                previous: removed.value,
              });
              return true;
            }
            return false;
          }),
        removeIfSameDial: (endpoint) =>
          Effect.gen(function* () {
            const removed = yield* Ref.modify(directoryMap, (current) => {
              const existing = current.get(endpoint.nodeKey);
              if (
                existing === undefined ||
                !sameDialTarget(existing, endpoint)
              ) {
                return [
                  Option.none<StoredDirectoryEntry>(),
                  current,
                ] as const;
              }
              const next = new Map(current);
              next.delete(endpoint.nodeKey);
              return [Option.some(existing), next] as const;
            });
            if (Option.isSome(removed)) {
              yield* publish({
                _tag: "DirectoryRemoved",
                nodeKey: endpoint.nodeKey,
                previous: removed.value,
              });
              return true;
            }
            return false;
          }),
        nodesServing: (serviceKey) =>
          Ref.get(directoryMap).pipe(
            Effect.map((current) =>
              [...current.values()].filter((entry) =>
                entry.serves.includes(serviceKey),
              ),
            ),
          ),
      },
      advice: {
        set: (serviceKey, prefer) =>
          Effect.gen(function* () {
            const previous = yield* Ref.modify(adviceMap, (current) => {
              const prior = current.get(serviceKey);
              const next = new Map(current);
              next.set(serviceKey, prefer);
              return [Option.fromNullishOr(prior), next] as const;
            });
            // Same prefer is still a write — dialers may have missed the first event.
            yield* publishAdvice({
              _tag: "AdvicePreferred",
              serviceKey,
              prefer,
              ...(Option.isSome(previous) ? { previous: previous.value } : {}),
            });
            return prefer;
          }),
        clear: (serviceKey) =>
          Effect.gen(function* () {
            const removed = yield* Ref.modify(adviceMap, (current) => {
              const prior = current.get(serviceKey);
              if (prior === undefined) {
                return [Option.none<string>(), current] as const;
              }
              const next = new Map(current);
              next.delete(serviceKey);
              return [Option.some(prior), next] as const;
            });
            if (Option.isSome(removed)) {
              yield* publishAdvice({
                _tag: "AdviceCleared",
                serviceKey,
                previous: removed.value,
              });
              return true;
            }
            return false;
          }),
        get: (serviceKey) =>
          Ref.get(adviceMap).pipe(
            Effect.map((current) =>
              Option.fromNullishOr(current.get(serviceKey)),
            ),
          ),
      },
      directoryChanges,
      adviceChanges,
    };
  });

/** @deprecated Use {@link makeRegistries}. @internal */
export const makeRegistry = (): Effect.Effect<ClaimRegistry> =>
  Effect.map(makeRegistries(), (r) => r.claims);

/** Same dial target? (refresh advertise without liveness). @internal */
export const sameDialTarget = (
  a: StoredEndpoint,
  b: StoredEndpoint,
): boolean =>
  a.kind === b.kind && a.path === b.path && a.url === b.url;
