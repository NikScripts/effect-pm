/**
 * Validation tests for scope/envelope lifecycle — conflicts, cleanup, and
 * behavioral parity research (not shipped API yet).
 */
import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Fiber, Layer, Ref, Schema } from "effect";
import { getStateFieldSelectorMetadata, State } from "../src/State";

const QueueScope = State.Scope("@test/LcQueue", "Queue")({
  queueId: Schema.String,
});

const EntryScope = QueueScope.withLeaf("Entry", {
  entryId: Schema.String,
});

const WorkerScope = QueueScope.withLeaf("Worker", {
  workerId: Schema.String,
});

const queueSeed = QueueScope.layer({ queueId: "q-1" });

/** Proposed safe session: install on entry, provide layer, clear on exit. */
const scopeSession = <
  Leaf extends Record<string, unknown>,
  A,
  E,
  R,
>(
  scope: {
    readonly path: ReadonlyArray<string>;
    readonly leafKeys: ReadonlyArray<string>;
    readonly layer: (leaf: Leaf) => Layer.Layer<any, never, any>;
  },
  leaf: Leaf,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    yield* State.installLeaf(scope, leaf);
    return yield* Effect.ensuring(
      effect.pipe(Effect.provide(scope.layer(leaf))),
      State.clearLeaf(scope),
    );
  });

describe("baseline — Context vs envelope today", () => {
  it("Scope.run puts nested state in Context but not in envelope", () => {
    const result = Effect.runSync(
      EntryScope.run(
        { entryId: "e-1" },
        Effect.gen(function* () {
          const fromContext = yield* EntryScope;
          const env = yield* State.Root;
          return { fromContext, envelopeCurrent: env.current };
        }),
      ).pipe(
        Effect.provide(QueueScope.layer({ queueId: "q-1" })),
      ),
    );

    expect(result.fromContext).toEqual({
      queueId: "q-1",
      Entry: { entryId: "e-1" },
    });
    expect(result.envelopeCurrent).toEqual({ queueId: "q-1" });
  });

  it("after Scope.run completes, Context scope ends — envelope unchanged", () => {
    const after = Effect.runSync(
      Effect.gen(function* () {
        yield* EntryScope.run({ entryId: "e-2" }, Effect.void).pipe(
          Effect.provide(
            QueueScope.layer({ queueId: "q-2" }),
          ),
        );
        const env = yield* State.Root;
        return env.current;
      }).pipe(Effect.provide(QueueScope.layer({ queueId: "q-outer" }))),
    );

    // Outer seed survives; inner run used a nested provide with its own root Ref.
    expect(after).toEqual({ queueId: "q-outer" });
  });
});

describe("installLeaf / clearLeaf — cleanup guarantees", () => {
  it("clearLeaf on success removes the nest", () => {
    const env = Effect.runSync(
      scopeSession(GateRunScope, { runId: "r-ok" }, Effect.succeed("done")).pipe(
        Effect.flatMap((out) =>
          Effect.map(State.Root, (root) => ({ out, current: root.current })),
        ),
        Effect.provide(seed()),
      ),
    );
    expect(env.out).toBe("done");
    expect(env.current).toEqual({ resourceId: "r1", concurrency: 4 });
  });

  it("clearLeaf on failure still runs (Effect.ensuring)", () => {
    const exit = Effect.runSyncExit(
      scopeSession(
        GateRunScope,
        { runId: "r-fail" },
        Effect.fail("boom" as const),
      ).pipe(Effect.provide(seed())),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    const env = Effect.runSync(State.Root.pipe(Effect.provide(seed())));
    expect("Run" in env.current).toBe(false);
  });

  it("nested sessions clear only their own path", () => {
    const env = Effect.runSync(
      Effect.gen(function* () {
        yield* scopeSession(EntryScope, { entryId: "e-nested" }, Effect.gen(function* () {
          const mid = yield* State.Root;
          expect(mid.current).toMatchObject({
            queueId: "q-1",
            Entry: { entryId: "e-nested" },
          });
          return yield* scopeSession(WorkerScope, { workerId: "w-nested" }, Effect.void);
        }));
        return yield* State.Root;
      }).pipe(Effect.provide(queueSeed)),
    );

    expect(env.current).toEqual({ queueId: "q-1" });
    expect("Entry" in env.current).toBe(false);
    expect("Worker" in env.current).toBe(false);
  });
});

describe("conflict behavior — path replace and siblings", () => {
  it("re-install at the same path replaces (no duplicate keys)", () => {
    const env = Effect.runSync(
      Effect.gen(function* () {
        yield* State.installLeaf(GateRunScope, { runId: "a" });
        yield* State.installLeaf(GateRunScope, { runId: "b" });
        return yield* State.Root;
      }).pipe(Effect.provide(seed())),
    );
    expect(env.current.Run).toEqual({ runId: "b" });
  });

  it("sibling leaf paths coexist until each is cleared", () => {
    const env = Effect.runSync(
      Effect.gen(function* () {
        yield* State.installLeaf(EntryScope, { entryId: "e-1" });
        yield* State.installLeaf(WorkerScope, { workerId: "w-1" });
        const both = yield* State.Root;
        yield* State.clearLeaf(WorkerScope);
        const afterWorker = yield* State.Root;
        yield* State.clearLeaf(EntryScope);
        const afterAll = yield* State.Root;
        return { both: both.current, afterWorker: afterWorker.current, afterAll: afterAll.current };
      }).pipe(Effect.provide(queueSeed)),
    );

    expect(env.both).toEqual({
      queueId: "q-1",
      Entry: { entryId: "e-1" },
      Worker: { workerId: "w-1" },
    });
    expect(env.afterWorker).toEqual({
      queueId: "q-1",
      Entry: { entryId: "e-1" },
    });
    expect(env.afterAll).toEqual({ queueId: "q-1" });
  });
});

describe("memory — Ref lifetime and transition churn", () => {
  it("each root layer() gets a fresh Ref (no cross-run envelope leak)", () => {
    const first = Effect.runSync(
      Effect.gen(function* () {
        yield* State.installLeaf(GateRunScope, { runId: "leftover" });
        return yield* State.Root;
      }).pipe(Effect.provide(seed({ resourceId: "a" }))),
    );
    expect(first.current).toMatchObject({ Run: { runId: "leftover" } });

    const second = Effect.runSync(State.Root.pipe(Effect.provide(seed({ resourceId: "b" }))));
    expect(second.current).toEqual({ resourceId: "b", concurrency: 4 });
    expect("Run" in second.current).toBe(false);
  });

  it("structuredClone COW does not grow unbounded when nests are cleared", () => {
    const iterations = 200;
    Effect.runSync(
      Effect.gen(function* () {
        for (let i = 0; i < iterations; i += 1) {
          yield* scopeSession(GateRunScope, { runId: `run-${i}` }, Effect.void);
        }
        const env = yield* State.Root;
        expect(env.current).toEqual({ resourceId: "r1", concurrency: 4 });
      }).pipe(Effect.provide(seed())),
    );
  });
});

describe("concurrency — shared StateRootRef", () => {
  it("parallel install/clear on the same path is last-writer visible (documented hazard)", () =>
    Effect.gen(function* () {
      yield* Effect.gen(function* () {
        const fiberA = yield* scopeSession(
          GateRunScope,
          { runId: "fiber-a" },
          Effect.sleep("20 millis"),
        ).pipe(Effect.forkChild);
        const fiberB = yield* scopeSession(
          GateRunScope,
          { runId: "fiber-b" },
          Effect.sleep("5 millis"),
        ).pipe(Effect.forkChild);
        yield* Fiber.join(fiberA);
        yield* Fiber.join(fiberB);
        const env = yield* State.Root;
        // Both sessions clear on exit; final state should have no Run nest.
        expect("Run" in env.current).toBe(false);
      }).pipe(Effect.provide(seed()));
    }),
  );

  it("interleaved install without session wrapper can leave stale nest (anti-pattern)", () => {
    const env = Effect.runSync(
      Effect.gen(function* () {
        yield* State.installLeaf(GateRunScope, { runId: "stale" });
        // Missing clearLeaf — simulates a bug.
        return yield* State.Root;
      }).pipe(Effect.provide(seed())),
    );
    expect(env.current).toMatchObject({ Run: { runId: "stale" } });
  });
});

describe("emit parity — envelope.current vs Context tree for selectors", () => {
  it.effect("Root.current matches Context tree when session syncs installLeaf", () =>
    scopeSession(EntryScope, { entryId: "e-parity" }, Effect.gen(function* () {
      const fromContext = yield* EntryScope;
      const fromEnvelope = (yield* State.Root).current;
      return { fromContext, fromEnvelope };
    })).pipe(
      Effect.provide(queueSeed),
      Effect.tap(({ fromContext, fromEnvelope }) =>
        Effect.sync(() => {
          expect(fromEnvelope).toEqual(fromContext);
        }),
      ),
      Effect.asVoid,
    ),
  );

  it.effect("materialize readPath works on envelope.current after session sync", () =>
    scopeSession(EntryScope, { entryId: "e-mat" }, Effect.gen(function* () {
      const state = (yield* State.Root).current;
      let current: unknown = state;
      for (const segment of selectorPath) {
        current = (current as Record<string, unknown>)[segment];
      }
      return current;
    })).pipe(
      Effect.provide(queueSeed),
      Effect.tap((payload) => Effect.sync(() => expect(payload).toBe("e-mat"))),
      Effect.asVoid,
    ),
  );
});

const selectorPath = getStateFieldSelectorMetadata(
  EntryScope.Schema.State.Entry.entryId,
)!.path;

// =============================================================================
// Two-tier state prototype — shared base + fiber-keyed leaf stacks (target design)
// =============================================================================

type LeafFrame = {
  readonly path: ReadonlyArray<string>;
  readonly leaf: Record<string, unknown>;
};

const protoInsertAtPath = (
  node: Record<string, unknown>,
  path: ReadonlyArray<string>,
  leaf: Record<string, unknown>,
): Record<string, unknown> => {
  const [head, ...rest] = path;
  if (head === undefined) {
    return { ...node, ...leaf };
  }
  if (rest.length === 0) {
    return { ...node, [head]: leaf };
  }
  const child =
    typeof node[head] === "object" && node[head] !== null && !Array.isArray(node[head])
      ? (node[head] as Record<string, unknown>)
      : {};
  return { ...node, [head]: protoInsertAtPath(child, rest, leaf) };
};

const protoMerge = (
  base: Record<string, unknown>,
  stack: ReadonlyArray<LeafFrame>,
): Record<string, unknown> =>
  stack.reduce((acc, frame) => protoInsertAtPath(acc, frame.path, frame.leaf), base);

/** Fiber-keyed leaf stack registry — prototype of internal `StateBranchStackRegistry`. */
const makeLeafStackRegistry = () => {
  const stacksRef = Effect.runSync(Ref.make(new Map<number, ReadonlyArray<LeafFrame>>()));

  const getStack = (fiberId: number): Effect.Effect<ReadonlyArray<LeafFrame>> =>
    Ref.get(stacksRef).pipe(Effect.map((m) => m.get(fiberId) ?? []));

  const setStack = (
    fiberId: number,
    stack: ReadonlyArray<LeafFrame>,
  ): Effect.Effect<void> =>
    Ref.update(stacksRef, (m) => {
      const next = new Map(m);
      if (stack.length === 0) {
        next.delete(fiberId);
      } else {
        next.set(fiberId, stack);
      }
      return next;
    });

  const pushFrame = (
    scope: { readonly path: ReadonlyArray<string> },
    leaf: Record<string, unknown>,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const fiberId = yield* Effect.fiberId;
      const stack = yield* getStack(fiberId);
      const withoutPath = stack.filter(
        (f) => f.path.join(".") !== scope.path.join("."),
      );
      yield* setStack(fiberId, [...withoutPath, { path: scope.path, leaf }]);
    });

  const popFrame = (
    scope: { readonly path: ReadonlyArray<string> },
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const fiberId = yield* Effect.fiberId;
      const stack = yield* getStack(fiberId);
      const next = stack.filter((f) => f.path.join(".") !== scope.path.join("."));
      yield* setStack(fiberId, next);
    });

  const activeFiberCount = (): Effect.Effect<number> =>
    Ref.get(stacksRef).pipe(Effect.map((m) => m.size));

  return { getStack, pushFrame, popFrame, activeFiberCount };
};

const fiberScopeSession = <A, E, R>(
  registry: ReturnType<typeof makeLeafStackRegistry>,
  scope: { readonly path: ReadonlyArray<string> },
  leaf: Record<string, unknown>,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    yield* registry.pushFrame(scope, leaf);
    return yield* Effect.ensuring(effect, registry.popFrame(scope));
  });

describe("two-tier prototype — parallel-safe leaf stacks", () => {
  const runPath = ["Run"] as const;
  const runScope = { path: runPath };

  it("parallel fibers see isolated Run nests (no shared-path conflict)", () =>
    Effect.gen(function* () {
      const registry = makeLeafStackRegistry();
      const base = { resourceId: "r1", concurrency: 4 };

      const readRun = Effect.gen(function* () {
        const stack = yield* registry.getStack(yield* Effect.fiberId);
        const effective = protoMerge(base, stack);
        const run = effective["Run"];
        return typeof run === "object" && run !== null && !Array.isArray(run)
          ? (run as Record<string, unknown>)
          : {};
      });

      const fiberA = yield* fiberScopeSession(registry, runScope, { runId: "fiber-a" }, Effect.gen(function* () {
          yield* Effect.sleep("15 millis");
          return yield* readRun;
        })).pipe(Effect.forkChild);
      const fiberB = yield* fiberScopeSession(registry, runScope, { runId: "fiber-b" }, readRun).pipe(
        Effect.forkChild,
      );

      const [a, b] = yield* Effect.all([Fiber.join(fiberA), Fiber.join(fiberB)], {
        concurrency: "unbounded",
      });
      expect(a).toEqual({ runId: "fiber-a" });
      expect(b).toEqual({ runId: "fiber-b" });
      expect(yield* registry.activeFiberCount()).toBe(0);
    }),
  );

  it("nested frames pop in LIFO order on the same fiber", () =>
    Effect.gen(function* () {
      const registry = makeLeafStackRegistry();
      const base = { queueId: "q-1" };

      yield* fiberScopeSession(
        registry,
        { path: ["Entry"] },
        { entryId: "e-1" },
        fiberScopeSession(
          registry,
          { path: ["Worker"] },
          { workerId: "w-1" },
          Effect.gen(function* () {
            const stack = yield* registry.getStack(yield* Effect.fiberId);
            return protoMerge(base, stack);
          }),
        ),
      );

      const after = yield* registry.getStack(yield* Effect.fiberId);
      expect(after).toEqual([]);
    }),
  );

  it("popFrame on failure (ensuring) prevents stale stacks", () => {
    const registry = makeLeafStackRegistry();
    Effect.runSyncExit(
      fiberScopeSession(
        registry,
        runScope,
        { runId: "fail" },
        Effect.fail("boom" as const),
      ),
    );
    expect(Effect.runSync(registry.activeFiberCount())).toBe(0);
  });

  it("shared base transitions are unaffected by leaf stack", () =>
    Effect.gen(function* () {
      const registry = makeLeafStackRegistry();
      let base = { resourceId: "r1", concurrency: 4 };

      yield* fiberScopeSession(registry, runScope, { runId: "r-1" }, Effect.void);
      base = { ...base, concurrency: 8 };

      const stack = yield* registry.getStack(yield* Effect.fiberId);
      expect(protoMerge(base, stack)).toEqual({ resourceId: "r1", concurrency: 8 });
      expect("Run" in base).toBe(false);
    }),
  );
});

class GateScope extends State.Scope("@test/LcGate", "Gate")({
  resourceId: Schema.String,
  concurrency: Schema.Number,
}) {}

class GateRunScopeClass extends GateScope.withLeaf("Run", {
  runId: Schema.String,
}) {}

const GateRunScope = GateRunScopeClass;

const seed = (leaf?: { resourceId: string }) =>
  GateScope.layer({
    resourceId: leaf?.resourceId ?? "r1",
    concurrency: 4,
  });
