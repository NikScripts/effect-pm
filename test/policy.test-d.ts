/**
 * Policy public types — fragments are Policy.Policy<{…}>; layer expands configs.
 */
import { Effect, type Layer } from "effect";
import type {
  StreamGap,
  ColdAmbiguous,
  Verify,
  OnConflict,
  Pick,
  Config,
  Policy,
  MergePolicyList,
} from "../src/Policy";
import * as PolicyMod from "../src/Policy";
import type { LookupClientPick } from "../src/Hyperlink";

type AssertExtends<A, B> = [A] extends [B] ? true : false;
type AssertEqual<A, B> =
  [A] extends [B] ? ([B] extends [A] ? true : false) : false;

const _stickyFragOk: AssertExtends<
  typeof PolicyMod.sticky,
  Policy<{ Sticky: true }>
> = true;
type _StreamGapFn = <M extends StreamGap>(mode: M) => Policy<{ StreamGap: M }>;
type _ColdFn = <M extends ColdAmbiguous>(
  mode: M,
) => Policy<{ ColdAmbiguous: M }>;
type _VerifyFn = <M extends Verify>(mode: M) => Policy<{ Verify: M }>;
type _ConflictFn = <M extends OnConflict>(mode: M) => Policy<{ Conflict: M }>;
type _OnYield = <E extends Effect.Effect<boolean>>(
  handler: E,
) => Policy<{ Yield: E }>;

const _gapFn: _StreamGapFn = PolicyMod.streamGap;
const _coldFn: _ColdFn = PolicyMod.coldAmbiguous;
const _verifyFn: _VerifyFn = PolicyMod.verify;
const _conflictFn: _ConflictFn = PolicyMod.onConflict;
const _onYield: _OnYield = PolicyMod.onYield;

const _gap: StreamGap = "stall";
const _cold: ColdAmbiguous = "waitAdvice";
const _verify: Verify = "status";
const _conflict: OnConflict = "askIncumbent";
const _pick: Pick = "first";

const _lookupPick: LookupClientPick = _pick;
const _lookupPickFn: LookupClientPick = (rows) => rows[0]!;

// @ts-expect-error — stream gap is a closed union
const _badGap: StreamGap = "restart";

// @ts-expect-error — verify mode is a closed union
const _badVerify: Verify = true;

// make → Policy<C> that is already a Layer
const cutover = PolicyMod.make({
  Sticky: true,
  StreamGap: "stall",
  ColdAmbiguous: "fail",
  Verify: "reject",
});
const _asLayer: Layer.Layer<never> = cutover;
type _CutoverOk = AssertExtends<
  typeof cutover,
  Policy<{
    Sticky: true;
    StreamGap: "stall";
    ColdAmbiguous: "fail";
    Verify: "reject";
  }>
>;
const _cutoverOk: _CutoverOk = true;

// layer expands config — last write wins (Verify / StreamGap patched)
const expanded = PolicyMod.layer(
  cutover,
  PolicyMod.verifyOff,
  PolicyMod.streamGap("buffer"),
);
type _Expanded = typeof expanded;
type _ExpandedOk = AssertExtends<
  _Expanded,
  Policy<{
    Sticky: true;
    StreamGap: "buffer";
    ColdAmbiguous: "fail";
    Verify: false;
  }>
>;
const _expandedOk: _ExpandedOk = true;

// Fragments alone also expand through layer
const fragOnly = PolicyMod.layer(
  PolicyMod.sticky,
  PolicyMod.streamGap("stall"),
  PolicyMod.verifyOff,
);
type _FragOnlyOk = AssertExtends<
  typeof fragOnly,
  Policy<{ Sticky: true; StreamGap: "stall"; Verify: false }>
>;
const _fragOnlyOk: _FragOnlyOk = true;

// MergePolicyList last-wins
type _Merged = MergePolicyList<
  [
    Policy<{ StreamGap: "stall"; Verify: "reject" }>,
    Policy<{ Verify: false }>,
    Policy<{ StreamGap: "buffer" }>,
  ]
>;
type _MergedGap = AssertEqual<_Merged["StreamGap"], "buffer">;
type _MergedVerify = AssertEqual<_Merged["Verify"], false>;
const _mergedGap: _MergedGap = true;
const _mergedVerify: _MergedVerify = true;

const _yieldCfg: Config = { Yield: true };
const _yieldEffectCfg: Config = { Yield: Effect.succeed(false) };

// @ts-expect-error — StreamGap closed union in make
PolicyMod.make({ StreamGap: "restart" });

// @ts-expect-error — StreamGap closed union on fragment
PolicyMod.streamGap("restart");

void _stickyFragOk;
void _gapFn;
void _coldFn;
void _verifyFn;
void _conflictFn;
void _onYield;
void _gap;
void _cold;
void _verify;
void _conflict;
void _lookupPick;
void _lookupPickFn;
void _badGap;
void _badVerify;
void _asLayer;
void _cutoverOk;
void _expandedOk;
void _fragOnlyOk;
void _mergedGap;
void _mergedVerify;
void _yieldCfg;
void _yieldEffectCfg;

export type {
  _StreamGapFn,
  _ColdFn,
  _VerifyFn,
  _ConflictFn,
  _OnYield,
};
