/**
 * @module examples/resource-web/worker-pool-card
 *
 * A **bring-your-own widget**, registered by *key* — the extension path the widget registry exists
 * for. `WorkerPool` (see `hub.ts`) is a consumer-defined, multi-node resource: nothing in the
 * shipped `base` set knows how to render it (it'd fall through to the plain `ResourceCard`). So the
 * consumer writes this card and binds it to the resource's exact key with
 * `forKey(WorkerPool.key, WorkerPoolCard)` (see `app.tsx`) — a per-key widget beats the generic
 * kind card, and building **onto** `base` keeps every other widget.
 *
 * It also shows how to render a resource whose fields are plain `Hyperlink.effect`s (not reactive
 * refs): **poll** them on a tick, exactly as the shipped process card polls its schedule. One tick
 * reads all three contract fields at once — `active` (this client's own instance), `fleetActive`
 * (the fold across every peer), and `activeByNode` (the per-node breakdown) — each surfaced
 * distinctly so the multi-node story is legible at a glance.
 */
import * as React from "react";
import { Duration, Effect, Stream } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { type Widget, displayName, useAtomValue, useRuntime } from "../../src/web";
import { WorkerPool } from "./hub";

/** One node's worker count as a labelled bar — the node's short name, a fill proportional to the
 *  busiest node, and the count. `self` marks the instance this client reads (its `active`). */
const NodeRow = (props: {
  readonly id: string;
  readonly count: number;
  readonly max: number;
  readonly self: boolean;
}): React.ReactElement => (
  <div className="flex items-center gap-2 text-xs">
    <span className="w-16 shrink-0 truncate text-muted-foreground">{displayName(props.id)}</span>
    <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
      <span
        className={props.self ? "absolute inset-y-0 left-0 rounded-full bg-primary" : "absolute inset-y-0 left-0 rounded-full bg-primary/50"}
        style={{ width: `${(props.count / props.max) * 100}%` }}
      />
    </span>
    <span className="w-4 shrink-0 text-right tabular-nums text-foreground">{props.count}</span>
    {props.self ? <span className="shrink-0 text-[0.65rem] text-muted-foreground">this node</span> : null}
  </div>
);

/**
 * The custom card for the `WorkerPool` resource — registered under its key in `app.tsx`. Polls the
 * resource's three fields every 2s over the runtime's (one, multiplexed) transport and lays out the
 * fleet total, a per-node breakdown, and this client's own instance.
 */
export const WorkerPoolCard: Widget = ({ name }) => {
  const runtime = useRuntime();
  // Poll the three effect fields together on a 2s tick — one read cycle, three values. `fromEffect`
  // paints the first frame immediately; `tick` refreshes it. The `WorkerPool` client lives in the
  // runtime (see `hub.ts`), so the runtime discharges the requirement — no `Stream.provide` here.
  const poll = React.useMemo(
    () =>
      runtime.atom(
        Stream.fromEffect(readFleet).pipe(
          Stream.concat(Stream.tick(Duration.seconds(2)).pipe(Stream.mapEffect(() => readFleet))),
        ),
      ),
    [runtime],
  );
  const r = useAtomValue(poll);
  const data = AsyncResult.isSuccess(r) ? r.value : undefined;
  const byNode = data?.byNode ?? {};
  const rows = Object.entries(byNode).sort(([a], [b]) => a.localeCompare(b));
  const max = Math.max(1, ...rows.map(([, c]) => c));
  const own = data?.active ?? 0;

  return (
    <div className="flex flex-col rounded-xl border bg-card p-3">
      <div className="mb-2 flex items-center gap-2">
        <strong className="flex-1 truncate">{name}</strong>
        <span className="rounded-full border px-2 py-0.5 text-[0.7rem] text-muted-foreground">
          {rows.length} {rows.length === 1 ? "node" : "nodes"}
        </span>
      </div>
      <div className="mb-3 flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold tabular-nums text-foreground">{data?.fleet ?? 0}</span>
        <span className="text-xs text-muted-foreground">active · fleet total</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {rows.map(([id, count]) => (
          <NodeRow key={id} id={id} count={count} max={max} self={count === own} />
        ))}
      </div>
    </div>
  );
};

// Read all three contract fields in one effect — kept module-level so the polled stream is a stable
// value (the atom is memoized per runtime). `active` = this client's own instance; `fleetActive` =
// the server-side fold across every peer; `activeByNode` = one row per node.
const readFleet = Effect.flatMap(WorkerPool, (pool) =>
  Effect.all({
    active: pool.active,
    fleet: pool.fleetActive,
    byNode: pool.activeByNode,
  }),
);
