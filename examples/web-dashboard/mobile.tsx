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
  kindOf,
  leafTags,
  processBundle,
  queueBundle,
} from "./queue-data";
import { useAtomValue } from "../../src/ui/atom-react";
import { useViewTransition, useViewTransitionStyle } from "../../src/web/useViewTransition";
import { useGroupRoute } from "../../src/web/useGroupRoute";

// route.selected is an opaque leaf tag — narrow it to a queue / process by its contract.
const isProcessTag = (m: unknown): m is ProcessTag => kindOf(m) === "process";
const isQueueTag = (m: unknown): m is LeafTag => kindOf(m) === "queue";
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

const QueueDetail = (props: { readonly tag: LeafTag; readonly onBack: () => void }): React.ReactElement => {
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
      <Boundary label="chart">
        <div className="rounded-xl border bg-card p-3"><MetricChart bundle={bundle} /></div>
      </Boundary>
      <Boundary label="controls"><QueueControls bundle={bundle} /></Boundary>
      <div className="text-xs text-muted-foreground">
        LOGS <span className="text-[#22c55e]">live</span> · phase {s?.phase ?? "?"}
      </div>
      <Boundary label="logs">
        <LogStream bundle={bundle} className="min-h-0 flex-1 rounded-md border bg-card py-1 landscape:min-h-[200px] landscape:max-h-[45dvh]" />
      </Boundary>
    </div>
  );
};

const ProcessDetail = (props: { readonly tag: ProcessTag; readonly onBack: () => void }): React.ReactElement => {
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
      <div className="text-xs text-muted-foreground">LOGS <span className="text-[#22c55e]">live</span></div>
      <Boundary label="logs">
        <LogStream bundle={bundle} className="min-h-0 flex-1 rounded-md border bg-card py-1 landscape:min-h-[200px] landscape:max-h-[45dvh]" />
      </Boundary>
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
    const back = (id: string) => () => transition(`res-${id}`, () => route.back());
    if (isProcessTag(selected)) return <ProcessDetail tag={selected} onBack={back(selected.id)} />;
    if (isQueueTag(selected)) return <QueueDetail tag={selected} onBack={back(selected.id)} />;
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
