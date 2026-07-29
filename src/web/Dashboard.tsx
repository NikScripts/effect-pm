/**
 * @module web/Dashboard
 *
 * The batteries-included resource dashboard: point it at a reactive `runtime` (an
 * `Atom.runtime(layer)` over your tags — local engine or `Hyperlink.client` over http) and a
 * root `Group`, and it renders the responsive drill-down — a grid of WorkPool / Daemon /
 * subgroup cards, a detail view per HyperService (stats + chart + controls + logs), and a routed
 * fullscreen log viewer (`/Group/Hyperlink/logs`). Navigation is URL-backed (deep links +
 * back/forward) and animated with view transitions.
 *
 * Use `<Dashboard runtime group />` for the one-liner, or compose `DashboardView` with the
 * providers yourself (see the exports).
 *
 */
import * as React from "react";
import { Layer, Option } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, Plus, Trash2 } from "lucide-react";
import {
  type ApiTag,
  type DashboardRuntime,
  type GroupNode,
  type NodeRef,
  type DaemonTag,
  type QueueBundle,
  type QueueTag,
  isPriorityTag,
  isApiTag,
  isDaemonTag,
  isFleetHealthTag,
  isQueueTag,
  isGateTag,
  isShardMapTag,
  isTelemetryTag,
  leafByKey,
  leafTags,
  nodesOf,
  tagWireKey,
} from "../ui/data";
import * as Bundle from "../ui/Bundle";
import { fmtDayLabel, now, startOfWeekMillis } from "../ui/now";
import { RegistryProvider, useAtomValue } from "../ui/atom-react";
import * as Group from "../Group";
import { RuntimeProvider } from "./runtime";
import { ViewTransitionProvider, useViewTransition, useViewTransitionStyle } from "./useViewTransition";
import { Button } from "./components/ui/button";
import { base, Cell, ConfirmDialog, HealthBoard, NodeBar, NodeDetail, LockToggle, LogStream, WeekSchedule, WindowDialog, displayName, useScheduleEdit } from "./widgets";
import { isLeafTag, type LeafTag, type WidgetRegistry } from "../ui/widgetRegistry";
import * as Navigator from "../ui/Navigator";
import * as View from "../ui/View";
import { WidgetsProvider } from "../ui/widgetsContext";
import type { Widget } from "./widget-registry";
import { DebugConsole } from "./debug-console";
import * as UiDashboardViews from "../ui/DashboardViews";
import * as WebDashboardViews from "./DashboardViews";

/** Detail body — shell owns back/title (lock J). */
const ViewDetailScreen = (props: {
  readonly tag: LeafTag;
  readonly name?: string;
}): React.ReactElement => {
  const Match = View.useMatch();
  return <Match.Detail tag={props.tag} name={props.name} />;
};

/** Shell chrome for a detail route — back + title only; badges live in Detail skins. */
const DetailShell = (props: {
  readonly title: string;
  readonly onBack: () => void;
  readonly vtKey: string;
  readonly children: React.ReactNode;
  readonly className?: string;
}): React.ReactElement => {
  const vt = useViewTransitionStyle(props.vtKey);
  return (
    <div
      className={
        props.className ??
        "flex h-[100dvh] flex-col gap-3 overflow-hidden safe-area landscape:h-auto landscape:min-h-[100dvh] landscape:overflow-visible"
      }
      style={vt}
    >
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={props.onBack}>← back</Button>
        <strong className="flex-1 truncate text-base">{props.title}</strong>
      </div>
      {props.children}
    </div>
  );
};


/** Invisible: reads one node's node status and reports the keys of its **not-ready** resources, so the
 *  grid can float degraded members to the top. A child-level hook (not a `.map` over the node list)
 *  keeps a constant hook order even if a group gains/loses a node. */
const DegradedKeysProbe = (props: {
  readonly node: NodeRef;
  readonly onKeys: (id: string, keys: ReadonlyArray<string>) => void;
}): null => {
  const r = useAtomValue(Bundle.node(props.node).status);
  const s = AsyncResult.isSuccess(r) ? r.value : undefined;
  const keys = (s?.services ?? []).filter((x) => !x.ready).map((x) => x.key);
  const { onKeys, node } = props;
  const joined = keys.join("|");
  React.useEffect(() => {
    onKeys(node.id, joined === "" ? [] : joined.split("|"));
  }, [onKeys, node.id, joined]);
  return null;
};

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

/** Fullscreen logs page for a HyperService — its own route (`/…/Hyperlink/logs`). */
const LogsPage = (props: { readonly tag: QueueTag | DaemonTag; readonly onClose: () => void }): React.ReactElement => {
  const bundle = isDaemonTag(props.tag)
    ? Bundle.observe(props.tag)
    : Bundle.observe(props.tag);
  return <LogBox bundle={bundle} full onToggle={props.onClose} meta={<> · {displayName(props.tag.key)}</>} />;
};

const DAY_MS = 86_400_000;

/** Fullscreen weekly schedule view for a daemon — its own route (`/…/Daemon/schedule`): a 7-day
 *  calendar grid of the run windows. Week nav up top (top-right kept free); add / clear / lock in a
 *  bottom bar; tap a window to edit or delete it. */
const SchedulePage = (props: { readonly tag: DaemonTag; readonly onClose: () => void }): React.ReactElement => {
  const bundle = Bundle.observe(props.tag);
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
        description="Remove all run windows. The daemon disarms until new windows are added."
        confirmLabel="Clear"
        destructive
        onConfirm={clearAll}
      />
    </div>
  );
};

/** Queue detail route — shell owns back/title; badge + body in Detail skin; LogBox stays shell. */
const QueueDetail = (props: {
  readonly tag: QueueTag;
  readonly onBack: () => void;
  readonly onOpenLogs: () => void;
}): React.ReactElement => {
  const Match = View.useMatch();
  const bundle = Bundle.observe(props.tag);
  const statusR = useAtomValue(bundle.status);
  const s = AsyncResult.isSuccess(statusR) ? Option.getOrUndefined(statusR.value) : undefined;
  return (
    <DetailShell
      title={displayName(props.tag.key)}
      onBack={props.onBack}
      vtKey={`res-${props.tag.key}`}
    >
      <Match.Detail tag={props.tag} />
      <LogBox bundle={bundle} full={false} onToggle={props.onOpenLogs} meta={<> · phase {s?.phase ?? "?"}</>} />
    </DetailShell>
  );
};

/** Daemon detail route — shell owns back/title; badge + body in Detail skin; LogBox stays shell. */
const DaemonDetail = (props: {
  readonly tag: DaemonTag;
  readonly onBack: () => void;
  readonly onOpenLogs: () => void;
}): React.ReactElement => {
  const Match = View.useMatch();
  const bundle = Bundle.observe(props.tag);
  return (
    <DetailShell
      title={`⚙ ${displayName(props.tag.key)}`}
      onBack={props.onBack}
      vtKey={`res-${props.tag.key}`}
    >
      <Match.Detail tag={props.tag} />
      <LogBox bundle={bundle} full={false} onToggle={props.onOpenLogs} />
    </DetailShell>
  );
};

/** API detail route — shell owns back/title; badge + body in Detail skin. */
const ApiDetail = (props: { readonly tag: ApiTag; readonly onBack: () => void }): React.ReactElement => {
  const Match = View.useMatch();
  return (
    <DetailShell
      title={`🌐 ${displayName(props.tag.key)}`}
      onBack={props.onBack}
      vtKey={`res-${props.tag.key}`}
    >
      <Match.Detail tag={props.tag} />
    </DetailShell>
  );
};

/** The drill-down view (runtime comes from `RuntimeProvider` above). */
const DashboardInner = (props: {
  readonly group: GroupNode;
  readonly onOpenHealth: () => void;
}): React.ReactElement => {
  const nav = Navigator.useNavigator();
  const group = nav.group as GroupNode;
  const selected = nav.selected;
  const trail = nav.trail;
  const keys = nav.path;
  const transition = useViewTransition();
  const pageVt = useViewTransitionStyle(`grp-${group.key}`);
  // ── degraded-first sort state (hoisted above the detail early-return so hook order is constant
  //    whether a HyperService is selected or not — rules-of-hooks). Only read on the grid path below.
  const [degradedKeysByNode, setDegradedKeysByNode] = React.useState<
    ReadonlyMap<string, ReadonlyArray<string>>
  >(() => new Map());
  const reportDegradedKeys = React.useCallback((id: string, keys: ReadonlyArray<string>): void => {
    setDegradedKeysByNode((prev) => {
      const next = new Map(prev);
      next.set(id, keys);
      return next;
    });
  }, []);
  const degradedKeys = React.useMemo(
    () => new Set([...degradedKeysByNode.values()].flat()),
    [degradedKeysByNode],
  );
  const [degradedFirst, setDegradedFirst] = React.useState(false);

  if (selected !== null) {
    // the member key the selected leaf sits under — the display name the grid card used (mesh factory
    // tags share a generic key like "telemetry", so title off the member name, not the tag key).
    const selectedName = keys[trail.length - 1];
    const toGrid = (id: string) => () => transition(`res-${id}`, () => nav.back());
    const openLogs = (): void => transition("log-panel", () => nav.openKey("logs"));
    const closeLogs = (): void => transition("log-panel", () => nav.back());
    const closeSchedule = (): void => transition("schedule-panel", () => nav.back());
    if (nav.view === "logs") {
      if (isDaemonTag(selected) || isQueueTag(selected)) return <LogsPage tag={selected} onClose={closeLogs} />;
      return <></>;
    }
    if (nav.view === "schedule") {
      if (isDaemonTag(selected)) return <SchedulePage tag={selected} onClose={closeSchedule} />;
      return <></>;
    }
    if (isApiTag(selected)) return <ApiDetail tag={selected} onBack={toGrid(selected.key)} />;
    if (isDaemonTag(selected)) return <DaemonDetail tag={selected} onBack={toGrid(selected.key)} onOpenLogs={openLogs} />;
    if (isQueueTag(selected)) return <QueueDetail tag={selected} onBack={toGrid(selected.key)} onOpenLogs={openLogs} />;
    if (
      isPriorityTag(selected) ||
      isFleetHealthTag(selected) ||
      isTelemetryTag(selected) ||
      isShardMapTag(selected) ||
      isGateTag(selected)
    ) {
      return (
        <DetailShell
          title={selectedName ?? displayName(selected.key)}
          onBack={toGrid(selected.key)}
          vtKey={`res-${selected.key}`}
          className="safe-area flex flex-col gap-3"
        >
          <ViewDetailScreen tag={selected} name={selectedName} />
        </DetailShell>
      );
    }
    return <></>;
  }

  const canBack = trail.length > 1;
  // name each crumb by the member key it sits under in its parent (the root has no parent, so fall
  // back to its own key). `keys[i-1]` is the key for `trail[i]`.
  const title = trail
    .map((g, i) => (i === 0 ? displayName(g.key) : keys[i - 1] ?? displayName(g.key)))
    .join(" / ");
  // ── degraded-first sort ──────────────────────────────────────────────────
  // Hidden probes report each node's not-ready resource keys; when the toggle is on, members that are
  // (or contain) a degraded resource float to the top, stable otherwise. (State hoisted above.)
  const sortNodes = nodesOf(group);
  const memberDegraded = (member: unknown): boolean => {
    if (isLeafTag(member)) return degradedKeys.has(member.key);
    if (Group.isGroup(member)) {
      return leafTags(member).some((t) => {
        const k = tagWireKey(t);
        return k !== undefined && degradedKeys.has(k);
      });
    }
    return false;
  };
  const memberEntries = Object.entries(group.members);
  const orderedMembers = degradedFirst
    ? memberEntries
        .map((entry, i) => ({ entry, i }))
        .sort((a, b) => Number(memberDegraded(b.entry[1])) - Number(memberDegraded(a.entry[1])) || a.i - b.i)
        .map((x) => x.entry)
    : memberEntries;

  const countCircle = (
    /* resource count as a small circle, the number knocked out as negative space */
    <span
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-bold text-background"
      title={`${leafTags(group).length} resources`}
      aria-label={`${leafTags(group).length} resources`}
    >
      {leafTags(group).length}
    </span>
  );
  return (
    // trim the base top padding (keep the notch inset) — the freed space goes below the header.
    <div
      className="mx-auto max-w-5xl safe-area"
      style={{ ...pageVt, paddingTop: "max(0.25rem, env(safe-area-inset-top))" }}
    >
      <div className="relative mb-4 flex items-center gap-2">
        {canBack ? (
          <>
            <Button variant="outline" size="sm" onClick={() => transition(`grp-${group.key}`, () => nav.back())}>← back</Button>
            {/* centered to the row (≈ the screen), not the flex remainder — absolutely overlaid, taps
                pass through to the back/count/die around it. The ⬢ is dropped on drilled-in pages. */}
            <h1 className="pointer-events-none absolute inset-0 m-0 flex items-center justify-center truncate px-24 text-lg font-semibold">
              {title}
            </h1>
            <div className="flex-1" />
          </>
        ) : (
          <h1 className="m-0 flex-1 text-lg font-semibold">⬢ {title}</h1>
        )}
        {/* float degraded HyperServices up — offered only when something's actually degraded. */}
        {degradedKeys.size > 0 ? (
          <button
            type="button"
            onClick={() => transition("res-sort", () => setDegradedFirst((v) => !v))}
            aria-pressed={degradedFirst}
            title="float degraded HyperServices to the top"
            className={`shrink-0 rounded-full border px-2 py-0.5 text-[0.7rem] transition-colors ${
              degradedFirst ? "border-amber-500 text-amber-400" : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            degraded first
          </button>
        ) : null}
        {countCircle}
        {/* node-status die — all nodes the dashboard's HyperServices are bound to (the root group). */}
        <NodeBar group={props.group} onOpen={props.onOpenHealth} />
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
        {sortNodes.map((node) => (
          <DegradedKeysProbe key={`probe-${node.id}`} node={node} onKeys={reportDegradedKeys} />
        ))}
        {orderedMembers.map(([name, member]) => (
          <Cell
            key={name}
            name={name}
            member={member}
            onOpenLeaf={(tag) => transition(`res-${tag.key}`, () => nav.openKey(name))}
            onOpenGroup={() => transition(`grp-${name}`, () => nav.openKey(name))}
          />
        ))}
      </div>
      {/* the tap hint sits at the bottom, out of the way */}
      <div className="mt-6 pb-3 text-center text-sm text-muted-foreground">
        tap a HyperService for its detail · tap a group to open it
      </div>
    </div>
  );
};

/** A HyperService's detail opened **from a node** — rendered on the node axis (so "back" returns to the
 *  node, not the group), with logs/schedule as local sub-views. Reuses the same detail widgets the
 *  group route uses. */
const NodeHyperlinkView = (props: {
  readonly tag: unknown;
  readonly onBack: () => void;
}): React.ReactElement => {
  const [view, setView] = React.useState<"main" | "logs" | "schedule">("main");
  const { tag } = props;
  if (view === "logs" && (isDaemonTag(tag) || isQueueTag(tag))) {
    return <LogsPage tag={tag} onClose={() => setView("main")} />;
  }
  if (view === "schedule" && isDaemonTag(tag)) {
    return <SchedulePage tag={tag} onClose={() => setView("main")} />;
  }
  if (isApiTag(tag)) return <ApiDetail tag={tag} onBack={props.onBack} />;
  if (isDaemonTag(tag)) {
    return (
      <DaemonDetail
        tag={tag}
        onBack={props.onBack}
        onOpenLogs={() => setView("logs")}
      />
    );
  }
  if (isQueueTag(tag)) {
    return <QueueDetail tag={tag} onBack={props.onBack} onOpenLogs={() => setView("logs")} />;
  }
  if (
    isPriorityTag(tag) ||
    isFleetHealthTag(tag) ||
    isTelemetryTag(tag) ||
    isShardMapTag(tag) ||
    isGateTag(tag)
  ) {
    return (
      <DetailShell
        title={displayName(tag.key)}
        onBack={props.onBack}
        vtKey={`res-${tag.key}`}
        className="safe-area flex flex-col gap-3 px-1"
      >
        <ViewDetailScreen tag={tag} />
      </DetailShell>
    );
  }
  return <></>;
};

/** The drill-down view + its runtime — compose with `RegistryProvider` + `ViewTransitionProvider`
 *  yourself, or use `<Dashboard>` which wires all three. The node-status die lives in the header
 *  (see `DashboardInner`); opening a node swaps in its full screen, and opening a HyperService from a
 *  node stays on the node axis so "back" returns there. */
export const DashboardView = <R, ER>(props: {
  readonly runtime: DashboardRuntime<R, ER>;
  readonly group: GroupNode;
  /**
   * App View contributions (`R = View.Registry`). Prefer
   * `View.only(Tag, Card).pipe(Layer.provide(View.provide(Card, Comp)))`.
   * Merged with shipped family contributions, then skins + {@link View.base}.
   */
  readonly views?: Layer.Layer<never, never, View.Registry>;
}): React.ReactElement => {
  // Three stacked overlays over the group view, in back-pop order: a HyperService opened from a node/board
  // (`nodeTag`) sits over a node's full screen (`node`), which sits over the health board (`health`).
  // Keeping them separate means "back" pops one layer at a time — resource → node → board → dashboard.
  const [health, setHealth] = React.useState(false);
  const [node, setNode] = React.useState<NodeRef | null>(null);
  const [nodeTag, setNodeTag] = React.useState<unknown>(null);
  const openHyperlink = React.useCallback(
    (serviceKey: string): void => {
      const found = leafByKey(props.group, serviceKey);
      if (found !== undefined) setNodeTag(found);
    },
    [props.group],
  );
  // compose = contributions (+ app views) → skins → View.base; Navigator.history for short-name paths.
  const ui = React.useMemo(
    () =>
      View.compose({
        views: Layer.mergeAll(
          UiDashboardViews.layer,
          props.views ?? Layer.empty,
        ).pipe(
          Layer.provideMerge(WebDashboardViews.skins),
          Layer.provideMerge(View.base),
        ),
        navigator: Navigator.history(props.group),
      }),
    [props.group, props.views],
  );
  // The dashboard owns its font: declaring `font-mono` on its own root means the widgets render
  // monospace regardless of the consumer's `body`/`#root` font (a value set directly on this
  // element wins over an inherited one), and it still honours a consumer-defined `--font-mono`.
  return (
    <ui.Provider>
      <RuntimeProvider runtime={props.runtime}>
        <div className="font-mono">
          {nodeTag !== null ? (
            <NodeHyperlinkView tag={nodeTag} onBack={() => setNodeTag(null)} />
          ) : node !== null ? (
            <NodeDetail node={node} onBack={() => setNode(null)} onOpenHyperlink={openHyperlink} />
          ) : health ? (
            <HealthBoard
              group={props.group}
              onBack={() => setHealth(false)}
              onOpenNode={setNode}
              onOpenHyperlink={openHyperlink}
            />
          ) : (
            <DashboardInner group={props.group} onOpenHealth={() => setHealth(true)} />
          )}
        </div>
      </RuntimeProvider>
    </ui.Provider>
  );
};

/** Batteries-included dashboard: providers + the responsive view + the (opt-in) debug console.
 *  `<Dashboard runtime={Atom.runtime(layer)} group={ServicesHub} views={appViews} />`. */
export const Dashboard = <R, ER>(props: {
  readonly runtime: DashboardRuntime<R, ER>;
  readonly group: GroupNode;
  /** App View contributions — see {@link DashboardView} `views`. */
  readonly views?: Layer.Layer<never, never, View.Registry>;
  /** Legacy widget registry fallback only. Prefer {@link views}. */
  readonly widgets?: WidgetRegistry<Widget>;
}): React.ReactElement => (
  <RegistryProvider>
    <WidgetsProvider registry={props.widgets ?? base}>
      <ViewTransitionProvider>
        <DashboardView
          runtime={props.runtime}
          group={props.group}
          views={props.views}
        />
        <DebugConsole />
      </ViewTransitionProvider>
    </WidgetsProvider>
  </RegistryProvider>
);
