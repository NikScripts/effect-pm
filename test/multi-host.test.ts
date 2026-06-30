import { Effect, Stream } from "effect";
import { expect, it } from "vitest";
import { Combine, combineQuery, combineStream } from "../src/MultiHost";

// fake per-host services (the keyed peer map the toolkit will supply in later slices)
const peers: Record<string, { connections: Effect.Effect<number, string> }> = {
  nwsl: { connections: Effect.succeed(3) },
  ebwsl: { connections: Effect.succeed(5) },
  wnba: { connections: Effect.fail("pool down") }, // a host that's down
};

it("combineQuery folds the reachable hosts — Combine.sum skips the down one", () =>
  Effect.runPromise(combineQuery(peers, (s) => s.connections, Combine.sum)).then((total) =>
    expect(total).toBe(8),
  ));

it("combineQuery exposes per-host outcomes so a custom fold can attribute / fail", () =>
  Effect.runPromise(
    combineQuery(peers, (s) => s.connections, (results) => ({
      up: Combine.byHost(results),
      down: Combine.failures(results).map((f) => f.host),
    })),
  ).then((r) => {
    expect(r.up).toEqual({ nwsl: 3, ebwsl: 5 });
    expect(r.down).toEqual(["wnba"]);
  }));

it("combineStream merges every host's stream", () =>
  Effect.runPromise(
    combineStream(
      { a: { ticks: Stream.make(1, 2) }, b: { ticks: Stream.make(3) } },
      (s) => s.ticks,
      Combine.mergeStreams,
    ).pipe(Stream.runCollect),
  ).then((chunk) => expect([...chunk].sort((x, y) => x - y)).toEqual([1, 2, 3])));
