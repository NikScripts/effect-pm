import { Context, Effect } from "effect";
import * as Process from "../src/Process";
import * as Hyperlink from "../src/Hyperlink";
import type { ProcessSpec } from "../src/Process";

// Type-level proof: Process toolkit layers materialize a `BuiltHyperlink` — impl carries worker `R`
// until `grantLocal` discharges it (same bundle pattern as WorkPool / Gate).

class WorkerDep extends Context.Service<WorkerDep, string>()(
  "hyperlink-ts/test/process-built-resource.test-d/WorkerDep",
) {}

class TypedProc extends Process.Tag<TypedProc>()("test/built-resource/Typed") {}

type Built = Hyperlink.BuiltHyperlink<ProcessSpec, WorkerDep>;

// `BuiltHyperlink` pairs a requirement-carrying impl with captured worker context.
type ImplCarriesWorkerDep = Built["impl"] extends Hyperlink.WithRequirement<
  Hyperlink.ImplOf<ProcessSpec>,
  WorkerDep
>
  ? true
  : false;
true satisfies ImplCarriesWorkerDep;

type ContextHasWorkerDep = Built["workerContext"] extends Context.Context<WorkerDep>
  ? true
  : false;
true satisfies ContextHasWorkerDep;

// `grantLocal` signature: `BuiltHyperlink<S, R>` in → `ImplOf<S>` out (R stripped from Effect methods).
type GrantLocalOut = Hyperlink.BuiltHyperlink<ProcessSpec, WorkerDep> extends Parameters<
  typeof Hyperlink.grantLocal<typeof TypedProc, ProcessSpec, WorkerDep>
>[1]
  ? ReturnType<typeof Hyperlink.grantLocal<typeof TypedProc, ProcessSpec, WorkerDep>> extends Hyperlink.ImplOf<ProcessSpec>
    ? true
    : false
  : false;
true satisfies GrantLocalOut;

// Soundness: a plain `ImplOf` is not assignable to `BuiltHyperlink` without the marker.
type PlainImplIsNotBuilt = Hyperlink.BuiltHyperlink<ProcessSpec, WorkerDep> extends Hyperlink.ImplOf<ProcessSpec>
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
