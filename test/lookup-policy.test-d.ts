/**
 * Policy public types — camelCase Layer helpers; layer dual expands configs.
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
  ConfigOf,
} from "../src/LookupPolicy";
import * as PolicyMod from "../src/LookupPolicy";
import type { LookupClientPick } from "../src/Hyperlink";

type AssertExtends<A, B> = [A] extends [B] ? true : false;
type AssertEqual<A, B> =
  [A] extends [B] ? ([B] extends [A] ? true : false) : false;

const _stickyOk: AssertExtends<
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

const cutover = PolicyMod.make({
  Sticky: true,
  StreamGap: "stall",
  ColdAmbiguous: "fail",
  Verify: "reject",
});
const cutoverLayers = PolicyMod.layer(
  PolicyMod.sticky,
  PolicyMod.streamGap("stall"),
  PolicyMod.coldAmbiguous("fail"),
  PolicyMod.verify("reject"),
);
const _asLayer: Layer.Layer<never> = cutover;
const _cutoverOk: AssertExtends<
  typeof cutover,
  Policy<{
    Sticky: true;
    StreamGap: "stall";
    ColdAmbiguous: "fail";
    Verify: "reject";
  }>
> = true;
const _cutoverLayersOk: AssertExtends<
  typeof cutoverLayers,
  Policy<{
    Sticky: true;
    StreamGap: "stall";
    ColdAmbiguous: "fail";
    Verify: "reject";
  }>
> = true;

// pipe(LookupPolicy.layer(...)) expands config — last write wins
const piped = cutover.pipe(
  PolicyMod.layer(PolicyMod.verifyOff),
  PolicyMod.layer(PolicyMod.streamGap("buffer")),
);
const _pipedOk: AssertExtends<
  typeof piped,
  Policy<{
    Sticky: true;
    StreamGap: "buffer";
    ColdAmbiguous: "fail";
    Verify: false;
  }>
> = true;
type _PipedCfg = ConfigOf<typeof piped>;
const _pipedGap: AssertEqual<_PipedCfg["StreamGap"], "buffer"> = true;

const expanded = PolicyMod.layer(
  cutover,
  PolicyMod.verifyOff,
  PolicyMod.streamGap("buffer"),
);
const _expandedOk: AssertExtends<
  typeof expanded,
  Policy<{
    Sticky: true;
    StreamGap: "buffer";
    ColdAmbiguous: "fail";
    Verify: false;
  }>
> = true;

const fragOnly = PolicyMod.layer(
  PolicyMod.sticky,
  PolicyMod.streamGap("stall"),
  PolicyMod.verifyOff,
);
const _fragOnlyOk: AssertExtends<
  typeof fragOnly,
  Policy<{ Sticky: true; StreamGap: "stall"; Verify: false }>
> = true;

type _Merged = MergePolicyList<
  [
    Policy<{ StreamGap: "stall"; Verify: "reject" }>,
    Policy<{ Verify: false }>,
    Policy<{ StreamGap: "buffer" }>,
  ]
>;
const _mergedGap: AssertEqual<_Merged["StreamGap"], "buffer"> = true;
const _mergedVerify: AssertEqual<_Merged["Verify"], false> = true;

const _yieldCfg: Config = { Yield: true };
const _yieldEffectCfg: Config = { Yield: Effect.succeed(false) };

// @ts-expect-error — StreamGap closed union in make
PolicyMod.make({ StreamGap: "restart" });

// @ts-expect-error — StreamGap closed union on helper
PolicyMod.streamGap("restart");

// @ts-expect-error — two-arg succeed removed
PolicyMod.succeed("Sticky", true);

void _stickyOk;
void _cutoverLayersOk;
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
void _pipedOk;
void _pipedGap;
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
