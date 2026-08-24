/**
 * `Lookup.follow` — hot dialer for one Lookup address across owner replace (A→B same sock).
 *
 * @module internal/lookupFollow
 * @internal
 */
import {
  Context,
  Duration,
  Effect,
  Exit,
  Layer,
  Ref,
  Schedule,
  Scope,
  Semaphore,
  Stream,
  SubscriptionRef,
} from "effect";
import { Service as Advice } from "../Advice";
import { Service as Dialers } from "../Dialers";
import { Service as Directory } from "../Directory";
import { Service as Identity } from "../Identity";
import * as Hyperlink from "../Hyperlink";
import type { AnyNode } from "./nodeCore";
import {
  followDialStream,
  isDialTransportError,
} from "./dialFollow";
import * as LookupPolicy from "../LookupPolicy";

/** Identity + Directory + Advice + Dialers — same surface as {@link Lookup.client}. @internal */
export type LookupFollowServices = Identity | Directory | Advice | Dialers;

/**
 * Scoped Layer that holds a replaceable dial to `seed` and reinstalls on transport
 * death — same path before and after an orchestrated Lookup A→B ownership move.
 *
 * @internal
 */
export const followLayer = (
  seed: AnyNode & { readonly path: string },
): Layer.Layer<LookupFollowServices> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const streamGap = yield* LookupPolicy.StreamGap;

      let clientScope: Scope.Closeable | undefined;
      const identityHolder: { current: Identity["Service"] } = {
        current: null as unknown as Identity["Service"],
      };
      const directoryHolder: { current: Directory["Service"] } = {
        current: null as unknown as Directory["Service"],
      };
      const adviceHolder: { current: Advice["Service"] } = {
        current: null as unknown as Advice["Service"],
      };
      const dialersHolder: { current: Dialers["Service"] } = {
        current: null as unknown as Dialers["Service"],
      };
      const generation = yield* Ref.make(0);
      const installGen = yield* SubscriptionRef.make(0);
      const installGate = yield* Semaphore.make(1);

      // Opt out of default-on verify: follow often builds beside / across Lookup listen,
      // and nested deep verify deadlocks on the peer dial (same as clientLayerForEndpoint).
      const clientsLayer: Layer.Layer<
        Identity | Directory | Advice | Dialers
      > = Layer.mergeAll(
        Hyperlink.client(Identity, seed) as any,
        Hyperlink.client(Directory, seed) as any,
        Hyperlink.client(Advice, seed) as any,
        Hyperlink.client(Dialers, seed) as any,
      ).pipe(LookupPolicy.provide(LookupPolicy.verifyOff)) as any;

      /** Build-then-swap — prior dial stays until the next install succeeds. */
      const install = () =>
        installGate.withPermits(1)(
          Effect.gen(function* () {
            const scope = yield* Scope.make();
            const built = yield* Layer.build(clientsLayer).pipe(
              Scope.provide(scope),
              Effect.exit,
            );
            if (Exit.isFailure(built)) {
              yield* Scope.close(scope, Exit.void);
              return yield* Effect.failCause(built.cause);
            }
            const prev = clientScope;
            clientScope = scope;
            identityHolder.current = Context.get(built.value, Identity);
            directoryHolder.current = Context.get(built.value, Directory);
            adviceHolder.current = Context.get(built.value, Advice);
            dialersHolder.current = Context.get(built.value, Dialers);
            const gen = yield* Ref.updateAndGet(generation, (n) => n + 1);
            yield* SubscriptionRef.set(installGen, gen);
            if (prev !== undefined) {
              yield* Scope.close(prev, Exit.void);
            }
          }),
        );

      // First install — fail Layer build if Lookup is not reachable yet.
      yield* install();

      const reinstallThroughGap = Effect.gen(function* () {
        const before = yield* Ref.get(generation);
        yield* install().pipe(
          Effect.retry({
            schedule: Schedule.spaced(Duration.millis(50)),
          }),
          Effect.timeoutOption(Duration.seconds(10)),
          Effect.asVoid,
        );
        return (yield* Ref.get(generation)) > before;
      });

      const withDialRetry = <A, E, R>(
        run: () => Effect.Effect<A, E, R>,
      ): Effect.Effect<A, E, R> =>
        Effect.suspend(run).pipe(
          Effect.catch((err: E) => {
            if (!isDialTransportError(err)) {
              return Effect.fail(err);
            }
            return Effect.gen(function* () {
              const before = yield* Ref.get(generation);
              const bumped = yield* reinstallThroughGap;
              if (!bumped && (yield* Ref.get(generation)) <= before) {
                return yield* Effect.fail(err);
              }
              return yield* Effect.suspend(run);
            });
          }),
        );

      yield* Effect.addFinalizer(() =>
        clientScope === undefined
          ? Effect.void
          : Scope.close(clientScope, Exit.void),
      );

      const followStream = (getInner: () => Stream.Stream<unknown>) =>
        followDialStream(installGen, streamGap, getInner);

      const identity = Hyperlink.makeLiveDialService(
        Identity,
        identityHolder,
        withDialRetry,
        followStream,
      );
      const directory = Hyperlink.makeLiveDialService(
        Directory,
        directoryHolder,
        withDialRetry,
        followStream,
      );
      const advice = Hyperlink.makeLiveDialService(
        Advice,
        adviceHolder,
        withDialRetry,
        followStream,
      );
      const dialers = Hyperlink.makeLiveDialService(
        Dialers,
        dialersHolder,
        withDialRetry,
        followStream,
      );

      return Layer.mergeAll(
        Layer.succeed(Identity, identity),
        Layer.succeed(Directory, directory),
        Layer.succeed(Advice, advice),
        Layer.succeed(Dialers, dialers),
      );
    }),
  );
