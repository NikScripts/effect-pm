import { Context, Effect } from "effect";
import * as CustomQueueResource from "../src/CustomQueueResource";
import * as Resource from "../src/Resource";
import type { CustomQueueInstanceSpec } from "../src/CustomQueueResource";
import { Schema } from "effect";

// Type-level proof: CustomQueue toolkit layers materialize a `BuiltResource` — impl carries worker `R`
// until `grantLocal` discharges it (same bundle pattern as QueueResource / Process / RunResource).

class WorkerDep extends Context.Service<WorkerDep, string>()(
  "@nikscripts/effect-pm/test/custom-queue-built-resource.test-d/WorkerDep",
) {}

const JobSchema = Schema.Struct({ id: Schema.String });

class TypedCqr extends CustomQueueResource.Tag<TypedCqr>()("test/built-resource/Cqr", {
  payload: JobSchema,
  levelCount: 2,
}) {}

type Built = Resource.BuiltResource<
  CustomQueueInstanceSpec<typeof JobSchema.fields>,
  WorkerDep
>;

// `BuiltResource` pairs a requirement-carrying impl with captured worker context.
type ImplCarriesWorkerDep = Built["impl"] extends Resource.WithRequirement<
  Resource.ImplOf<CustomQueueInstanceSpec<typeof JobSchema.fields>>,
  WorkerDep
>
  ? true
  : false;
true satisfies ImplCarriesWorkerDep;

type ContextHasWorkerDep = Built["workerContext"] extends Context.Context<WorkerDep>
  ? true
  : false;
true satisfies ContextHasWorkerDep;

// `grantLocal` signature: `BuiltResource<S, R>` in → `ImplOf<S>` out (R stripped from Effect methods).
type GrantLocalOut = Resource.BuiltResource<
  CustomQueueInstanceSpec<typeof JobSchema.fields>,
  WorkerDep
> extends Parameters<
  typeof Resource.grantLocal<typeof TypedCqr, CustomQueueInstanceSpec<typeof JobSchema.fields>, WorkerDep>
>[1]
  ? ReturnType<
      typeof Resource.grantLocal<
        typeof TypedCqr,
        CustomQueueInstanceSpec<typeof JobSchema.fields>,
        WorkerDep
      >
    > extends Resource.ImplOf<CustomQueueInstanceSpec<typeof JobSchema.fields>>
    ? true
    : false
  : false;
true satisfies GrantLocalOut;

// Soundness: a plain `ImplOf` is not assignable to `BuiltResource` without the marker.
type PlainImplIsNotBuilt = Resource.BuiltResource<
  CustomQueueInstanceSpec<typeof JobSchema.fields>,
  WorkerDep
> extends Resource.ImplOf<CustomQueueInstanceSpec<typeof JobSchema.fields>>
  ? false
  : true;
true satisfies PlainImplIsNotBuilt;

// Worker methods on the bundle still carry `R` before grant.
type StartBeforeGrant = Built["impl"]["start"] extends (
  _payload: void
) => Effect.Effect<unknown, unknown, WorkerDep>
  ? true
  : false;
true satisfies StartBeforeGrant;
