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

## Recipe step: log port contract

What this decides:
Whether the first logs primitive should read a bounded history snapshot, stream
live logs, or combine both through one React hook.

Recommended ingredients:

- `ControlPlanePort.getLogs(target, query)` - returns a bounded, decoded history
  snapshot for initial render and reconnects.
- `ControlPlanePort.streamLogs(target, options)` - follows live NDJSON logs where
  the adapter supports it.
- `useControlPlaneLogs({ for: target, lines, follow })` - React owns lifecycle,
  cancellation, and append state; components stay Promise/stream based.
- `follow` defaults to `true`; logs are live unless the caller explicitly asks
  for a static snapshot.
- Filters derive from the same `for` target - group target includes group logs,
  process target filters `processId`, queue target filters `queueId`.

Picture:

```tsx
<Logs for={BillingGroup} lines={200} />
<Logs for={BillingSyncProcess} lines={100} />
<Logs for={EmailQueue} lines={100} />
```

```ts
type UseControlPlaneLogsOptions<Target extends DashboardTarget> = {
  readonly for: Target;
  readonly lines?: number;
  readonly follow?: boolean;
};
```

Alternatives:

1. History only - easiest to test and works through plain JSON, but feels stale
   for an operator console.
2. Live stream only - matches `/logs/stream` today, but reconnects cannot show
   older context unless the relay tail still has it.
3. Push logs through `getStatus` polling - simple adapter shape, but mixes logs
   into the control status payload and wastes bandwidth.

Question:
Should the first logs API be history-plus-live (`getLogs` for snapshot and
`streamLogs` for follow), even if the first implementation backs history with
the existing relay tail before durable query endpoints are added?

Recommended answer:
Yes. Operators need context plus live updates, and splitting snapshot from live
follow matches the backend model (`LogStore` history plus relay stream) without
making the UI polling-heavy.

Acceptance check:
The dashboard demo can render `Logs for={DemoGroup}`, show the initial tail,
append new process/queue log lines by default, and filter when passed a process
or queue tag.

Decision:
Accepted. Logs are history-plus-live, and live follow is the default behavior.

## Recipe step: safe target declarations

What this decides:
How app authors define process, queue, and group values so React can import them
without pulling runtime layers or server-only dependencies into browser bundles.

Recommended ingredients:

- `*.tags.ts` exports the actual `Process.Service`, `QueueResource.Service`, and
  `ProcessGroup.Service` declarations used by `for={...}`.
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

## Cleanup status

Temporary recipe. Remove it when the design is implemented or moved into durable
guide/API docs.
