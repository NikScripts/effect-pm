/**
 * @module examples/web-dashboard/mobile
 *
 * Touch-first drill-down: a grid of queue + subgroup widgets; tap a group to open it
 * as its own page, tap a queue for its detail (stats + throughput chart + controls +
 * live logs). Tag-driven — the tree is the `Fleet` group tag.
 */

import * as React from "react";
import { AsyncResult } from "effect/unstable/reactivity";
import { Fleet } from "./fleet";
import { type GroupNode, type LeafTag, leafTags, queueBundle } from "./queue-data";
import { useAtomValue } from "../queue-widget/atom-react";
import { Boundary } from "./components/ui/boundary";
import { Button } from "./components/ui/button";
import {
  Cell,
  LogStream,
  MetricChart,
  QueueControls,
  QueueStats,
  StatusBadge,
  displayName,
} from "./widgets";

const QueueDetail = (props: { readonly tag: LeafTag; readonly onBack: () => void }): React.ReactElement => {
  const bundle = queueBundle(props.tag);
  const statusR = useAtomValue(bundle.status);
  const s = AsyncResult.isSuccess(statusR) ? statusR.value : undefined;
  return (
    <div className="flex h-screen flex-col gap-3 p-3">
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
        <LogStream bundle={bundle} className="min-h-0 flex-1 rounded-md border bg-card py-1" />
      </Boundary>
    </div>
  );
};

export const MobileDashboard = (): React.ReactElement => {
  const [path, setPath] = React.useState<ReadonlyArray<GroupNode>>([Fleet]);
  const [selected, setSelected] = React.useState<LeafTag | null>(null);

  if (selected !== null) {
    return <QueueDetail tag={selected} onBack={() => setSelected(null)} />;
  }

  const group = path[path.length - 1] ?? Fleet;
  const canBack = path.length > 1;

  return (
    <div className="mx-auto max-w-5xl p-3">
      <div className="mb-1 flex items-center gap-2">
        {canBack ? (
          <Button variant="outline" size="sm" onClick={() => setPath((p) => p.slice(0, -1))}>← back</Button>
        ) : null}
        <h1 className="m-0 flex-1 text-lg font-semibold">
          ⬢ {path.map((g) => displayName(g.id)).join(" / ")}{" "}
          <span className="text-sm font-normal text-muted-foreground">· {leafTags(group).length} queues</span>
        </h1>
      </div>
      <div className="mb-2 text-sm text-muted-foreground">tap a queue for live logs · tap a group to open it</div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
        {Object.entries(group.members).map(([name, member]) => (
          <Cell
            key={name}
            member={member}
            onOpenQueue={setSelected}
            onOpenGroup={(g) => setPath((p) => [...p, g])}
          />
        ))}
      </div>
    </div>
  );
};
