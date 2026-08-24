import { Context, Effect } from "effect";
import * as WorkPool from "../src/WorkPool";
import * as Hyperlink from "../src/Hyperlink";
import type { PriorityInstanceSpec } from "../src/WorkPool";
import { Schema } from "effect";

// Type-level proof: Priority toolkit layers materialize a `Driver` — impl carries worker `R`
// until `grantLocal` discharges it (same bundle pattern as WorkPool / Daemon / Gate).

class WorkerDep extends Context.Service<WorkerDep, string>()(
  "hyperlink-ts/test/priority-driver.test-d/WorkerDep",
) {}

const JobSchema = Schema.Struct({ id: Schema.String });

class TypedCqr extends WorkPool.priority<TypedCqr>()("test/built-resource/Cqr", {
  payload: JobSchema,
  laneCount: 2,
}) {}

type Built = Hyperlink.Driver<
  PriorityInstanceSpec<typeof JobSchema.fields>,
  WorkerDep
>;

// `Driver` pairs a requirement-carrying impl with captured worker context.
type ImplCarriesWorkerDep = Built["impl"] extends Hyperlink.WithRequirement<
  Hyperlink.ImplOf<PriorityInstanceSpec<typeof JobSchema.fields>>,
  WorkerDep
>
  ? true
  : false;
true satisfies ImplCarriesWorkerDep;

type ContextHasWorkerDep = Built["workerContext"] extends Context.Context<WorkerDep>
  ? true
  : false;
true satisfies ContextHasWorkerDep;

// `grantLocal` signature: `Driver<S, R>` in → `ImplOf<S>` out (R stripped from Effect methods).
type GrantLocalOut = Hyperlink.Driver<
  PriorityInstanceSpec<typeof JobSchema.fields>,
  WorkerDep
> extends Parameters<
  typeof Hyperlink.grantLocal<typeof TypedCqr, PriorityInstanceSpec<typeof JobSchema.fields>, WorkerDep>
>[1]
  ? ReturnType<
      typeof Hyperlink.grantLocal<
        typeof TypedCqr,
        PriorityInstanceSpec<typeof JobSchema.fields>,
        WorkerDep
      >
    > extends Hyperlink.ImplOf<PriorityInstanceSpec<typeof JobSchema.fields>>
    ? true
    : false
  : false;
true satisfies GrantLocalOut;

// Soundness: a plain `ImplOf` is not assignable to `Driver` without the marker.
type PlainImplIsNotBuilt = Hyperlink.Driver<
  PriorityInstanceSpec<typeof JobSchema.fields>,
  WorkerDep
> extends Hyperlink.ImplOf<PriorityInstanceSpec<typeof JobSchema.fields>>
  ? false
  : true;
true satisfies PlainImplIsNotBuilt;

// Worker methods on the bundle still carry `R` before grant.
type StartBeforeGrant = Built["impl"]["start"] extends Effect.Effect<
  unknown,
  unknown,
  WorkerDep
>
  ? true
  : false;
true satisfies StartBeforeGrant;
