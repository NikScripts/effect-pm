/**
 * Shared dial-generation helpers for hot clients (`lookupClient`, `Lookup.follow`,
 * directory `peersLayer`) — transport-error detect + one outer Stream across installs.
 *
 * @module internal/dialFollow
 * @internal
 */
import { Predicate, Stream, SubscriptionRef } from "effect";
import type * as LookupPolicy from "../LookupPolicy";

/**
 * True when an RPC failed on the transport (peer gone / socket closed mid-call).
 * App-declared errors stay out.
 *
 * @internal
 */
export const isDialTransportError = (err: unknown): boolean =>
  Predicate.hasProperty(err, "_tag") && err._tag === "RpcClientError";

/**
 * One outer Stream across dial generations — transport death does not end the
 * consumer fold; {@link LookupPolicy.StreamGap} chooses stall / drop / buffer.
 *
 * @internal
 */
export const followDialStream = (
  installGen: SubscriptionRef.SubscriptionRef<number>,
  streamGap: LookupPolicy.StreamGap,
  getInner: () => Stream.Stream<unknown>,
): Stream.Stream<unknown> => {
  const switched = SubscriptionRef.changes(installGen).pipe(
    Stream.switchMap(() =>
      Stream.suspend(() => getInner()).pipe(
        Stream.catch((err) => {
          if (!isDialTransportError(err)) {
            return Stream.fail(err);
          }
          // Gap until the next successful install (switchMap cancels this branch).
          return streamGap === "drop" ? Stream.empty : Stream.never;
        }),
      ),
    ),
  );
  return streamGap === "buffer"
    ? switched.pipe(Stream.buffer({ capacity: 64 }))
    : switched;
};
