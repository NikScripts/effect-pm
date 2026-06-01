# Dashboard controls and logs recipe

## Goal

Define the first React dashboard surface around two primitives only:

- `Controls` for group, process, and queue control actions.
- `Logs` for group, process, and queue log viewing.

## Non-goals

- No widget registry.
- No drag/drop, resizing, pagination, or edit mode.
- No Tailwind, shadcn, or TanStack Table implementation in this thread.
- No Effect UI component model; React components stay normal TSX.

## Mise en place findings

- `@nikscripts/effect-pm/react` already ships `ControlPlanePort`, provider,
  polling hooks, `ProcessGroupControlPanel`, `QueueControlPanel`, and
  `OperatorControlPanel`.
- `ControlPlanePort` has contract, group status, process actions, and queue
  actions, but no log methods yet.
- `ControlService` already exposes process and queue routes, plus
  `/logs/stream` for NDJSON log streaming.
- `LogStore` already persists structured log rows and can filter by group,
  process, or queue annotations.
- The author API should accept the actual browser-safe group/process/queue
  definition, not `{ kind, id }` wrappers or separate `group=` / `process=` /
  `queue=` props.
- The existing browser split doc already tells React consumers to import
  `*.tags.ts` modules for `typeof Notify`, `typeof EmailQueue`,
  `typeof ProdGroup`, ids, and `ProdGroup.contract`, while keeping runtime
  layers and `ControlService` in Node-only modules.

## Locked ingredients

- The first dashboard product surface is only `Controls` and `Logs`.
- Components use one prop, `for`, with the actual group/process/queue target.
- `for={...}` is preferred over `target={...}` unless TSX typing proves awkward.
- `for={...}` accepts only browser-safe tag/definition declarations that carry
  static `id` and `kind` metadata; runtime layers and arbitrary `{ id: string }`
  objects are rejected.
- React examples import from `*.tags.ts`, never from `*.runtime.ts`.
- Styling and table layout come after the headless contracts work.
- Public React API changes need a changeset before release.

## Code picture

```tsx
<Controls for={BillingGroup} />
<Controls for={BillingSyncProcess} />
<Controls for={EmailQueue} />

<Logs for={BillingGroup} />
<Logs for={BillingSyncProcess} />
<Logs for={EmailQueue} />
```

## Open recipe steps

1. Target type contract: which existing group/process/queue shapes should
   `Controls` and `Logs` accept, and what metadata must be available in browser
   bundles?
2. Log port contract: history, live stream, or history-plus-live from the first
   version?
3. Controls behavior: group-level controls render all known process and queue
   controls, while process/queue targets render only the matching controls.
4. Demo acceptance: dashboard demo renders controls and logs through the
   existing `/api/control` gateway.

## Recipe step: target type contract (locked)

What this decides:
Which real effect-pm definitions are valid values for the `for` prop, and how
the React layer derives ids without importing runtime layers into the browser.

Recommended ingredients:

- `for` accepts browser-safe definitions/tags only — keeps JSX ergonomic while
  preserving the existing runtime-vs-tags split.
- Target narrowing is structural and explicit — the component can distinguish
  process, queue, and group definitions without asking authors for a second
  discriminator prop.
- Runtime layers stay server-only — `Controls` and `Logs` only need ids,
  contract metadata, and the injected `ControlPlanePort`.

Picture:

```tsx
type DashboardTarget =
  | BrowserSafeProcessGroupDefinition
  | BrowserSafeProcessDefinition
  | BrowserSafeQueueDefinition;

type ControlsProps = {
  readonly for: DashboardTarget;
};

export const Controls = (props: ControlsProps) => {
  const target = props.for;
  // Derive target id/type from the definition; call ControlPlanePort for data.
};
```

Alternatives:

1. `target={...}` — avoids keyword discomfort, but is less aligned with the
   existing `Store.for(...)` language and reads less naturally in JSX.
2. `group=` / `process=` / `queue=` — easy to type, but makes authors choose the
   slot manually and duplicates information already present on the definition.
3. `{ kind, id }` wrappers — simple internally, but this was rejected because it
   is not the desired component authoring model.

Question:
Should the target contract accept only existing browser-safe definitions/tags
that expose enough static id/type metadata, with `for={...}` as the only author
prop?

Recommended answer:
Yes. It matches the desired JSX, respects the browser-safe tag/runtime split,
and leaves room for styled wrappers later without changing the author API.

Acceptance check:
Type examples compile for `Controls for={BillingGroup}`,
`Controls for={BillingSyncProcess}`, and `Controls for={EmailQueue}`, while an
attempt to pass a runtime layer or arbitrary `{ id: string }` object fails.

Decision:
Accepted. The public author API is `for={ActualTagOrDefinition}` and the
implementation must protect browser bundles from runtime modules.

## Recipe step: log port contract (locked)

What this decides:
How the React control port exposes logs without splitting author-facing history
and live-follow concerns across separate methods.

Recommended ingredients:

- `ControlPlanePort.logs(params)` - one logs surface for history, date ranges,
  and live follow.
- `params.for` uses the same browser-safe target contract as `Controls` and
  `Logs`.
- `params.lines` requests a bounded recent tail for normal operator views.
- `params.from` / `params.to` request older history or bounded ranges when
  durable history is available.
- `params.follow` defaults to `true`; logs are live unless the caller explicitly
  asks for a static snapshot.
- Filters derive from the same `for` target - group target includes group logs,
  process target filters `processId`, queue target filters `queueId`.

Picture:

```tsx
<Logs for={BillingGroup} lines={200} />
<Logs for={BillingSyncProcess} lines={100} />
<Logs for={EmailQueue} from={start} to={end} follow={false} />
```

```ts
type ControlPlaneLogsParams<Target extends DashboardTarget> = {
  readonly for: Target;
  readonly lines?: number;
  readonly from?: Date;
  readonly to?: Date;
  readonly follow?: boolean; // default true
};

interface ControlPlanePort {
  readonly logs: (params: ControlPlaneLogsParams<DashboardTarget>) => ControlPlaneLogs;
}
```

Alternatives:

1. Separate `getLogs` and `streamLogs` - explicit internally, but pushes transport
   shape into the public React API and makes components coordinate two calls.
2. History only - easy to test and works through plain JSON, but violates the
   operator expectation that logs follow by default.
3. Live stream only - matches `/logs/stream` today, but reconnects and older
   history need date/limit context.
4. Push logs through `getStatus` polling - simple adapter shape, but mixes logs
   into the control status payload and wastes bandwidth.

Question:
Should logs be one `ControlPlanePort.logs(params)` surface, with `lines` / date
range history parameters and `follow: true` by default?

Recommended answer:
Yes. It gives React one conceptual logs operation while still letting adapters
choose whether they satisfy it via relay tail, durable history, live NDJSON, or
a combined backend endpoint.

Acceptance check:
The dashboard demo can render `Logs for={DemoGroup}`, show the initial tail,
append new process/queue log lines by default, and support a static date/line
range when `follow={false}` is passed.

Decision:
Accepted. The public port has one logs operation with history parameters and
live follow enabled by default.

## Recipe step: safe target declarations

What this decides:
How app authors define process, queue, and group values so React can import them
without pulling runtime layers or server-only dependencies into browser bundles.

Recommended ingredients:

- `*.tags.ts` exports the actual `Process.Service`, `QueueResource.Service`, and
  `ProcessGroup.Service` declarations used by `for={...}`.
- `*.tags.ts` imports effect-pm symbols through dedicated subpaths, not the root
  barrel, so browser bundles do not see server-oriented exports.
- `*.runtime.ts` imports the tags and composes `.layer`, storage, child launcher,
  `ControlService`, and other Node-only wiring.
- React imports only from `*.tags.ts` and talks to the runtime through
  `ControlPlanePort` / same-origin gateway.
- Code review rule: any module imported by React must not import
  `ControlService`, storage adapters, `Layer.mergeAll`, SQLite/Prisma runtime,
  secrets, or server-only platform packages.

Picture:

```ts
// billing.tags.ts - browser-safe
import { Effect } from "effect";
import { Process } from "@nikscripts/effect-pm/Process";
import { ProcessGroup } from "@nikscripts/effect-pm/ProcessGroup";
import { QueueResource } from "@nikscripts/effect-pm/QueueResource";

export class BillingSync extends Process.Service<BillingSync>()(
  "@app/BillingSync",
  { effect: Effect.void },
) {}

export class EmailQueue extends QueueResource.Service<EmailQueue, Email>()(
  "@app/EmailQueue",
  { effect: () => Effect.void, concurrency: 1 },
) {}

export class BillingGroup extends ProcessGroup.Service<BillingGroup>()(
  "@app/BillingGroup",
  [BillingSync, EmailQueue] as const,
) {}
```

```ts
// billing.runtime.ts - server-only
import { ControlService } from "@nikscripts/effect-pm/ControlService";
import { BillingGroup, BillingSync, EmailQueue } from "./billing.tags";

const layer = Layer.mergeAll(
  BillingSync.layer,
  EmailQueue.layer,
  ControlService.layerHttp(BillingGroup),
);
```

```tsx
// Ops.tsx - browser
import { BillingGroup, BillingSync, EmailQueue } from "./billing.tags";

<Controls for={BillingGroup} />
<Logs for={BillingSync} />
<Controls for={EmailQueue} />
```

Alternatives:

1. One `billing.ts` module for tags and runtime - fewer files, but browser
   bundlers can chase server-only imports.
2. Plain JSON descriptors - bundle-safe, but loses the actual effect-pm
   declarations and duplicates ids/contracts.
3. Type-only imports in React - avoids some bundling, but components need runtime
   `id`/`kind` values, so type-only imports are insufficient.

Question:
Should examples and docs standardize on `*.tags.ts` as the only module React may
import for `for={...}` targets, with runtime composition isolated in
`*.runtime.ts`?

Recommended answer:
Yes. This is already the documented split and it directly protects agents from
importing the wrong server-only modules into browser code.

Acceptance check:
A demo/client file imports targets from `demo.tags.ts`; the runtime file imports
those same tags and composes layers plus `ControlService`; no React-imported file
imports runtime wiring.

Decision:
Accepted. Browser-safe tags files use dedicated effect-pm subpath imports and
runtime composition stays in `*.runtime.ts`.

## Cleanup status

Temporary recipe. Remove it when the design is implemented or moved into durable
guide/API docs.
