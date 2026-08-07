/**
 * Policy public types — make/merge typed Layers; fragments are Layers;
 * LookupClientPick aliases Policy.Pick.
 */
import { Effect, type Layer } from "effect";
import type {
  StreamGap,
  ColdAmbiguous,
  Verify,
  OnConflict,
  Pick,
  Config,
  MergeConfigs,
  Policy,
} from "../src/Policy";
import * as PolicyMod from "../src/Policy";
import type { LookupClientPick } from "../src/Hyperlink";

type AssertExtends<A, B> = [A] extends [B] ? true : false;
type AssertEqual<A, B> =
  [A] extends [B] ? ([B] extends [A] ? true : false) : false;

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

// make → Policy<C> that is already a Layer
const cutover = PolicyMod.make({
  Sticky: true,
  StreamGap: "stall",
  ColdAmbiguous: "fail",
  Verify: "reject",
});
const _asLayer: Layer.Layer<never> = cutover;
type _Cutover = typeof cutover;
type _CutoverOk = AssertExtends<
  _Cutover,
  Policy<{
    Sticky: true;
    StreamGap: "stall";
    ColdAmbiguous: "fail";
    Verify: "reject";
  }>
>;
const _cutoverOk: _CutoverOk = true;

// merge patches literals into the type
const patched = cutover.pipe(
  PolicyMod.merge({ StreamGap: "buffer", Verify: false }),
);
type _PatchedCfg = MergeConfigs<
  {
    Sticky: true;
    StreamGap: "stall";
    ColdAmbiguous: "fail";
    Verify: "reject";
  },
  { StreamGap: "buffer"; Verify: false }
>;
type _PatchedOk = AssertEqual<
  _PatchedCfg["StreamGap"],
  "buffer"
>;
type _PatchedVerify = AssertEqual<_PatchedCfg["Verify"], false>;
type _PatchedSticky = AssertEqual<_PatchedCfg["Sticky"], true>;
const _patchedOk: _PatchedOk = true;
const _patchedVerify: _PatchedVerify = true;
const _patchedSticky: _PatchedSticky = true;
const _patchedAsLayer: Layer.Layer<never> = patched;

// Config accepts Yield boolean or Effect
const _yieldCfg: Config = {
  Yield: true,
};
const _yieldEffectCfg: Config = {
  Yield: Effect.succeed(false),
};

// @ts-expect-error — StreamGap closed union in make
PolicyMod.make({ StreamGap: "restart" });

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
void _patchedOk;
void _patchedVerify;
void _patchedSticky;
void _patchedAsLayer;
void _yieldCfg;
void _yieldEffectCfg;

export type {
  _Sticky,
  _StreamGapFn,
  _ColdFn,
  _VerifyFn,
  _ConflictFn,
  _OnYield,
};
