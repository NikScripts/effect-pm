import { Effect, Schema } from "effect";
import * as RunResource from "../src/RunResource";
import { runSpec } from "../src/internal/runResourceSchema";
import * as Resource from "../src/Resource";

// ── The soundness guard for the ONE cast in `nameRunService` ─────────────────
// `yield* MyRun` is asserted to be `RunResource<Decoded<I>, A["Type"], E["Type"]>`; that assertion is
// only sound if the named handle is bidirectionally equal to the raw contract
// `ServiceOf<RunInstanceSpec<I, A, E>>`. TS can't prove that for generic params (invariant service
// Shape), so we prove it here for concrete representative schemas. If the shapes ever drift, THIS FAILS
// THE BUILD — which is what licenses the cast.

// ── param gate with a typed error: bidirectional Contract ⇄ Handle ───────────
type ContractIE = Resource.ShapeOf<
  ReturnType<typeof runSpec<typeof Schema.Number, typeof Schema.String, typeof Schema.Boolean>>
>;
type HandleIE = RunResource.RunResource<number, string, boolean>;

declare const contractIE: ContractIE;
declare const handleIE: HandleIE;

// bidirectional — direct assignments, no casts. Either failing = the assertion is unsound.
const _handleToContractIE: ContractIE = handleIE;
const _contractToHandleIE: HandleIE = contractIE;
void [_handleToContractIE, _contractToHandleIE];

// ── unit gate (void payload → `run` is a bare Effect): bidirectional ─────────
type ContractUnit = Resource.ShapeOf<
  ReturnType<typeof runSpec<typeof Schema.Void, typeof Schema.Number>>
>;
type HandleUnit = RunResource.RunResource<void, number, never>;
declare const contractUnit: ContractUnit;
declare const handleUnit: HandleUnit;
const _handleToContractUnit: ContractUnit = handleUnit;
const _contractToHandleUnit: HandleUnit = contractUnit;
void [_handleToContractUnit, _contractToHandleUnit];

// ── the naming actually took effect: `yield* MyRun` (= Shape<MyRun>) IS the named handle ─────────────
class Fetch extends RunResource.Tag<Fetch>()("test/run-handle/Fetch", {
  payload: Schema.Number,
  success: Schema.String,
  error: Schema.Boolean,
}) {}
declare const fetchService: Resource.Shape<typeof Fetch>;
const _yieldToHandle: HandleIE = fetchService;
const _handleToYield: Resource.Shape<typeof Fetch> = handleIE;
void [_yieldToHandle, _handleToYield];

// ── DoD: hover exactness. A payload/success/error tag types as `RunResource<number, string, boolean, never>`.
type Exact<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const assertExact = <_ extends true>(): void => {};
assertExact<
  Exact<
    Resource.Shape<typeof Fetch>,
    RunResource.RunResource<number, string, boolean, never>
  >
>();

// ── DoD: a unit gate declaring only `success` hovers as `RunResource<void, number, never, never>` ────
class Tick extends RunResource.Service<Tick>()("test/run-handle/Tick", {
  success: Schema.Number,
  effect: () => Effect.succeed(1),
}) {}
assertExact<
  Exact<Resource.Shape<typeof Tick>, RunResource.RunResource<void, number, never, never>>
>();

// ── DoD: the static `.run` shortcut is Effect (unit) vs a call (parameterized) ───────────────────────
// (mirrors run-resource.test-d.ts; ensures the naming cast keeps the static run's shape.)
// @ts-expect-error — void gates reject positional input
void Tick.run(1);
// @ts-expect-error — parameterized gates require input
void Fetch.run();
