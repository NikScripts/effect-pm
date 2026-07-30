/**
 * Policy public types — fragments are Layers; LookupClientPick aliases Policy.Pick.
 */
import type { Effect, Layer } from "effect";
import type { StreamGap, ColdAmbiguous, Verify, OnConflict, Pick } from "../src/Policy";
import type { LookupClientPick } from "../src/Hyperlink";

type _Sticky = Layer.Layer<never>;
type _StreamGapFn = (mode: StreamGap) => Layer.Layer<never>;
type _ColdFn = (mode: ColdAmbiguous) => Layer.Layer<never>;
type _VerifyFn = (mode: Verify) => Layer.Layer<never>;
type _ConflictFn = (mode: OnConflict) => Layer.Layer<never>;
type _OnYield = (handler: Effect.Effect<boolean>) => Layer.Layer<never>;

const _gap: StreamGap = "stall";
const _cold: ColdAmbiguous = "waitAdvice";
const _verify: Verify = "status";
const _conflict: OnConflict = "askIncumbent";
const _pick: Pick = "first";

// Call-site sugar stays assignable to Policy.Pick
const _lookupPick: LookupClientPick = _pick;
const _lookupPickFn: LookupClientPick = (rows) => rows[0]!;

// @ts-expect-error — stream gap is a closed union
const _badGap: StreamGap = "restart";

// @ts-expect-error — verify mode is a closed union
const _badVerify: Verify = true;

void _gap;
void _cold;
void _verify;
void _conflict;
void _lookupPick;
void _lookupPickFn;
void _badGap;
void _badVerify;

export type {
  _Sticky,
  _StreamGapFn,
  _ColdFn,
  _VerifyFn,
  _ConflictFn,
  _OnYield,
};
