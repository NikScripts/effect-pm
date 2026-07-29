/**
 * Gate observe pack — live status ref.
 * @internal
 */
import type { Effect as EffectT, Stream as StreamT } from "effect";
import type { Status as GateStatus } from "../Gate";
import * as Observe from "../Observe";

type Gate = {
  readonly status: {
    readonly get: EffectT.Effect<GateStatus>;
    readonly changes: StreamT.Stream<GateStatus>;
  };
};

/**
 * Full Gate UI pack.
 *
 * @public
 */
export const pack = Observe.named(
  "gate",
  Observe.struct({
    status: Observe.atom((g: Gate) => g.status),
  }),
);
