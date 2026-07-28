/**
 * @module examples/hyperlink-web/worker-pool-card
 *
 * Bring-your-own View for `WorkerPool` — a consumer-defined multi-node Hyperlink with no shipped
 * card. Pattern: `View.Card.Tag` → skin → `View.only` Layer → Dashboard `views`.
 *
 * Fields are plain `Hyperlink.effect`s (not reactive refs): poll on a tick, same idea as the shipped
 * daemon card. One tick reads `active` / `fleetActive` / `activeByNode`.
 */
import * as React from "react";
import { Duration, Effect, Layer, Stream } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { View, displayName, useAtomValue, useRuntime } from "../../src/web";
import { WorkerPool } from "./hub";

/** UI Needs placeholder — opaque Tag static (not a Hyperlink wire Spec). */
export const workerPoolCardSpec = { kind: "examples/worker-pool-card" } as const;

/** Sized View handle (`size: ViewKind.Card()` from `View.Card`). */
export class WorkerPoolCard extends View.Card.Tag<
  WorkerPoolCard,
  { readonly dense?: boolean }
>()("examples/hyperlink-web/worker-pool-card", {
  spec: workerPoolCardSpec,
}) {}

// Module-level so the polled stream is a stable value (atom memoized per runtime).
const readFleet = Effect.flatMap(WorkerPool, (pool) =>
  Effect.all({
    active: pool.active,
    fleet: pool.fleetActive,
    byNode: pool.activeByNode,
  }),
);

/** One node's worker count as a labelled bar. `self` marks this client's instance. */
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
        className={
          props.self
            ? "absolute inset-y-0 left-0 rounded-full bg-primary"
            : "absolute inset-y-0 left-0 rounded-full bg-primary/50"
        }
        style={{ width: `${(props.count / props.max) * 100}%` }}
      />
    </span>
    <span className="w-4 shrink-0 text-right tabular-nums text-foreground">{props.count}</span>
    {props.self ? <span className="shrink-0 text-[0.65rem] text-muted-foreground">this node</span> : null}
  </div>
);

/**
 * Contribution Layer for Dashboard `views` — allowlist + skin.
 * `R = View.Registry`; Dashboard closes with `View.base`.
 */
export const layer = View.only(WorkerPool, WorkerPoolCard).pipe(
  Layer.provide(
    WorkerPoolCard.provide((props) => {
      const runtime = useRuntime();
      const poll = React.useMemo(
        () =>
          runtime.atom(
            Stream.fromEffect(readFleet).pipe(
              Stream.concat(
                Stream.tick(Duration.seconds(2)).pipe(Stream.mapEffect(() => readFleet)),
              ),
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
      const title = props.name ?? displayName(props.tag.key);

      return (
        <div
          className={`flex flex-col rounded-xl border bg-card ${props.dense === true ? "p-2" : "p-3"}`}
        >
          <div className="mb-2 flex items-center gap-2">
            <strong className="flex-1 truncate">{title}</strong>
            <span className="rounded-full border px-2 py-0.5 text-[0.7rem] text-muted-foreground">
              {rows.length} {rows.length === 1 ? "node" : "nodes"}
            </span>
          </div>
          <div className="mb-3 flex items-baseline gap-1.5">
            <span className="text-2xl font-semibold tabular-nums text-foreground">
              {data?.fleet ?? 0}
            </span>
            <span className="text-xs text-muted-foreground">active · fleet total</span>
          </div>
          <div className="flex flex-col gap-1.5">
            {rows.map(([id, count]) => (
              <NodeRow key={id} id={id} count={count} max={max} self={count === own} />
            ))}
          </div>
        </div>
      );
    }),
  ),
);
