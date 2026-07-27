/**
 * Soundness guard for the ONE cast in {@link Hyperlink.remapTagService} used by
 * {@link Hyperlink.defaults}.
 *
 * `defaults` claims `Svc → Svc & Bag` on `HyperlinkTag` (and keeps toolkit named
 * handles: `WorkPool` / `Gate`). Generics + class-`Self` + invariant `Shape` block a
 * proved remap, so the cast is licensed here by bidirectional assignability on
 * concrete representatives — same pattern as `test/gate-handle.test-d.ts` /
 * `test/queue-handle.test-d.ts`. If these fail, the cast is unsound.
 */
import { Schema } from "effect";
import { expectTypeOf } from "vitest";
import * as Gate from "../src/Gate";
import * as Hyperlink from "../src/Hyperlink";
import * as WorkPool from "../src/WorkPool";

type Exact<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const assertExact = <_ extends true>(): void => {};

// ── bare Tag + defaults: yield* IS Spec service & bag ─────────────────────────
class Adorned extends Hyperlink.Tag<Adorned>()("defaults-handle/Adorned", {
  current: Hyperlink.effect(Schema.Number),
}).pipe(
  Hyperlink.defaults({
    label: (n: number) => `n=${n}`,
    tags: ["admin", "beta"] as const,
  }),
) {}

type AdornedSvc = Hyperlink.Shape<typeof Adorned>;
type AdornedContract = Hyperlink.ShapeOf<
  Hyperlink.SpecOf<typeof Adorned>,
  Adorned
>;
type AdornedBag = {
  readonly label: (n: number) => string;
  readonly tags: readonly ["admin", "beta"];
};
type AdornedWidened = AdornedContract & AdornedBag;

declare const adornedSvc: AdornedSvc;
declare const adornedWidened: AdornedWidened;

// bidirectional — either failing = remap is unsound
const _svcToWidened: AdornedWidened = adornedSvc;
const _widenedToSvc: AdornedSvc = adornedWidened;
void [_svcToWidened, _widenedToSvc];

assertExact<Exact<AdornedSvc, AdornedWidened>>();
expectTypeOf(adornedSvc.label).toEqualTypeOf<(n: number) => string>();
expectTypeOf(adornedSvc.tags).toEqualTypeOf<readonly ["admin", "beta"]>();
expectTypeOf(adornedSvc.current).toEqualTypeOf<
  Hyperlink.ShapeOf<Hyperlink.SpecOf<typeof Adorned>, Adorned>["current"]
>();

// WithDefaults stays an identity alias once Svc is remapped
expectTypeOf<Hyperlink.WithDefaults<typeof Adorned>>().toEqualTypeOf<AdornedSvc>();

// ── WorkPool.Tag + defaults: named handle ∧ bag ───────────────────────────────
const Job = Schema.Struct({ id: Schema.String });
class Jobs extends WorkPool.Tag<Jobs>()("defaults-handle/Jobs", {
  payload: Job,
}).pipe(
  Hyperlink.defaults({
    label: (n: number) => `job=${n}`,
  }),
) {}

type JobsSvc = Hyperlink.Shape<typeof Jobs>;
type JobsHandle = WorkPool.WorkPool<Hyperlink.Decoded<typeof Job>>;
type JobsBag = { readonly label: (n: number) => string };
type JobsWidened = JobsHandle & JobsBag;

declare const jobsSvc: JobsSvc;
declare const jobsWidened: JobsWidened;

const _jobsSvcToWidened: JobsWidened = jobsSvc;
const _jobsWidenedToSvc: JobsSvc = jobsWidened;
void [_jobsSvcToWidened, _jobsWidenedToSvc];

assertExact<Exact<JobsSvc, JobsWidened>>();
expectTypeOf(jobsSvc.label).toEqualTypeOf<(n: number) => string>();
expectTypeOf(jobsSvc.add).toEqualTypeOf<JobsHandle["add"]>();

// ── Gate.Tag + defaults: named handle ∧ bag ───────────────────────────────────
class Fetch extends Gate.Tag<Fetch>()("defaults-handle/Fetch", {
  payload: Schema.Number,
  success: Schema.String,
  error: Schema.Boolean,
}).pipe(
  Hyperlink.defaults({
    label: (n: number) => `fetch=${n}`,
  }),
) {}

type FetchSvc = Hyperlink.Shape<typeof Fetch>;
type FetchHandle = Gate.Gate<number, string, boolean>;
type FetchBag = { readonly label: (n: number) => string };
type FetchWidened = FetchHandle & FetchBag;

declare const fetchSvc: FetchSvc;
declare const fetchWidened: FetchWidened;

const _fetchSvcToWidened: FetchWidened = fetchSvc;
const _fetchWidenedToSvc: FetchSvc = fetchWidened;
void [_fetchSvcToWidened, _fetchWidenedToSvc];

assertExact<Exact<FetchSvc, FetchWidened>>();
expectTypeOf(fetchSvc.label).toEqualTypeOf<(n: number) => string>();
expectTypeOf(fetchSvc.run).toEqualTypeOf<FetchHandle["run"]>();

// ── double-pipe merges bag onto Svc ───────────────────────────────────────────
class Double extends Hyperlink.defaults(
  Hyperlink.defaults(
    Hyperlink.Tag<Double>()("defaults-handle/Double", {
      current: Hyperlink.effect(Schema.Number),
    }),
    { a: 1 as const },
  ),
  { b: 2 as const },
) {}

type DoubleSvc = Hyperlink.Shape<typeof Double>;
expectTypeOf<DoubleSvc["a"]>().toEqualTypeOf<1>();
expectTypeOf<DoubleSvc["b"]>().toEqualTypeOf<2>();
expectTypeOf<DoubleSvc["current"]>().toEqualTypeOf<
  Hyperlink.ShapeOf<Hyperlink.SpecOf<typeof Double>, Double>["current"]
>();
