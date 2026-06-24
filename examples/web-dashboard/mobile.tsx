/**
 * @module examples/web-dashboard/mobile
 *
 * Touch-first drill-down: a grid of queue + subgroup widgets; tap a group to open it
 * as its own page, tap a queue for its detail (stats + throughput chart + controls +
 * live logs). Same widgets as the desktop layout — only the page shape differs.
 */

import * as React from "react";
import { AsyncResult } from "effect/unstable/reactivity";
import { REGISTRY, TREE, type Group } from "../resource-tui/live-queues";
import { useAtomValue } from "../queue-widget/atom-react";
import { Button } from "./components/ui/button";
import {
  Cell,
  LogStream,
  QueueControls,
  QueueStats,
  StatusBadge,
  ThroughputChart,
  displayName,
  leafIds,
} from "./widgets";

const QueueDetail = (props: { readonly id: string; readonly onBack: () => void }): React.ReactElement => {
  const bundle = REGISTRY[props.id];
  const statusR = useAtomValue(bundle!.status);
  const s = AsyncResult.isSuccess(statusR) ? statusR.value : undefined;
  if (bundle === undefined) {
    return <div />;
  }
  return (
    <div className="flex h-screen flex-col gap-3 p-3">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={props.onBack}>← back</Button>
        <strong className="flex-1 truncate text-base">{displayName(props.id)}</strong>
        <StatusBadge phase={s?.phase ?? "running"} paused={s?.paused ?? false} />
      </div>
      <QueueStats bundle={bundle} />
      <div className="rounded-xl border bg-card p-3">
        <div className="mb-1 text-sm font-semibold">throughput</div>
        <ThroughputChart bundle={bundle} />
      </div>
      <QueueControls bundle={bundle} />
      <div className="text-xs text-muted-foreground">
        LOGS <span className="text-[#22c55e]">live</span> · phase {s?.phase ?? "?"}
      </div>
      <LogStream bundle={bundle} className="min-h-0 flex-1 rounded-md border bg-card py-1" />
    </div>
  );
};

export const MobileDashboard = (): React.ReactElement => {
  const [path, setPath] = React.useState<ReadonlyArray<Group>>([TREE]);
  const [selected, setSelected] = React.useState<string | null>(null);

  if (selected !== null && REGISTRY[selected] !== undefined) {
    return <QueueDetail id={selected} onBack={() => setSelected(null)} />;
  }

  const group = path[path.length - 1] ?? TREE;
  const canBack = path.length > 1;

  return (
    <div className="mx-auto max-w-5xl p-3">
      <div className="mb-1 flex items-center gap-2">
        {canBack ? (
          <Button variant="outline" size="sm" onClick={() => setPath((p) => p.slice(0, -1))}>← back</Button>
        ) : null}
        <h1 className="m-0 flex-1 text-lg font-semibold">
          ⬢ {path.map((g) => displayName(g.name)).join(" / ")}{" "}
          <span className="text-sm font-normal text-muted-foreground">· {leafIds(group).length} queues</span>
        </h1>
      </div>
      <div className="mb-2 text-sm text-muted-foreground">tap a queue for live logs · tap a group to open it</div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
        {group.members.map((node) => (
          <Cell
            key={`${node.t}-${node.name}`}
            node={node}
            onOpenQueue={setSelected}
            onOpenGroup={(g) => setPath((p) => [...p, g])}
          />
        ))}
      </div>
    </div>
  );
};
