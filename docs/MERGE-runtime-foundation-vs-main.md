# Merge guide: `feature/runtime-foundation` → `main` (code-first)

> **Historical document.** This guide describes the original `feature/runtime-foundation` merge and references the now-removed generic `RuntimeObserver` / `ProcessStoreRuntime` / generic `RuntimeFact` vocabulary. The current storage shape is per-domain facets (e.g. `ProcessStoreRunResource`) — see [STORAGE.md](./STORAGE.md). Keep this file only as a record of the original merge.

Audience: reviewers landing this branch—**migrate by example**, not bullets only.

Quick stats (refresh SHAs before you trust them):

```bash
git fetch origin main
git merge-base origin/main HEAD   # ancestor
git rev-list --count main..HEAD   # commit delta (was ~113 on branch tip)
git diff main...HEAD --stat
```

Rough footprint when this doc was written: **~148 files**, **~+17 k / −3.4 k LOC**. Tip was **`HEAD` → `feature/runtime-foundation`**.

---

## Part 1 — Breaking changes (with before / after code)

### 1.1 `Process.make` is id-first — no `name` inside config

**Before (`main`):** single-object form with embedded `name` (removed on this branch).

```ts
// REMOVED — do not use after merge
// Process.make({
//   name: "@app/MyProcess",
//   effect: Effect.logInfo("hi"),
// });
```

**After (branch):**

```ts
import { Effect } from "effect";
import { Process } from "@nikscripts/effect-pm";

Process.make("@app/MyProcess", {
  effect: Effect.logInfo("hi"),
});
```

**Positional `Process.make`** accepts preset polling/schedule layers in either order:

```ts
Process.make("@app/MyProcess", Effect.void, Polling.spaced("1 second"), ProcessSchedule.alwaysArmed);
```

Public config shape is **`ProcessMakeOptions`** — the **`name` field does not exist** on that type (the process id is the first argument to **`make`**).

---

### 1.2 Default schedule: `alwaysArmed` unless you opt into “empty/disarmed until entries”

**After merge:** omitting **`schedule`** and **`scheduleLayer`** ⇒ **`ProcessSchedule.alwaysArmed`** (scheduler runs armed immediately).

```ts
import { Effect } from "effect";
import { Process, ProcessSchedule } from "@nikscripts/effect-pm";

// New default — process is eligible immediately (matches most demo / long-running apps).
const hot = Process.make("@app/HotReloadWorker", {
  effect: Effect.logInfo("tick"),
});

// Old “disarmed until you add entries” semantics — spell it explicitly.
const coldUntilEntries = Process.make("@app/ColdCron", {
  effect: Effect.void,
  schedule: ProcessSchedule.empty,
});
```

---

### 1.3 `ControlService`: REST only — `POST /control` is gone

Callers (including **`@nikscripts/effect-pm`** **CLI**) talk to **resource-oriented** routes. Canonical reference: **`src/ControlService.ts`** routing.

| Verb | Path | Role |
|------|------|------|
| **GET** | `/health` | Liveness probe |
| **GET** | `/contract` | Typed **`ProcessGroupContract`** JSON (`ProcessGroupContractSchema`-compatible) |
| **GET** | `/status` | Combined group status |
| **GET** | `/processes` | Process rows from group status |
| **GET** | `/processes/:id` | One process **`ProcessGroupDetails`** |
| **POST** | `/processes/:id/start` | Start managed process supervisor |
| **POST** | `/processes/:id/stop` | Stop |
| **POST** | `/processes/:id/restart` | Restart |
| **POST** | `/processes/:id/now` | **`runImmediately`** |
| **GET** | `/queues` | Queue rows |
| **GET** | `/queues/:id` | One queue **`QueueDetails`** |
| **POST** | `/queues/:id/pause` | Pause workers |
| **POST** | `/queues/:id/resume` | Resume |
| **POST** | `/queues/:id/clear` | Drain + reset metrics where applicable |

**Encode ids in URL segments** — use **`encodeURIComponent(processOrQueueId)`** so slashes in Effect-style ids (e.g. **`@repo/A/B/MyProcess`**) round-trip safely.

Example client shape (conceptually what **`ProcessManager`** does):

```ts
const pid = encodeURIComponent("@app/MyProcess");
const qid = encodeURIComponent("@app/MyQueue");

await fetch(`http://127.0.0.1:${port}/processes/${pid}/now`, { method: "POST" });
await fetch(`http://127.0.0.1:${port}/queues/${qid}/pause`, { method: "POST" });
```

Package-local demo CLI **`examples/cli.ts`** runs **`ManagedRuntime`** + **`runCli`** from **`src/cli.ts`** hitting these routes (`HOME_SERVER_PORT`).

---

### 1.4 Removed `src/provideLayer.ts` — compose at edges

The package no longer carries a shim for “sprinkle **`Effect.provide`** with **`Layer`** mid-program.” Prefer:

1. **`Effect.provide(effect, context)`** when **`Context`** is already built (library **`src/`** favors this pattern where applicable).
2. **`ManagedRuntime.make(layer)`** for Node CLIs / one-shot scripts (**`runPromise`** / **`runSync`** + **`dispose`**).

```ts
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer, ManagedRuntime } from "effect";
import { runCli } from "@nikscripts/effect-pm";

const platform = Layer.mergeAll(NodeServices.layer, NodeHttpClient.layerNodeHttp);

const app = Effect.gen(function* () {
  yield* runCli({ name: "ops", version: "1", port: 3001 });
});

const rt = ManagedRuntime.make(platform);
void rt.runPromise(app).finally(() => rt.dispose());
```

Example harness (**`examples/shared/demo-harness.ts`**):

```ts
import { Effect, Layer, ManagedRuntime } from "effect";

export const runNodeProgramWithLayer = <R, EL>(
  program: Effect.Effect<void, EL, R>,
  layer: Layer.Layer<R, EL, never>,
  successLine: string,
): void => {
  const rt = ManagedRuntime.make(layer);
  void rt
    .runPromise(program.pipe(Effect.tap(() => Effect.logInfo(successLine))))
    .finally(() => rt.dispose());
};
```

**`pnpm run typecheck`** runs **`tsgo`** twice:

- Root **`tsconfig.json`** — **`strictEffectProvide": "off"`** (tests/examples friendly).
- **`tsconfig.src.strict-effect-provide.json`** — **`include`: `src/**`** only, **`strictEffectProvide": "error"`**.

---

### 1.5 `ConnectionRegistry.layerConfig`: wrap with `Layer.provide(ConfigProvider.layer(...))`

**Implementation detail on branch:** configs resolve via **`yield* cfg.parse(provider)`** after **`yield* ConfigProvider.ConfigProvider`** — sibling **`Layer.mergeAll(registryLayer, ConfigProvider.layer)`** is **not** reliable ordering for memoization. **Prefer an explicit sandwich:**

```ts
import { Config, ConfigProvider, Effect, Layer } from "effect";
import {
  ProcessManager,
  ProcessGroup,
  Process,
  QueueResource,
  /* … */
} from "@nikscripts/effect-pm";

class BillingGroup extends ProcessGroup.Service<BillingGroup>()(
  "@my/BillingGroup",
  [SyncProcess, EmailQueue] as const,
) {}

const urlsFromAppConfig = ConfigProvider.layer(
  ConfigProvider.fromUnknown({
    BILLING_GROUP_BASE_URL: "http://127.0.0.1:32140",
  }),
);

const registry = ProcessManager.ConnectionRegistry.layerConfig(
  [BillingGroup] as const,
  {
    [BillingGroup.id]: Config.string("BILLING_GROUP_BASE_URL"),
  },
).pipe(Layer.provide(urlsFromAppConfig));

yield* Effect.gen(function* () {
  const manager = yield* ProcessManager.connect(BillingGroup);
  yield* manager.verifyContract;
}).pipe(Effect.provide(registry));
```

This matches the hardened **test**: **`process-manager.test.ts`** (`connects to a group through a config-backed connection registry`).

Static URL map (**no **`Config`** parsing**) stays simple:

```ts
const RemoteGroupsLive = ProcessManager.ConnectionRegistry.layer(
  [BillingGroup] as const,
  { [BillingGroup.id]: "http://127.0.0.1:32137" },
);
```

Canonical runnable example: **`examples/forms/process-group/process-manager-connection-registry.ts`** (`pnpm run example:form:process-manager-connection-registry` when wired in **`package.json`**).

---

## Part 2 — Features (examples you can cargo-cult)

### 2.1 Typed group: **`ProcessGroup.make(groupId, entries)`** + **`as const`** tuple

Minimal pattern from **`examples/forms/process-group/process-group-make-entries.ts`**:

```ts
import { Effect, Layer, Ref } from "effect";
import { Process, ProcessGroup, QueueResource } from "@nikscripts/effect-pm";

interface EmailJob {
  readonly to: string;
  readonly subject: string;
}

Effect.scoped(
  Effect.gen(function* () {
    const sentEmails = yield* Ref.make<ReadonlyArray<string>>([]);

    class EmailQueue extends QueueResource.Service<EmailQueue, EmailJob, never>()(
      "@examples/EmailQueue",
      {
        effect: (email) =>
          Ref.update(sentEmails, (emails) => [...emails, email.to]),
        concurrency: 1,
      },
    ) {}

    class SyncBilling extends Process.Service<SyncBilling>()("@examples/SyncBilling", {
      effect: Effect.gen(function* () {
        const emailQueue = yield* EmailQueue;
        yield* emailQueue.add({
          to: "ops@example.com",
          subject: "billing sync finished",
        });
      }),
    }) {}

    const envLayer = Layer.mergeAll(SyncBilling.layer, EmailQueue.layer);

    yield* Effect.gen(function* () {
      const group = yield* ProcessGroup.make("@examples/BillingGroup", [
        SyncBilling,
        EmailQueue,
      ] as const);

      yield* group.runImmediately(SyncBilling);

      const q = yield* EmailQueue;
      // … assertions / logging …
      void q;
      void group.contract;
    }).pipe(Effect.provide(envLayer));
  }),
);
```

Typed controls (**no typos compile**):

```ts
yield* group.start(SyncBilling);
yield* group.queue(EmailQueue).enqueue({ to: "x@y.com", subject: "Hi" });
// yield* group.start(EmailQueue); // ❌ not a process entry
```

---

### 2.2 Injectable group: **`ProcessGroup.Service`** + **`BillingGroup.layer`**

Same example family as **`process-group-make-entries`**, plus:

```ts
class BillingGroup extends ProcessGroup.Service<BillingGroup>()(
  "@examples/BillingGroup",
  [SyncBilling, EmailQueue, InvoiceQueue] as const,
) {}

const program = Effect.gen(function* () {
  const group = yield* BillingGroup;

  yield* group.process(SyncBilling).runImmediately;
  yield* group.queue(EmailQueue).status;
}).pipe(
  Effect.provide(
    BillingGroup.layer.pipe(
      Layer.provide(Layer.mergeAll(SyncBilling.layer, EmailQueue.layer /* … */)),
    ),
  ),
);
```

**Bundled queue layers:** **`ProcessGroup.Service`** merges each queue entry’s **`layer`** (**`QueueResource.Service`**) into **`BillingGroup.layer`**, so after **`Effect.provide(BillingGroup.layer)`** the **`Process`** **`effect`** bodies can **`yield* EmailQueue`** etc.

---

### 2.3 Local **`ControlService.make`** wired to typed group

```ts
import { ControlService } from "@nikscripts/effect-pm";

yield* Effect.gen(function* () {
  const group = yield* BillingGroup;

  yield* ControlService.make({
    port: 32137,
    group,
  });

  // Now GET http://127.0.0.1:32137/contract mirrors group.contract JSON shape.
}).pipe(/* provide BillingGroup.layer + Store + queues + processes */);
```

Contract tests live in **`test/control-service-contract.test.ts`**.

---

### 2.4 Remote **`ProcessManager`**: **`connect`**, **`verifyContract`**, registry

**Registry-backed connect** (**static URLs**) — excerpt from **`examples/forms/process-group/process-manager-connection-registry.ts`**:

```ts
const RemoteGroupsLive = ProcessManager.ConnectionRegistry.layer(
  [BillingGroup] as const,
  { [BillingGroup.id]: "http://127.0.0.1:32137" },
);

const remoteProgram = Effect.gen(function* () {
  const manager = yield* ProcessManager.connect(BillingGroup);

  yield* manager.verifyContract;
  yield* manager.process(SyncProcess.id).runImmediately;

  const status = yield* manager.status;
  Effect.logInfo(`remote status ok: ${String(status.success)}`);
}).pipe(
  Effect.provide(Layer.mergeAll(RemoteGroupsLive, NodeHttpClient.layerUndici)),
);
```

Typed **`Endpoint`** (injectable **`baseUrl`**):

```ts
class BillingEndpoint extends ProcessManager.Endpoint<BillingEndpoint>()(
  BillingGroup,
  { baseUrl: "http://127.0.0.1:32132" },
) {}

// BillingEndpoint.layer is the Endpoint service + HttpClient requirements;
// tests/examples merge Node Undici adapter.
```

---

### 2.5 Same group key locally **or** over HTTP — **`ProcessGroup.remoteLayer`**

Tail of **`examples/forms/process-group/process-group-remote-layer.ts`**:

```ts
const remoteProgram = Effect.gen(function* () {
  const remoteBilling = yield* BillingGroup;
  yield* remoteBilling.process(SyncProcess).runImmediately;
  yield* remoteBilling.queue(EmailQueue).pause;
  // enqueue over remote UnsupportedRemoteControlError today — exercised in example
}).pipe(
  Effect.provide(
    ProcessGroup.remoteLayer(BillingGroup, BillingEndpoint).pipe(
      Layer.provide(BillingEndpoint.layer),
      Layer.provide(NodeHttpClient.layerUndici),
    ),
  ),
);
```

Inside that remote program **`yield* BillingGroup`** is satisfied by **`remoteLayer`** (HTTP façade) rather than **`BillingGroup.layer`**.

---

### 2.6 Multi-group CLI (**`ProcessManager.cli`**)

From **`docs/plans/07-process-manager.md`** (matches runtime intent + tests **`test/process-manager.test.ts`**):

```ts
const RemoteGroupsLive = ProcessManager.ConnectionRegistry.layer(
  [BillingGroup, StripeGroup] as const,
  {
    [BillingGroup.id]: "http://127.0.0.1:32130",
    [StripeGroup.id]: "http://127.0.0.1:32131",
  },
);

const cli = ProcessManager.cli([BillingGroup, StripeGroup] as const);

yield* cli.pipe(Effect.provide(Layer.mergeAll(RemoteGroupsLive, HttpClient.layer)));
```

Operator-facing verbs (canonical ids + normalization rules — see **`07-process-manager.md`**):

```bash
effect-pm groups
effect-pm groups --json
effect-pm ls
effect-pm verify
effect-pm status north-west/billing-group/sync-invoices --json
effect-pm start north-west/billing-group/sync-invoices
effect-pm now @repo/NorthWest/BillingGroup/SyncInvoices
effect-pm pause south-west/billing-group/billing-email-queue
effect-pm clear south-west/billing-group/billing-email-queue
```

---

### 2.7 Queue **`itemSchema`** — validation before mutation

Minimal pattern from **`test/queue-resource.test.ts`** (`QueueResource.make` scoped example):

```ts
import { Schema } from "effect";
import {
  QueueResource,
  QueueItemValidationError,
  QueueBatchValidationError,
  makeQueueItemCodecDescriptor,
} from "@nikscripts/effect-pm";

const EmailItem = Schema.Struct({
  id: Schema.String,
  subject: Schema.String,
});

yield* QueueResource.make({
  name: "@app/ValidatedEmailQueue",
  itemSchema: EmailItem,
  effect: () => Effect.void,
  concurrency: 2,
}); // rejects invalid payloads with QueueItemValidationError / QueueBatchValidationError before enqueue

makeQueueItemCodecDescriptor("@test/EmailQueue", EmailItem);
// => { id: "@test/EmailQueue/item@v1", encoding: "json", jsonSchema: … }
```

Declare with **`QueueResource.Service`** to attach **`item`** metadata for future contract / remote enqueue (plan **02**/ **07**).

**Generics migration:** Earlier sketches used **`QueueHandle<T, R, E>`** / **`QueueResource.Service<Self, T, R, E>`**-style ordering. The shipped package uses **`QueueHandle<T, E, EEnqueue, R>`** (**worker failure `E`, enqueue-validation errors `EEnqueue`, ambient requirements `R` last**) and **`QueueResource.Service<Self, T, E>`**, which infers ambient requirements from config.

---

### 2.8 Runtime observers — **`RuntimeObserver`** + **`RunResource`**

Listener layer + gated runs — **`examples/forms/resource/run-resource-runtime-observer.ts`**:

```ts
import { Effect, Ref } from "effect";
import {
  RunResource,
  RuntimeObserver,
  type RuntimeObserverListener,
} from "@nikscripts/effect-pm";

const observerLayer = RuntimeObserver.layerListeners([
  {
    onFact: (fact) => Ref.update(factTypes, (xs) => [...xs, fact.type]),
  },
  {
    onStateChange: (change) =>
      Effect.logInfo(`state: ${change.reason}`),
  },
]);

yield* Effect.gen(function* () {
  const gate = yield* RunResource.make({
    name: "examples/ObservedRunGate",
    effect: (n: number) =>
      n >= 0 ? Effect.succeed(n + 1) : Effect.fail("negative input"),
    concurrency: 1,
  });
  yield* gate(1);
}).pipe(/* provide observerLayer */);
```

**`RuntimeObserver.layerProcessStore`**, **`ProcessStore.events(query)`**, runtime fact projections (**`runtime.facts`**, **`runResource.history`**) — details in **`docs/plans`** + **`.changeset/typed-process-group-contracts.md`**.

---

### 2.9 Package **`exports`** — deep imports

From **`package.json`** (consume without barrel tree-shaking guilt):

```text
{
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.mjs" },
    "./Process": { "types": "./dist/Process.d.ts", "import": "./dist/Process.mjs" },
    "./QueueResource": { "types": "./dist/QueueResource.d.ts", "import": "./dist/QueueResource.mjs" },
    "./ProcessGroup": { "types": "./dist/ProcessGroup.d.ts", "import": "./dist/ProcessGroup.mjs" },
    "./ProcessStore": { "types": "./dist/ProcessStore.d.ts", "import": "./dist/ProcessStore.mjs" },
    "./ProcessManager": { "types": "./dist/ProcessManager.d.ts", "import": "./dist/ProcessManager.mjs" },
    "./ControlService": { "types": "./dist/ControlService.d.ts", "import": "./dist/ControlService.mjs" },
    "./storage/file": { "types": "./dist/storage/file.d.ts", "import": "./dist/storage/file.mjs" },
    "./storage/prisma": { "types": "./dist/storage/prisma.d.ts", "import": "./dist/storage/prisma.mjs" },
    "./prisma": { "types": "./dist/prisma/index.d.ts", "import": "./dist/prisma/index.mjs" }
  }
}
```

```ts
import { ProcessGroup } from "@nikscripts/effect-pm/ProcessGroup";
```

---

### 2.10 Legacy **`ProcessGroup.make({ processes, queues })`** (still wired)

Older split-array ergonomics survive for compatibility while migration continues (**string keys internally**):

```ts
const legacyGroup = yield* ProcessGroup.make({
  processes: [emailSync, dataPoller],
  queues: [EmailQueueTag, NotifyQueueTag],
});

// string-keyed helpers remain on that group handle shape
yield* legacyGroup.start(emailSync.name);
```

Prefer **typed tuple** (**§2.1**) for new code (**`examples/scenarios/game-window-polling-with-process-group.ts`** demonstrates **`Process.Service` + `make(id, […])`**). **`test/process-group.test.ts`** still pins the split-array **`make`** path.

---

## Part 3 — Technical appendix

### 3.1 Regression fixes bundled on branch tip

- **`isProcessGroupRuntimeQueueTag`** now accepts **`typeof entry === "function"`** (**`QueueResource.Service` classes** expose **`asEffect`**) → **`queueMap`** populated (**fixes enqueue + GET `/queues/...`** 404 storms).
- **`ConnectionRegistry.layerConfig`** reads configs via **`Config.parse(provider)`**.

### 3.2 Where to copy-paste runnable code

| Topic | Primary path |
|------|----------------|
| Typed group compose | **`examples/forms/process-group/process-group-make-entries.ts`** |
| Registry **`connect`** | **`examples/forms/process-group/process-manager-connection-registry.ts`** |
| **`remoteLayer`** | **`examples/forms/process-group/process-group-remote-layer.ts`** |
| **`ControlService` contract + REST** | **`test/control-service-contract.test.ts`** |
| Multi-group **`ProcessManager` / CLI behavior** | **`test/process-manager.test.ts`**, **`docs/plans/07-process-manager.md`** |
| Runtime observer listeners | **`examples/forms/resource/run-resource-runtime-observer.ts`** |
| Example layout index | **`examples/README.md`** |
| Plans / roadmap | **`docs/plans/CURRENT-ROADMAP.md`**, **`docs/plans/12-standalone-instance-spawns.md`** |

### 3.3 Pre-merge verification

```bash
pnpm install
pnpm run typecheck   # dual ts projects
pnpm test
pnpm run lint
pnpm run build
```

### 3.4 Release hygiene

Squash [.changeset/](../.changeset) minors/patches (**typed group**, **make id-first**, schedule default, strict-effect doc patch, etc.) into release notes coherent with **Part 1**/**Part 2** above.
