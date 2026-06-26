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
  type GroupNode,
  type LeafTag,
  type ProcessTag,
  kindOf,
  leafTags,
  processBundle,
  queueBundle,
} from "./queue-data";
import { useAtomValue } from "../queue-widget/atom-react";
import { useViewTransition, useViewTransitionStyle } from "../../src/web/useViewTransition";
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
        <div className="rounded-xl border bg-card p-3 landscape:mx-auto landscape:w-full landscape:max-w-md"><MetricChart bundle={bundle} /></div>
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
  const [path, setPath] = React.useState<ReadonlyArray<GroupNode>>([Fleet]);
  const [selected, setSelected] = React.useState<LeafTag | ProcessTag | null>(null);
  // animate grid ↔ detail / drill-down via the View Transitions API: the activated card
  // morphs to fill the screen while everything else grows/fades in as one image. Only the
  // active element is named (conditional), so the new grid's cards don't pop in on their own.
  const transition = useViewTransition();
  const group = path[path.length - 1] ?? Fleet;
  const pageVt = useViewTransitionStyle(`grp-${group.id}`);

  if (selected !== null) {
    const back = () => transition(`res-${selected.id}`, () => setSelected(null));
    return kindOf(selected) === "process" ? (
      <ProcessDetail tag={selected as ProcessTag} onBack={back} />
    ) : (
      <QueueDetail tag={selected as LeafTag} onBack={back} />
    );
  }

  const canBack = path.length > 1;

  return (
    <div className="mx-auto max-w-5xl safe-area" style={pageVt}>
      <div className="mb-1 flex items-center gap-2">
        {canBack ? (
          <Button variant="outline" size="sm" onClick={() => transition(`grp-${group.id}`, () => setPath((p) => p.slice(0, -1)))}>← back</Button>
        ) : null}
        <h1 className="m-0 flex-1 text-lg font-semibold">
          ⬢ {path.map((g) => displayName(g.id)).join(" / ")}{" "}
          <span className="text-sm font-normal text-muted-foreground">· {leafTags(group).length} resources</span>
        </h1>
      </div>
      <div className="mb-2 text-sm text-muted-foreground">tap a resource for its detail · tap a group to open it</div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
        {Object.entries(group.members).map(([name, member]) => (
          <Cell
            key={name}
            member={member}
            onOpenLeaf={(tag) => transition(`res-${tag.id}`, () => setSelected(() => tag))}
            onOpenGroup={(g) => transition(`grp-${g.id}`, () => setPath((p) => [...p, g]))}
          />
        ))}
      </div>
    </div>
  );
};
