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

## Locked ingredients

- The first dashboard product surface is only `Controls` and `Logs`.
- Components use one prop, `for`, with the actual group/process/queue target.
- `for={...}` is preferred over `target={...}` unless TSX typing proves awkward.
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

## Recipe step: target type contract

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

## Cleanup status

Temporary recipe. Remove it when the design is implemented or moved into durable
guide/API docs.
