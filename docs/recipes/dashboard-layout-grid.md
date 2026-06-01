# Dashboard layout grid recipe

## Goal

Design the next dashboard layout system around a resizable widget grid plus fixed
widget bars, without regressing the current controls/logs/status-table product
surface.

## Non-goals

- No drag-and-drop implementation in the first layout slice.
- No Apple-style widget registry yet.
- No ProcessStore historical chart widgets until the telemetry/projection branch
  lands.
- No terminal/console implementation until the authenticated console transport is
  ready.

## Mise en place findings

- Current branch ships headless `Controls`, `Logs`, `ControlPlanePort.logs`, and
  styled `OperatorDashboard` with status tables, terminal logs, icon actions, and
  a log toolbar.
- `src/ops-ui` is the correct home for layout, styling, and widget composition;
  `src/react` stays headless and must not import ops-ui.
- Existing dashboard plan still describes simple phases; this recipe supersedes
  the "sections only" idea for layout planning.
- The telemetry branch `origin/cursor/facet-telemetry-158c` is moving toward
  telemetry-first `ProcessStore` facets and `State.Scope` / `RuntimeEmitContext`
  so future widgets will consume projections and historical data, not only live
  control-plane status.
- Future bars should behave like VS Code activity/panel areas: fixed position,
  hideable, and populated by widgets, while the main dashboard grid scrolls.

## Locked ingredients

- First layout model is a resizable widget grid, not ordered sections.
- Top toolbar is a special non-grid region.
- Sidebars and bottom bars are fixed widget areas; they do not scroll with the
  main dashboard grid.
- Widgets placed directly in bars should fill the bar area without rounded card
  borders; if a bar uses split view, inner widgets regain borders/radius.
- `GroupConsole` / terminal remains a future widget primitive, not part of the
  first layout implementation.
- ProcessStore historical/projection widgets are future data-plane widgets that
  should plug into the same layout model after telemetry lands.

## Code picture

```tsx
<OperatorDashboard
  for={BillingGroup}
  layout={{
    toolbar: ["group-title", "edit-toggle", "connection-status"],
    grid: [
      { id: "status", widget: "status-table", x: 0, y: 0, w: 8, h: 4 },
      { id: "logs", widget: "logs", x: 8, y: 0, w: 4, h: 8 },
    ],
    bars: {
      left: { hidden: false, widgets: [{ id: "nav", widget: "target-tree" }] },
      bottom: { hidden: false, widgets: [{ id: "combined-logs", widget: "logs" }] },
    },
  }}
/>
```

## Open recipe steps

1. Layout state shape: controlled/uncontrolled props, persistence, and migration
   strategy.
2. Grid engine choice: CSS grid with resize handles first vs a dedicated layout
   library later.
3. Bar semantics: fixed widget areas, split view behavior, and default widgets.
4. Widget contract: minimal widget descriptors before a registry exists.
5. Acceptance evidence: demo layout interactions and persistence.

## Recipe step: layout state shape (locked)

What this decides:
How `OperatorDashboard` accepts and persists layout without committing to the
future full widget registry or drag-and-drop engine.

Recommended ingredients:

- `layout` prop for controlled defaults — lets apps seed the dashboard from code
  or user settings.
- `layoutStorageKey` prop for uncontrolled local persistence — keeps the demo and
  simple apps useful without a backend.
- `onLayoutChange` callback — lets WOW/authenticated apps persist per-user layout
  later.
- `grid` and `bars` in one layout object — keeps fixed bars and scrollable grid
  coordinated without treating bars as special pages.
- Layout entries reference existing widget ids (`status-table`, `logs`,
  `controls`) first; ProcessStore projection widgets and console widgets can be
  added later.

Picture:

```ts
type DashboardLayout = {
  readonly version: 1;
  readonly grid: ReadonlyArray<GridWidgetPlacement>;
  readonly bars?: {
    readonly left?: DashboardBarLayout;
    readonly right?: DashboardBarLayout;
    readonly bottom?: DashboardBarLayout;
  };
};

type OperatorDashboardProps = {
  readonly layout?: DashboardLayout;
  readonly layoutStorageKey?: string;
  readonly onLayoutChange?: (layout: DashboardLayout) => void;
};
```

Alternatives:

1. Only `localStorage` — easy for demos, but awkward for authenticated per-user
   layout and migrations.
2. Only controlled layout — clean for app integration, but too much wiring for
   examples and local use.
3. Keep static sections — simplest, but conflicts with the desired resizing grid
   direction and future widget work.

Question:
Should the first layout API support both controlled layout (`layout` /
`onLayoutChange`) and optional local persistence (`layoutStorageKey`), using one
`DashboardLayout` object for grid plus fixed bars?

Recommended answer:
Yes. It gives us a small implementation path now while leaving room for WOW to
persist authenticated layouts and for ProcessStore/console widgets to join later.

Acceptance check:
The demo can resize or reorder at least two grid widgets, reload the page, and
restore layout from `localStorage`; an app can also pass a controlled layout and
observe `onLayoutChange` calls.

Decision:
Accepted. The first layout API supports controlled layout, `onLayoutChange`, and
optional `layoutStorageKey` local persistence with one `DashboardLayout` object
for grid plus fixed bars.

## Future planned widgets

- `combined-logs` — multi-group logs once the control/data gateway can aggregate
  groups.
- `group-console` — authenticated PTY/WebSocket console widget.
- `process-history` — ProcessStore execution history/projection widget after
  telemetry lands.
- `queue-history` — queue depth/completion projections after telemetry lands.

## Cleanup status

Temporary recipe. Remove it when the layout design ships or moves into durable
ops-ui docs.
