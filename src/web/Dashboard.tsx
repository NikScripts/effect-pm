/**
 * @module web/Dashboard
 *
 * The batteries-included resource dashboard: point it at a reactive `runtime` (an
 * `Atom.runtime(layer)` over your tags — local engine or `Resource.client` over http) and a
 * root `Group`, and it renders the responsive drill-down — a grid of queue / process /
 * subgroup cards, a detail view per resource (stats + chart + controls + logs), and a routed
 * fullscreen log viewer (`/Group/Resource/logs`). Navigation is URL-backed (deep links +
 * back/forward) and animated with view transitions.
 *
 * Use `<Dashboard runtime group />` for the one-liner, or compose `DashboardView` with the
 * providers yourself (see the exports).
 *
 * @since 1.0.0
 */
import * as React from "react";
import { AsyncResult } from "effect/unstable/reactivity";
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, Plus, Trash2 } from "lucide-react";
import {
  type ApiTag,
  type DashboardRuntime,
  type GroupNode,
  type HostRef,
  type ProcessTag,
  type QueueBundle,
  type QueueTag,
  kindOf,
  leafTags,
  processBundle,
  queueBundle,
} from "./data";
import { RegistryProvider, useAtomValue } from "../ui/atom-react";
import { RuntimeProvider, useApiBundle, useProcessBundle, useQueueBundle, useRuntime } from "./runtime";
import { ViewTransitionProvider, useViewTransition, useViewTransitionStyle } from "./useViewTransition";
import { useGroupRoute } from "./useGroupRoute";
import { Button } from "./components/ui/button";
import { ApiEndpointTable, ApiMetricChart, ApiStats, Cell, ConfirmDialog, HostBar, HostDetail, LockToggle, LogStream, MetricChart, ProcessControls, ProcessStats, QueueControls, QueueStats, ScheduleEditor, StatusBadge, WeekSchedule, WindowDialog, displayName, useScheduleEdit } from "./widgets";
import { fmtDayLabel, now, startOfWeekMillis } from "./now";
import { DebugConsole } from "./debug-console";

// route.selected is an opaque leaf tag — narrow it to a queue / process / api by its contract.
const isProcessTag = (m: unknown): m is ProcessTag => kindOf(m) === "process";
const isQueueTag = (m: unknown): m is QueueTag => kindOf(m) === "queue";
const isApiTag = (m: unknown): m is ApiTag => kindOf(m) === "api";

/** The log box — one named element ("log-panel") shared by the inline detail panel and the
 *  fullscreen logs page, so navigating between them morphs it via a view transition. */
const LogBox = (props: {
  readonly bundle: { readonly logs: QueueBundle["logs"] };
  readonly full: boolean;
  readonly onToggle: () => void;
  readonly meta?: React.ReactNode;
}): React.ReactElement => {
  const vt = useViewTransitionStyle("log-panel");
  return (
    <div
      style={vt}
      className={
        props.full
          ? "fixed inset-0 z-50 flex flex-col gap-2 bg-background p-2 safe-area"
          : "flex min-h-0 flex-1 flex-col gap-1 landscape:min-h-[200px] landscape:max-h-[45dvh]"
      }
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>
          LOGS <span className="text-[#22c55e]">live</span>
          {props.meta}
        </span>
        <button
          type="button"
          onClick={props.onToggle}
          className="ml-auto rounded p-1 hover:bg-accent"
          title={props.full ? "exit fullscreen" : "fullscreen logs"}
          aria-label={props.full ? "exit fullscreen logs" : "fullscreen logs"}
        >
          {props.full ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </button>
      </div>
      <LogStream bundle={props.bundle} className="min-h-0 flex-1 rounded-md border bg-card py-1" />
    </div>
  );
};

/** Fullscreen logs page for a resource — its own route (`/…/Resource/logs`). */
const LogsPage = (props: { readonly tag: QueueTag | ProcessTag; readonly onClose: () => void }): React.ReactElement => {
  const runtime = useRuntime();
  const bundle = isProcessTag(props.tag) ? processBundle(runtime, props.tag) : queueBundle(runtime, props.tag);
  return <LogBox bundle={bundle} full onToggle={props.onClose} meta={<> · {displayName(props.tag.key)}</>} />;
};

const DAY_MS = 86_400_000;

/** Fullscreen weekly schedule view for a process — its own route (`/…/Process/schedule`): a 7-day
 *  calendar grid of the run windows. Week nav up top (top-right kept free); add / clear / lock in a
 *  bottom bar; tap a window to edit or delete it. */
const SchedulePage = (props: { readonly tag: ProcessTag; readonly onClose: () => void }): React.ReactElement => {
  const bundle = useProcessBundle(props.tag);
  const { list, addEntry, update, remove, clearAll } = useScheduleEdit(bundle);
  const [weekStart, setWeekStart] = React.useState(() => startOfWeekMillis(now()));
  const [editing, setEditing] = React.useState<number | "new" | undefined>(undefined);
  const [confirmClear, setConfirmClear] = React.useState(false);
  const [locked, setLocked] = React.useState(true);
  const vt = useViewTransitionStyle("schedule-panel");
  const thisWeek = startOfWeekMillis(now());
  const initialEntry = typeof editing === "number" ? list[editing] : undefined;
  return (
    <div style={vt} className="fixed inset-0 z-50 flex flex-col gap-2 bg-background p-2 safe-area">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={props.onClose}>← back</Button>
        <strong className="flex-1 truncate text-base">Schedule</strong>
        {/* top-right intentionally free */}
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => setWeekStart((w) => w - 7 * DAY_MS)} aria-label="previous week">
          <ChevronLeft className="size-4" />
        </Button>
        <button type="button" onClick={() => setWeekStart(thisWeek)} className="flex-1 text-center leading-tight">
          <div className="text-sm font-semibold">Week of {fmtDayLabel(weekStart)}</div>
          <div className="text-xs text-muted-foreground">{weekStart === thisWeek ? "This week" : "Jump to this week"}</div>
        </button>
        <Button variant="ghost" size="icon" onClick={() => setWeekStart((w) => w + 7 * DAY_MS)} aria-label="next week">
          <ChevronRight className="size-4" />
        </Button>
      </div>
      <WeekSchedule
        entries={list}
        weekStart={weekStart}
        onSelectEntry={locked ? undefined : (i) => setEditing(i)}
      />
      <div className="flex items-center justify-center gap-2 border-t pt-2">
        <Button variant="outline" size="sm" onClick={() => setEditing("new")} disabled={locked}>
          <Plus className="size-4" /> add
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setConfirmClear(true)} disabled={locked || list.length === 0}>
          <Trash2 className="size-4" /> clear
        </Button>
        <LockToggle locked={locked} onToggle={() => setLocked((l) => !l)} />
      </div>
      <WindowDialog
        open={editing !== undefined}
        onOpenChange={(open) => {
          if (!open) setEditing(undefined);
        }}
        initial={initialEntry}
        onSubmit={(entry) => {
          if (editing === "new") addEntry(entry);
          else if (typeof editing === "number") update(editing, entry);
        }}
        onDelete={typeof editing === "number" ? () => remove(editing) : undefined}
      />
      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Clear schedule?"
        description="Remove all run windows. The process disarms until new windows are added."
        confirmLabel="Clear"
        destructive
        onConfirm={clearAll}
      />
    </div>
  );
};

const QueueDetail = (props: {
  readonly tag: QueueTag;
  readonly onBack: () => void;
  readonly onOpenLogs: () => void;
}): React.ReactElement => {
  const bundle = useQueueBundle(props.tag);
  const statusR = useAtomValue(bundle.status);
  const s = AsyncResult.isSuccess(statusR) ? statusR.value : undefined;
  const vt = useViewTransitionStyle(`res-${props.tag.key}`);
  return (
    <div className="flex h-[100dvh] flex-col gap-3 overflow-hidden safe-area landscape:h-auto landscape:min-h-[100dvh] landscape:overflow-visible" style={vt}>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={props.onBack}>← back</Button>
        <strong className="flex-1 truncate text-base">{displayName(props.tag.key)}</strong>
        <StatusBadge phase={s?.phase ?? "running"} paused={s?.paused ?? false} />
      </div>
      <QueueStats bundle={bundle} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0 sm:flex-1">
          <div className="overflow-hidden rounded-xl border bg-card p-3"><MetricChart bundle={bundle} /></div>
        </div>
        <QueueControls bundle={bundle} />
      </div>
      <LogBox bundle={bundle} full={false} onToggle={props.onOpenLogs} meta={<> · phase {s?.phase ?? "?"}</>} />
    </div>
  );
};

const ProcessDetail = (props: {
  readonly tag: ProcessTag;
  readonly onBack: () => void;
  readonly onOpenLogs: () => void;
  readonly onOpenSchedule: () => void;
}): React.ReactElement => {
  const bundle = useProcessBundle(props.tag);
  const vt = useViewTransitionStyle(`res-${props.tag.key}`);
  // One lock for the whole process detail — guards both the controls and the schedule editor.
  const [locked, setLocked] = React.useState(true);
  return (
    <div className="flex h-[100dvh] flex-col gap-3 overflow-hidden safe-area landscape:h-auto landscape:min-h-[100dvh] landscape:overflow-visible" style={vt}>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={props.onBack}>← back</Button>
        <strong className="flex-1 truncate text-base">⚙ {displayName(props.tag.key)}</strong>
      </div>
      <ProcessStats bundle={bundle} />
      <ProcessControls bundle={bundle} locked={locked} onToggleLock={() => setLocked((l) => !l)} />
      <ScheduleEditor bundle={bundle} onOpenFull={props.onOpenSchedule} />
      <LogBox bundle={bundle} full={false} onToggle={props.onOpenLogs} />
    </div>
  );
};

/** Detail view for an API-metrics resource — stats + usage chart + endpoint table. Read-only: no
 *  controls, no logs (an `ApiMetrics` tap has neither). */
const ApiDetail = (props: { readonly tag: ApiTag; readonly onBack: () => void }): React.ReactElement => {
  const bundle = useApiBundle(props.tag);
  const vt = useViewTransitionStyle(`res-${props.tag.key}`);
  return (
    <div className="flex h-[100dvh] flex-col gap-3 overflow-hidden safe-area landscape:h-auto landscape:min-h-[100dvh] landscape:overflow-visible" style={vt}>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={props.onBack}>← back</Button>
        <strong className="flex-1 truncate text-base">🌐 {displayName(props.tag.key)}</strong>
      </div>
      <ApiStats bundle={bundle} />
      <div className="overflow-hidden rounded-xl border bg-card p-3"><ApiMetricChart bundle={bundle} /></div>
      <ApiEndpointTable bundle={bundle} />
    </div>
  );
};

/** The drill-down view (runtime comes from `RuntimeProvider` above). @since 1.0.0 */
const DashboardInner = (props: { readonly group: GroupNode }): React.ReactElement => {
  const route = useGroupRoute(props.group);
  const { group, selected, trail, keys } = route;
  const transition = useViewTransition();
  const pageVt = useViewTransitionStyle(`grp-${group.key}`);

  if (selected !== null) {
    const toGrid = (id: string) => () => transition(`res-${id}`, () => route.back());
    const openLogs = (): void => transition("log-panel", () => route.open("logs"));
    const closeLogs = (): void => transition("log-panel", () => route.back());
    const openSchedule = (): void => transition("schedule-panel", () => route.open("schedule"));
    const closeSchedule = (): void => transition("schedule-panel", () => route.back());
    if (route.view === "logs") {
      if (isProcessTag(selected) || isQueueTag(selected)) return <LogsPage tag={selected} onClose={closeLogs} />;
      return <></>;
    }
    if (route.view === "schedule") {
      if (isProcessTag(selected)) return <SchedulePage tag={selected} onClose={closeSchedule} />;
      return <></>;
    }
    if (isApiTag(selected)) return <ApiDetail tag={selected} onBack={toGrid(selected.key)} />;
    if (isProcessTag(selected)) return <ProcessDetail tag={selected} onBack={toGrid(selected.key)} onOpenLogs={openLogs} onOpenSchedule={openSchedule} />;
    if (isQueueTag(selected)) return <QueueDetail tag={selected} onBack={toGrid(selected.key)} onOpenLogs={openLogs} />;
    return <></>;
  }

  const canBack = trail.length > 1;
  return (
    <div className="mx-auto max-w-5xl safe-area" style={pageVt}>
      <div className="mb-1 flex items-center gap-2">
        {canBack ? (
          <Button variant="outline" size="sm" onClick={() => transition(`grp-${group.key}`, () => route.back())}>← back</Button>
        ) : null}
        <h1 className="m-0 flex-1 text-lg font-semibold">
          {/* group view: name each crumb by the member key it sits under in its parent (the root
              has no parent, so fall back to its own key). `keys[i-1]` is the key for `trail[i]`. */}
          ⬢ {trail.map((g, i) => (i === 0 ? displayName(g.key) : keys[i - 1] ?? displayName(g.key))).join(" / ")}{" "}
          <span className="text-sm font-normal text-muted-foreground">· {leafTags(group).length} resources</span>
        </h1>
      </div>
      <div className="mb-2 text-sm text-muted-foreground">tap a resource for its detail · tap a group to open it</div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
        {Object.entries(group.members).map(([name, member]) => (
          <Cell
            key={name}
            name={name}
            member={member}
            onOpenLeaf={(tag) => transition(`res-${tag.key}`, () => route.open(name))}
            onOpenGroup={(g) => transition(`grp-${g.key}`, () => route.open(name))}
          />
        ))}
      </div>
    </div>
  );
};

/** Host status dots (top-right) + the fullscreen host view they open. Hosts come straight off the
 *  tags (`hostsOf`), so this overlays the normal drill-down on its own axis. @since 1.0.0 */
const HostsLayer = (props: {
  readonly group: GroupNode;
  readonly children: React.ReactNode;
}): React.ReactElement => {
  const [host, setHost] = React.useState<HostRef | null>(null);
  if (host !== null) return <HostDetail host={host} onBack={() => setHost(null)} />;
  return (
    <>
      {props.children}
      <HostBar group={props.group} onOpenHost={setHost} />
    </>
  );
};

/** The drill-down view + its runtime — compose with `RegistryProvider` + `ViewTransitionProvider`
 *  yourself, or use `<Dashboard>` which wires all three. @since 1.0.0 */
export const DashboardView = <R, ER>(props: {
  readonly runtime: DashboardRuntime<R, ER>;
  readonly group: GroupNode;
}): React.ReactElement => (
  // The dashboard owns its font: declaring `font-mono` on its own root means the widgets render
  // monospace regardless of the consumer's `body`/`#root` font (a value set directly on this
  // element wins over an inherited one), and it still honours a consumer-defined `--font-mono`.
  <RuntimeProvider runtime={props.runtime}>
    <div className="font-mono">
      <HostsLayer group={props.group}>
        <DashboardInner group={props.group} />
      </HostsLayer>
    </div>
  </RuntimeProvider>
);

/** Batteries-included dashboard: providers + the responsive view + the (opt-in) debug console.
 *  `<Dashboard runtime={Atom.runtime(layer)} group={ServicesHub} />`. @since 1.0.0 */
export const Dashboard = <R, ER>(props: {
  readonly runtime: DashboardRuntime<R, ER>;
  readonly group: GroupNode;
}): React.ReactElement => (
  <RegistryProvider>
    <ViewTransitionProvider>
      <DashboardView runtime={props.runtime} group={props.group} />
      <DebugConsole />
    </ViewTransitionProvider>
  </RegistryProvider>
);
