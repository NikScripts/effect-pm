/**
 * @module examples/web-dashboard/mobile
 *
 * Touch-first drill-down: a grid of queue / process / subgroup widgets; tap a group to
 * open it, tap a resource for its detail. Tag-driven — the tree is the `Fleet` group tag;
 * each leaf is dispatched to its own widget by `kindOf`.
 */

import * as React from "react";
import { AsyncResult } from "effect/unstable/reactivity";
import { Fleet } from "./fleet";
import {
  type LeafTag,
  type ProcessTag,
  type QueueBundle,
  kindOf,
  leafTags,
  processBundle,
  queueBundle,
} from "./queue-data";
import { useAtomValue } from "../../src/ui/atom-react";
import { useViewTransition, useViewTransitionStyle } from "../../src/web/useViewTransition";
import { useGroupRoute } from "../../src/web/useGroupRoute";
import { Maximize2, Minimize2 } from "lucide-react";

import { Boundary } from "./components/ui/boundary";
import { Button } from "./components/ui/button";
import {
  Cell,
  LogStream,
  MetricChart,
  ProcessControls,
  ProcessStats,
  QueueControls,
  QueueStats,
  StatusBadge,
  displayName,
} from "./widgets";

// route.selected is an opaque leaf tag — narrow it to a queue / process by its contract.
const isProcessTag = (m: unknown): m is ProcessTag => kindOf(m) === "process";
const isQueueTag = (m: unknown): m is LeafTag => kindOf(m) === "queue";

/** The log box — one named element ("log-panel") shared by the inline detail panel and the
 *  fullscreen logs page, so navigating between them morphs it via a view transition (the
 *  detail's other elements fade out, since the logs page is a separate route). */
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

/** Fullscreen logs page for a resource — its own route (`/…/Resource/logs`). Minimizing
 *  navigates back to the detail, morphing the shared log box back into place. */
const LogsPage = (props: {
  readonly tag: LeafTag | ProcessTag;
  readonly onClose: () => void;
}): React.ReactElement => {
  const bundle = isProcessTag(props.tag) ? processBundle(props.tag) : queueBundle(props.tag);
  return <LogBox bundle={bundle} full onToggle={props.onClose} meta={<> · {displayName(props.tag.id)}</>} />;
};

const QueueDetail = (props: {
  readonly tag: LeafTag;
  readonly onBack: () => void;
  readonly onOpenLogs: () => void;
}): React.ReactElement => {
  const bundle = queueBundle(props.tag);
  const statusR = useAtomValue(bundle.status);
  const s = AsyncResult.isSuccess(statusR) ? statusR.value : undefined;
  const vt = useViewTransitionStyle(`res-${props.tag.id}`);
  return (
    <div className="flex h-[100dvh] flex-col gap-3 overflow-hidden safe-area landscape:h-auto landscape:min-h-[100dvh] landscape:overflow-visible" style={vt}>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={props.onBack}>← back</Button>
        <strong className="flex-1 truncate text-base">{displayName(props.tag.id)}</strong>
        <StatusBadge phase={s?.phase ?? "running"} paused={s?.paused ?? false} />
      </div>
      <Boundary label="stats"><QueueStats bundle={bundle} /></Boundary>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 sm:flex-1">
          <Boundary label="chart">
            <div className="rounded-xl border bg-card p-3"><MetricChart bundle={bundle} /></div>
          </Boundary>
        </div>
        <Boundary label="controls"><QueueControls bundle={bundle} /></Boundary>
      </div>
      <LogBox bundle={bundle} full={false} onToggle={props.onOpenLogs} meta={<> · phase {s?.phase ?? "?"}</>} />
    </div>
  );
};

const ProcessDetail = (props: {
  readonly tag: ProcessTag;
  readonly onBack: () => void;
  readonly onOpenLogs: () => void;
}): React.ReactElement => {
  const bundle = processBundle(props.tag);
  const vt = useViewTransitionStyle(`res-${props.tag.id}`);
  return (
    <div className="flex h-[100dvh] flex-col gap-3 overflow-hidden safe-area landscape:h-auto landscape:min-h-[100dvh] landscape:overflow-visible" style={vt}>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={props.onBack}>← back</Button>
        <strong className="flex-1 truncate text-base">⚙ {displayName(props.tag.id)}</strong>
      </div>
      <Boundary label="stats"><ProcessStats bundle={bundle} /></Boundary>
      <Boundary label="controls"><ProcessControls bundle={bundle} /></Boundary>
      <LogBox bundle={bundle} full={false} onToggle={props.onOpenLogs} />
    </div>
  );
};

export const MobileDashboard = (): React.ReactElement => {
  // URL ↔ nav over the Fleet tree (/Wnba/ImportSchedule, case-insensitive; back/forward work).
  const route = useGroupRoute(Fleet);
  const { group, selected, trail } = route;
  // animate grid ↔ detail / drill-down via the View Transitions API: the activated card
  // morphs to fill the screen while everything else grows/fades in as one image.
  const transition = useViewTransition();
  const pageVt = useViewTransitionStyle(`grp-${group.id}`);

  if (selected !== null) {
    const toGrid = (id: string) => () => transition(`res-${id}`, () => route.back());
    const openLogs = (): void => transition("log-panel", () => route.open("logs"));
    const closeLogs = (): void => transition("log-panel", () => route.back());
    // /…/Resource/logs → the fullscreen logs page (its own route)
    if (route.view === "logs") {
      if (isProcessTag(selected) || isQueueTag(selected)) return <LogsPage tag={selected} onClose={closeLogs} />;
      return <></>;
    }
    if (isProcessTag(selected)) return <ProcessDetail tag={selected} onBack={toGrid(selected.id)} onOpenLogs={openLogs} />;
    if (isQueueTag(selected)) return <QueueDetail tag={selected} onBack={toGrid(selected.id)} onOpenLogs={openLogs} />;
    return <></>;
  }

  const canBack = trail.length > 1;

  return (
    <div className="mx-auto max-w-5xl safe-area" style={pageVt}>
      <div className="mb-1 flex items-center gap-2">
        {canBack ? (
          <Button variant="outline" size="sm" onClick={() => transition(`grp-${group.id}`, () => route.back())}>← back</Button>
        ) : null}
        <h1 className="m-0 flex-1 text-lg font-semibold">
          ⬢ {trail.map((g) => displayName(g.id)).join(" / ")}{" "}
          <span className="text-sm font-normal text-muted-foreground">· {leafTags(group).length} resources</span>
        </h1>
      </div>
      <div className="mb-2 text-sm text-muted-foreground">tap a resource for its detail · tap a group to open it</div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
        {Object.entries(group.members).map(([name, member]) => (
          <Cell
            key={name}
            member={member}
            onOpenLeaf={(tag) => transition(`res-${tag.id}`, () => route.open(name))}
            onOpenGroup={(g) => transition(`grp-${g.id}`, () => route.open(name))}
          />
        ))}
      </div>
    </div>
  );
};
