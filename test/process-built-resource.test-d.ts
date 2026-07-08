import { Context, Effect } from "effect";
import * as Process from "../src/Process";
import * as Resource from "../src/Resource";
import type { ProcessSpec } from "../src/Process";

// Type-level proof: Process toolkit layers materialize a `BuiltResource` — impl carries worker `R`
// until `grantLocal` discharges it (same bundle pattern as QueueResource / RunResource).

class WorkerDep extends Context.Service<WorkerDep, string>()(
  "@nikscripts/effect-pm/test/process-built-resource.test-d/WorkerDep",
) {}

class TypedProc extends Process.Tag<TypedProc>()("test/built-resource/Typed") {}

type Built = Resource.BuiltResource<ProcessSpec, WorkerDep>;

// `BuiltResource` pairs a requirement-carrying impl with captured worker context.
type ImplCarriesWorkerDep = Built["impl"] extends Resource.WithRequirement<
  Resource.ImplOf<ProcessSpec>,
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
type GrantLocalOut = Resource.BuiltResource<ProcessSpec, WorkerDep> extends Parameters<
  typeof Resource.grantLocal<typeof TypedProc, ProcessSpec, WorkerDep>
>[1]
  ? ReturnType<typeof Resource.grantLocal<typeof TypedProc, ProcessSpec, WorkerDep>> extends Resource.ImplOf<ProcessSpec>
    ? true
    : false
  : false;
true satisfies GrantLocalOut;

// Soundness: a plain `ImplOf` is not assignable to `BuiltResource` without the marker.
type PlainImplIsNotBuilt = Resource.BuiltResource<ProcessSpec, WorkerDep> extends Resource.ImplOf<ProcessSpec>
  ? false
  : true;
true satisfies PlainImplIsNotBuilt;

// Worker methods on the bundle still carry `R` before grant.
type StartBeforeGrant = Built["impl"]["start"] extends Effect.Effect<unknown, unknown, WorkerDep>
  ? true
  : false;
true satisfies StartBeforeGrant;
