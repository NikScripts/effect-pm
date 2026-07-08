import { Effect, Schema } from "effect";
import * as Store from "../src/Store";

// ── exact type-equality harness ──────────────────────────────────────────────
// `Equals<A, B>` is `true` only when `A` and `B` are mutually assignable AT THE SAME
// variance — so it FAILS (compile error at `expectExact`) if `Store.extend` ever widens a
// method back to `unknown` / `Record<string, unknown>`.
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const expectExact = <_Check extends true>(): void => {};

// ── fixture: a lean base contract with two custom methods ─────────────────────
const eventRow = Schema.Struct({ id: Schema.String });

const base = Store.contract(
  { event: eventRow },
  ({ event }) => ({
    record: event.append,
    events: event.read,
  }),
);

type EventRow = { readonly id: string };
type BaseCustom = (typeof base)["custom"];

// ============================================================================
// 1. Data-first `extend(methods, base)` — the builder sees the base's CONCRETE
//    `event` handle, and each method's exact signature survives onto `custom`.
// ============================================================================

const extended = Store.extend(
  ({ event }) => ({
    // handle-consuming: only compiles because `event` is the base's concrete leaf handle.
    started: (id: string) => event.append({ id }),
    // self-annotated, mutually distinct effect-function signatures — these collapse to `unknown`
    // the instant `extend` widens `Custom` to `Record<string, unknown>`.
    compute: (a: number, b: number): Effect.Effect<number> => Effect.succeed(a + b),
    tagged: (s: string): Effect.Effect<string> => Effect.succeed(s.toUpperCase()),
  }),
  base,
);

type Custom = (typeof extended)["custom"];

// each added method keeps its EXACT type
expectExact<
  Equals<Custom["started"], (id: string) => Effect.Effect<void, Store.StoreWriteError>>
>();
expectExact<Equals<Custom["compute"], (a: number, b: number) => Effect.Effect<number>>>();
expectExact<Equals<Custom["tagged"], (s: string) => Effect.Effect<string>>>();

// the base's own custom methods are carried through unchanged (merge = Base["custom"] & Custom)
expectExact<Equals<Custom["record"], BaseCustom["record"]>>();
expectExact<Equals<Custom["events"], BaseCustom["events"]>>();
expectExact<
  Equals<Custom["record"], (row: EventRow | ReadonlyArray<EventRow>) => Effect.Effect<void, Store.StoreWriteError>>
>();

// ── anti-widening tripwire ────────────────────────────────────────────────────
// If `extend` regresses to the old `StoreMethodsFn` param, `Custom` becomes
// `Record<string, unknown>` and each method is `unknown`. `Equals<…, unknown>` would then
// flip to `true`; asserting it is `false` makes that regression a COMPILE ERROR here.
expectExact<Equals<Equals<Custom["compute"], unknown>, false>>();
expectExact<Equals<Equals<Custom["started"], unknown>, false>>();
expectExact<Equals<Equals<Custom, Readonly<Record<string, unknown>>>, false>>();

// ============================================================================
// 2. `Store.effects` over an extend-built contract yields the exact method types,
//    with `Storage` added to each method's requirement channel.
// ============================================================================

const eff = Store.effects("scope", extended);

expectExact<
  Equals<
    typeof eff.started,
    (id: string) => Effect.Effect<void, Store.StoreWriteError, Store.Storage>
  >
>();
expectExact<
  Equals<typeof eff.compute, (a: number, b: number) => Effect.Effect<number, never, Store.Storage>>
>();
expectExact<
  Equals<typeof eff.tagged, (s: string) => Effect.Effect<string, never, Store.Storage>>
>();
// the base method is materialized too
void eff.record({ id: "x" });
void eff.events();

// ============================================================================
// 3. Data-first `extend(shapes, methods, base)` — adds a NEW shape AND methods;
//    both the new shape's handle and the added method stay concrete.
// ============================================================================

const auditRow = Schema.Struct({ campaignId: Schema.String });

const extendedWithShape = Store.extend(
  { audit: auditRow },
  ({ audit }) => ({
    recordAudit: audit.append,
    countTo: (n: number): Effect.Effect<number> => Effect.succeed(n),
  }),
  base,
);

type ShapeCustom = (typeof extendedWithShape)["custom"];
type AuditRow = { readonly campaignId: string };

expectExact<Equals<ShapeCustom["countTo"], (n: number) => Effect.Effect<number>>>();
expectExact<
  Equals<
    ShapeCustom["recordAudit"],
    (row: AuditRow | ReadonlyArray<AuditRow>) => Effect.Effect<void, Store.StoreWriteError>
  >
>();
// the new shape's default effects are reachable
const shapeEff = Store.effects("scope2", extendedWithShape);
void shapeEff.audit.append({ campaignId: "c1" });
void shapeEff.event.append({ id: "x" });

// ============================================================================
// 4. Data-last (pipeable) forms — `Custom` is STILL preserved concretely even
//    though the base is unknown when the builder is written. (The handles are
//    typed generically in this form; see the `Store.extend` TSDoc.)
// ============================================================================

const extendedPipe = base.pipe(
  Store.extend(() => ({
    compute: (a: number, b: number): Effect.Effect<number> => Effect.succeed(a + b),
    tagged: (s: string): Effect.Effect<string> => Effect.succeed(s.toUpperCase()),
  })),
);
type PipeCustom = (typeof extendedPipe)["custom"];
expectExact<Equals<PipeCustom["compute"], (a: number, b: number) => Effect.Effect<number>>>();
expectExact<Equals<PipeCustom["tagged"], (s: string) => Effect.Effect<string>>>();
expectExact<Equals<Equals<PipeCustom["compute"], unknown>, false>>();
// base custom survives the pipe merge
expectExact<Equals<PipeCustom["record"], BaseCustom["record"]>>();

// data-last `extend(shapes, methods)` — the NEW shape's handle is known in this form.
const extendedPipeShape = base.pipe(
  Store.extend(
    { audit: auditRow },
    ({ audit }) => ({
      recordAudit: audit.append,
      countTo: (n: number): Effect.Effect<number> => Effect.succeed(n),
    }),
  ),
);
type PipeShapeCustom = (typeof extendedPipeShape)["custom"];
expectExact<Equals<PipeShapeCustom["countTo"], (n: number) => Effect.Effect<number>>>();
expectExact<Equals<PipeShapeCustom["record"], BaseCustom["record"]>>();
