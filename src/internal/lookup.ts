/**
 * In-memory identity registry for {@link Lookup} — claim-by-key, first wins.
 *
 * Structural endpoint shape only (no import from `Lookup.ts`) so the public module can own
 * Schema classes without a cycle.
 *
 * @internal
 */
import { Effect, Option, Ref } from "effect";

/** Wire-shaped endpoint stored in the registry. @internal */
export type StoredEndpoint = {
  readonly nodeKey: string;
  readonly kind: "http" | "socket" | "ipc";
  readonly url?: string;
  readonly path?: string;
};

/** Claim outcome before mapping into public Schema errors. @internal */
export type ClaimOutcome =
  | { readonly _tag: "Won"; readonly endpoint: StoredEndpoint }
  | {
      readonly _tag: "Duplicate";
      readonly key: string;
      readonly original: StoredEndpoint;
    };

/** Mutable claim map — resource key → winning endpoint. @internal */
export type Registry = {
  readonly claim: (
    key: string,
    endpoint: StoredEndpoint,
  ) => Effect.Effect<ClaimOutcome>;
  readonly resolve: (
    key: string,
  ) => Effect.Effect<Option.Option<StoredEndpoint>>;
};

/** Build an empty registry (one per lookup server process). @internal */
export const makeRegistry = (): Effect.Effect<Registry> =>
  Ref.make(new Map<string, StoredEndpoint>()).pipe(
    Effect.map((map) => ({
      claim: (key, endpoint) =>
        Ref.modify(
          map,
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
        Ref.get(map).pipe(
          Effect.map((current) => Option.fromNullishOr(current.get(key))),
        ),
    })),
  );
