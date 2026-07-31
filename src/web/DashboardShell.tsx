/**
 * @module web/DashboardShell
 *
 * Web batteries shell over {@link ../ui/View.compose} — Cell grid, Router `/health`
 * node-status pages, {@link ./DashboardTopBar.DashboardDetailChrome}, LogBox / schedule.
 * {@link ./Dashboard} is the public one-liner over compose + this shell.
 */
import * as React from "react";
import { AsyncResult } from "effect/unstable/reactivity";
import {
  type ApiTag,
  type GroupNode,
  type NodeRef,
  type DaemonTag,
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
import * as NodeView from "../ui/NodeView";
import * as WorkPoolView from "../ui/WorkPoolView";
import * as DaemonView from "../ui/DaemonView";
import * as Observe from "../Observe";
import { useAtomValue } from "../ui/atom-react";
import * as Group from "../Group";
import { useViewTransition, useViewTransitionStyle } from "./useViewTransition";
import { Cell, displayName } from "./widgets";
import { LogBox, LogsPage, SchedulePage } from "./resourcePages";
import { isLeafTag, type LeafTag } from "../ui/widgetRegistry";
import * as Router from "../ui/Router";
import * as View from "../ui/View";
import { DashboardDetailChrome, DashboardTopBar } from "./DashboardTopBar";
import { HealthBoard, NodeBar, NodeDetail } from "./NodeStatus";

/** Detail body — chrome owns back/title (lock J). */
const ViewDetailScreen = (props: {
  readonly tag: LeafTag;
  readonly name?: string;
}): React.ReactElement => {
  const Match = View.useMatch();
  return <Match.Detail tag={props.tag} name={props.name} />;
};


/** Invisible: reads one node's node status and reports the keys of its **not-ready** resources, so the
 *  grid can float degraded members to the top. A child-level hook (not a `.map` over the node list)
 *  keeps a constant hook order even if a group gains/loses a node. */
const DegradedKeysProbe = (props: {
  readonly node: NodeRef;
  readonly onKeys: (id: string, keys: ReadonlyArray<string>) => void;
}): null => {
  const r = useAtomValue(NodeView.use(props.node).status);
  const s = AsyncResult.isSuccess(r) ? r.value : undefined;
  const keys = (s?.services ?? []).filter((x) => !x.ready).map((x) => x.key);
  const { onKeys, node } = props;
  const joined = keys.join("|");
  React.useEffect(() => {
    onKeys(node.id, joined === "" ? [] : joined.split("|"));
  }, [onKeys, node.id, joined]);
  return null;
};

/** Queue detail route — shell owns back/title; badge + body in Detail skin; LogBox stays shell. */
const QueueDetail = (props: {
  readonly tag: QueueTag;
  readonly onBack: () => void;
  readonly onOpenLogs: () => void;
}): React.ReactElement => {
  const Match = View.useMatch();
  const bundle = Observe.use(props.tag, WorkPoolView.pack);
  const lifecycleR = useAtomValue(bundle.lifecycle);
  const lifecycleTag = AsyncResult.isSuccess(lifecycleR)
    ? lifecycleR.value._tag ?? "?"
    : "?";
  return (
    <DashboardDetailChrome
      title={displayName(props.tag.key)}
      onBack={props.onBack}
      vtKey={`res-${props.tag.key}`}
    >
      <Match.Detail tag={props.tag} />
      <LogBox bundle={bundle} full={false} onToggle={props.onOpenLogs} meta={<> · {lifecycleTag.toLowerCase()}</>} />
    </DashboardDetailChrome>
  );
};

/** Daemon detail route — shell owns back/title; badge + body in Detail skin; LogBox stays shell. */
const DaemonDetail = (props: {
  readonly tag: DaemonTag;
  readonly onBack: () => void;
  readonly onOpenLogs: () => void;
}): React.ReactElement => {
  const Match = View.useMatch();
  const bundle = Observe.use(props.tag, DaemonView.pack);
  return (
    <DashboardDetailChrome
      title={`⚙ ${displayName(props.tag.key)}`}
      onBack={props.onBack}
      vtKey={`res-${props.tag.key}`}
    >
      <Match.Detail tag={props.tag} />
      <LogBox bundle={bundle} full={false} onToggle={props.onOpenLogs} />
    </DashboardDetailChrome>
  );
};

/** API detail route — shell owns back/title; badge + body in Detail skin. */
const ApiDetail = (props: { readonly tag: ApiTag; readonly onBack: () => void }): React.ReactElement => {
  const Match = View.useMatch();
  return (
    <DashboardDetailChrome
      title={`🌐 ${displayName(props.tag.key)}`}
      onBack={props.onBack}
      vtKey={`res-${props.tag.key}`}
    >
      <Match.Detail tag={props.tag} />
    </DashboardDetailChrome>
  );
};

/** The drill-down view (runtime comes from `RuntimeProvider` above). */
const DashboardInner = (props: {
  readonly group: GroupNode;
  readonly onOpenHealth: () => void;
}): React.ReactElement => {
  const nav = Router.useRouter();
  const Match = View.useMatch();
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
    const toGrid = (id: string) => () => transition(`res-${id}`, () => nav.up());
    const openLogs = (): void => transition("log-panel", () => nav.openKey("logs"));
    if (nav.view === "logs" || nav.view === "schedule") {
      if (isDaemonTag(selected) || isQueueTag(selected)) {
        return <Match.Page tag={selected} />;
      }
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
        <DashboardDetailChrome
          title={selectedName ?? displayName(selected.key)}
          onBack={toGrid(selected.key)}
          vtKey={`res-${selected.key}`}
          className="safe-area flex flex-col gap-3"
        >
          <ViewDetailScreen tag={selected} name={selectedName} />
        </DashboardDetailChrome>
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
      <DashboardTopBar
        title={title}
        root={!canBack}
        onBack={
          canBack
            ? () => transition(`grp-${group.key}`, () => nav.up())
            : undefined
        }
        trailing={
          <>
            {/* float degraded HyperServices up — only when something's actually degraded. */}
            {degradedKeys.size > 0 ? (
              <button
                type="button"
                onClick={() => transition("res-sort", () => setDegradedFirst((v) => !v))}
                aria-pressed={degradedFirst}
                title="float degraded HyperServices to the top"
                className={`shrink-0 rounded-full border px-2 py-0.5 text-[0.7rem] transition-colors ${
                  degradedFirst
                    ? "border-amber-500 text-amber-400"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                degraded first
              </button>
            ) : null}
            {countCircle}
            {/* node-status die — nodes the dashboard's HyperServices are bound to. */}
            <NodeBar group={props.group} onOpen={props.onOpenHealth} />
          </>
        }
      />
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
      <DashboardDetailChrome
        title={displayName(tag.key)}
        onBack={props.onBack}
        vtKey={`res-${tag.key}`}
        className="safe-area flex flex-col gap-3 px-1"
      >
        <ViewDetailScreen tag={tag} />
      </DashboardDetailChrome>
    );
  }
  return <></>;
};


/**
 * Batteries shell: Router `/health` pages + group drill-down. Requires compose
 * {@link View} Provider + {@link ./runtime.RuntimeProvider} above.
 *
 * @public
 */
export const DashboardShell = (props: {
  readonly group: GroupNode;
}): React.ReactElement => {
  const nav = Router.useRouter();
  const [nodeTag, setNodeTag] = React.useState<unknown>(null);
  const openHyperlink = React.useCallback(
    (serviceKey: string): void => {
      const found = leafByKey(props.group, serviceKey);
      if (found !== undefined) setNodeTag(found);
    },
    [props.group],
  );

  if (nodeTag !== null) {
    return <NodeHyperlinkView tag={nodeTag} onBack={() => setNodeTag(null)} />;
  }

  if (nav.view === "health") {
    const nodeId = nav.path[0] === "health" ? nav.path[1] : undefined;
    if (nodeId !== undefined) {
      const node = nodesOf(props.group).find((n) => n.id === nodeId);
      if (node !== undefined) {
        return (
          <NodeDetail
            node={node}
            onBack={() => nav.up()}
            onOpenHyperlink={openHyperlink}
          />
        );
      }
    }
    return (
      <HealthBoard
        group={props.group}
        onBack={() => nav.up()}
        onOpenNode={(n) => nav.openNode(n.id)}
        onOpenHyperlink={openHyperlink}
      />
    );
  }

  return (
    <DashboardInner
      group={props.group}
      onOpenHealth={() => nav.openHealth()}
    />
  );
};
