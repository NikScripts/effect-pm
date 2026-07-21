/**
 * In-memory Lookup registries — identity claims (first wins) + node directory (advertise).
 *
 * Structural shapes only (no import from `Lookup.ts`) so the public module can own Schema
 * classes without a cycle.
 *
 * @internal
 */
import { Effect, Option, Ref } from "effect";

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

/** Mutable claim map — resource key → winning endpoint. @internal */
export type ClaimRegistry = {
  readonly claim: (
    key: string,
    endpoint: StoredEndpoint,
  ) => Effect.Effect<ClaimOutcome>;
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
    resourceKey: string,
  ) => Effect.Effect<ReadonlyArray<StoredDirectoryEntry>>;
};

/** Combined registries for one Lookup server process. @internal */
export type LookupRegistries = {
  readonly claims: ClaimRegistry;
  readonly directory: DirectoryRegistry;
};

/** Build empty claim + directory registries (one per lookup server process). @internal */
export const makeRegistries = (): Effect.Effect<LookupRegistries> =>
  Effect.all([
    Ref.make(new Map<string, StoredEndpoint>()),
    Ref.make(new Map<string, StoredDirectoryEntry>()),
  ]).pipe(
    Effect.map(([claimMap, directoryMap]) => ({
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
          Ref.update(directoryMap, (current) => {
            const next = new Map(current);
            next.set(entry.nodeKey, entry);
            return next;
          }).pipe(Effect.as(entry)),
        remove: (nodeKey) =>
          Ref.modify(directoryMap, (current) => {
            if (!current.has(nodeKey)) {
              return [false, current] as const;
            }
            const next = new Map(current);
            next.delete(nodeKey);
            return [true, next] as const;
          }),
        removeIfSameDial: (endpoint) =>
          Ref.modify(directoryMap, (current) => {
            const existing = current.get(endpoint.nodeKey);
            if (existing === undefined || !sameDialTarget(existing, endpoint)) {
              return [false, current] as const;
            }
            const next = new Map(current);
            next.delete(endpoint.nodeKey);
            return [true, next] as const;
          }),
        nodesServing: (resourceKey) =>
          Ref.get(directoryMap).pipe(
            Effect.map((current) =>
              [...current.values()].filter((entry) =>
                entry.serves.includes(resourceKey),
              ),
            ),
          ),
      },
    })),
  );

/** @deprecated Use {@link makeRegistries}. @internal */
export const makeRegistry = (): Effect.Effect<ClaimRegistry> =>
  Effect.map(makeRegistries(), (r) => r.claims);

/** Same dial target? (refresh advertise without liveness). @internal */
export const sameDialTarget = (
  a: StoredEndpoint,
  b: StoredEndpoint,
): boolean =>
  a.kind === b.kind && a.path === b.path && a.url === b.url;
