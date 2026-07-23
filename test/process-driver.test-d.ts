import { Context, Effect } from "effect";
import * as Daemon from "../src/Daemon";
import * as Hyperlink from "../src/Hyperlink";
import type { DaemonSpec } from "../src/Daemon";

// Type-level proof: Daemon toolkit layers materialize a `Driver` — impl carries worker `R`
// until `grantLocal` discharges it (same bundle pattern as WorkPool / Gate).

class WorkerDep extends Context.Service<WorkerDep, string>()(
  "hyperlink-ts/test/process-built-resource.test-d/WorkerDep",
) {}

class TypedProc extends Daemon.Tag<TypedProc>()("test/built-resource/Typed") {}

type Built = Hyperlink.Driver<DaemonSpec, WorkerDep>;

// `Driver` pairs a requirement-carrying impl with captured worker context.
type ImplCarriesWorkerDep = Built["impl"] extends Hyperlink.WithRequirement<
  Hyperlink.ImplOf<DaemonSpec>,
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
type GrantLocalOut = Hyperlink.Driver<DaemonSpec, WorkerDep> extends Parameters<
  typeof Hyperlink.grantLocal<typeof TypedProc, DaemonSpec, WorkerDep>
>[1]
  ? ReturnType<typeof Hyperlink.grantLocal<typeof TypedProc, DaemonSpec, WorkerDep>> extends Hyperlink.ImplOf<DaemonSpec>
    ? true
    : false
  : false;
true satisfies GrantLocalOut;

// Soundness: a plain `ImplOf` is not assignable to `Driver` without the marker.
type PlainImplIsNotBuilt = Hyperlink.Driver<DaemonSpec, WorkerDep> extends Hyperlink.ImplOf<DaemonSpec>
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
