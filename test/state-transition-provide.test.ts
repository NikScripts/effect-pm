/**
 * Step 5.2b / Phase A — two-tier branch model + op `.provide`. Branch combinators
 * (`installBranch` / `patchBranch` / `clearBranch`) write the fiber-local Tier 2
 * overlay; `State.Root.current` / `currentSlice` read the effective merge of the
 * Tier 1 base + active branch. The op builder installs its scope branch, so
 * `State.Changed` can materialize from one effective `current` view.
 */
import { describe, expect, it } from "@effect/vitest";
import { Effect, Fiber, Schema } from "effect";
import { State } from "../src/State";
import { Telemetry } from "../src/Telemetry";

class GateScope extends State.Scope("@test/TpGate", "Gate")({
  resourceId: Schema.String,
  concurrency: Schema.Number,
}) {}

class GateRunScope extends GateScope.withLeaf("Run", {
  runId: Schema.String,
}) {}

const seed = GateScope.layer({ resourceId: "r1", concurrency: 4 });

describe("State branch install/clear/current", () => {
  it("installBranch overlays the branch onto effective current (base previous untouched)", () => {
    const env = Effect.runSync(
      Effect.gen(function* () {
        yield* State.installBranch(GateRunScope, { runId: "run-1" });
        return yield* State.Root;
      }).pipe(Effect.provide(seed)),
    );
    expect(env.current).toEqual({
      resourceId: "r1",
      concurrency: 4,
      Run: { runId: "run-1" },
    });
    // Branch writes are Tier 2 — they do NOT transition the Tier 1 base.
    expect(env.previous).toBeNull();
  });

  it("currentSlice reads the live filtered branch slice", () => {
    const slice = Effect.runSync(
      Effect.gen(function* () {
        yield* State.installBranch(GateRunScope, { runId: "run-2" });
        return yield* State.currentSlice(GateRunScope);
      }).pipe(Effect.provide(seed)),
    );
    expect(slice).toEqual({ runId: "run-2" });
  });

  it("clearBranch removes the branch from effective current", () => {
    const env = Effect.runSync(
      Effect.gen(function* () {
        yield* State.installBranch(GateRunScope, { runId: "run-3" });
        yield* State.clearBranch(GateRunScope);
        return yield* State.Root;
      }).pipe(Effect.provide(seed)),
    );
    expect("Run" in env.current).toBe(false);
    expect(env.current).toEqual({ resourceId: "r1", concurrency: 4 });
  });

  it("re-provide overwrites the leaf nest", () => {
    const slice = Effect.runSync(
      Effect.gen(function* () {
        yield* State.installBranch(GateRunScope, { runId: "run-a" });
        yield* State.installBranch(GateRunScope, { runId: "run-b" });
        return yield* State.currentSlice(GateRunScope);
      }).pipe(Effect.provide(seed)),
    );
    expect(slice).toEqual({ runId: "run-b" });
  });
});

// Telemetry op builder writes the SAME envelope (no scope.layer Context mutation).
class Started extends Telemetry.Schema<Started>()(GateRunScope)({
  runId: GateRunScope.Schema.State.Run.runId,
  occurredAt: Telemetry.terminal.clockMillis,
}) {}

class Done extends Telemetry.Schema<Done>()(GateRunScope)({
  occurredAt: Telemetry.terminal.clockMillis,
}) {}

const Target = { key: "@test/TpDemo" } as const;

class TpTelemetry extends Telemetry.Tag<TpTelemetry>(Target)(
  "@test/TpTelemetry",
  Telemetry.namespace("Gate"),
  Telemetry.group("Run")(
    Telemetry.operation("run")(
      GateRunScope,
      Telemetry.start("Started", Started),
      Telemetry.exit({ onSuccess: Telemetry.event("Done", Done) }),
    ),
  ),
) {}

describe("op.provide ↔ envelope", () => {
  it("op.provide updates State.Root.current (single source of truth)", () => {
    const result = Effect.runSync(
      Effect.gen(function* () {
        const ctx = yield* TpTelemetry.Run.run.provide({ runId: "run-9" });
        const env = yield* State.Root;
        return { scope: ctx.scope, current: env.current };
      }).pipe(Effect.provide(seed)),
    );
    expect(result.current).toEqual({
      resourceId: "r1",
      concurrency: 4,
      Run: { runId: "run-9" },
    });
    expect(result.scope).toEqual({ runId: "run-9" });
  });

  it("OperationContext.scope === State.currentSlice(opScope)", () => {
    const result = Effect.runSync(
      Effect.gen(function* () {
        const ctx = yield* TpTelemetry.Run.run.provide({ runId: "run-10" });
        const slice = yield* State.currentSlice(GateRunScope);
        return { ctxScope: ctx.scope, slice };
      }).pipe(Effect.provide(seed)),
    );
    expect(result.ctxScope).toEqual(result.slice);
  });
});

describe("Phase A — dual API + parallel isolation", () => {
  it("installBranch data-first and scope.pipe forms are equivalent", () => {
    const dataFirst = Effect.runSync(
      Effect.gen(function* () {
        yield* State.installBranch(GateRunScope, { runId: "df" });
        return yield* State.currentSlice(GateRunScope);
      }).pipe(Effect.provide(seed)),
    );
    const piped = Effect.runSync(
      Effect.gen(function* () {
        yield* GateRunScope.pipe(State.installBranch({ runId: "df" }));
        return yield* State.currentSlice(GateRunScope);
      }).pipe(Effect.provide(seed)),
    );
    expect(piped).toEqual({ runId: "df" });
    expect(piped).toEqual(dataFirst);
  });

  it("patchBranch live-updates the active branch (data-first, pipe, Scope.patch)", () => {
    const slice = Effect.runSync(
      Effect.gen(function* () {
        yield* State.installBranch(GateRunScope, { runId: "v1" });
        yield* State.patchBranch(GateRunScope, { runId: "v2" });
        yield* GateRunScope.pipe(State.patchBranch({ runId: "v3" }));
        yield* GateRunScope.patch({ runId: "v4" });
        return yield* State.currentSlice(GateRunScope);
      }).pipe(Effect.provide(seed)),
    );
    expect(slice).toEqual({ runId: "v4" });
  });

  it("withBranch installs, runs the body, and clears on exit", () => {
    const result = Effect.runSync(
      Effect.gen(function* () {
        const during = yield* State.withBranch(
          GateRunScope,
          { runId: "w" },
          State.currentSlice(GateRunScope),
        );
        const after = yield* State.currentSlice(GateRunScope);
        return { during, after };
      }).pipe(Effect.provide(seed)),
    );
    expect(result.during).toEqual({ runId: "w" });
    expect(result.after).toEqual({});
  });

  it.effect("parallel fibers see isolated branches (no shared-path conflict)", () =>
    Effect.gen(function* () {
      // Each fiber installs its own Run branch (keyed by fiber id) and reads it
      // back — isolation is structural, independent of interleaving.
      const readRun = State.currentSlice(GateRunScope);
      const fiberA = yield* State.withBranch(
        GateRunScope,
        { runId: "fiber-a" },
        Effect.flatMap(Effect.yieldNow, () => readRun),
      ).pipe(Effect.forkChild);
      const fiberB = yield* State.withBranch(
        GateRunScope,
        { runId: "fiber-b" },
        Effect.flatMap(Effect.yieldNow, () => readRun),
      ).pipe(Effect.forkChild);
      const a = yield* Fiber.join(fiberA);
      const b = yield* Fiber.join(fiberB);
      expect(a).toEqual({ runId: "fiber-a" });
      expect(b).toEqual({ runId: "fiber-b" });
    }).pipe(Effect.provide(seed)),
  );
});
