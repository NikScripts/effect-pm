/**
 * Lifecycle — building blocks for HyperService lifecycle that **any** service can adopt
 * and that generic tools (CLI / TUI / dashboard) can discover without kind switches.
 *
 * ## Blocks
 *
 * 1. **{@link Role}** — PascalCase method annotation (`"Start"`, `"Pause"`, …). Stamp Spec
 *    methods with {@link start} / {@link pause} / {@link resume} / {@link stop} / {@link state}.
 * 2. **{@link State}** — PascalCase wire vocabulary + Schema (`"Idle"`, `"Running"`, …).
 *    A service that participates exposes a reactive field whose success schema **is**
 *    {@link State}, stamped with {@link state}.
 * 3. **{@link Hyperlink.deferStart}** (on Hyperlink, not here) — Layer pipe to stay Idle until
 *    `Start`.
 *
 * ```ts
 * import * as Lifecycle from "hyperlink-ts/Lifecycle"
 * import * as Hyperlink from "hyperlink-ts/Hyperlink"
 *
 * // Contract — tools find these via methodMeta(m).lifecycle
 * lifecycle: Hyperlink.ref(Lifecycle.State)
 *   .annotate({ description: "Lifecycle badge." })
 *   .pipe(Lifecycle.state),
 * pause: Hyperlink.effect(Schema.Void)
 *   .annotate({ description: "Pause." })
 *   .pipe(Lifecycle.pause),
 * ```
 *
 * Toolkit kinds (WorkPool, Daemon) are **consumers** of these blocks — same as an app
 * HyperService. There is no `fromWorkPool` / kind projection in this module.
 *
 * @module Lifecycle
 */
import { Schema } from "effect";

// =============================================================================
// Role (method annotations — tools)
// =============================================================================

/**
 * Lifecycle **role** on a Spec method — PascalCase, inert to the wire. Tools read it via
 * `Hyperlink.methodMeta`.
 *
 * @category models
 * @public
 */
export type Role = "State" | "Start" | "Pause" | "Resume" | "Stop";

/**
 * Annotatable Spec leaf — `annotate` return type is preserved so `Hyperlink.ref` markers
 * (`Marked`) survive `.pipe(Lifecycle.pause)` (must not widen through `AnyMethod.annotate`).
 */
type Annotatable<R extends Role, Out> = {
  readonly annotate: (annotations: { readonly lifecycle: R }) => Out;
};

const role =
  <R extends Role>(lifecycle: R) =>
  <Out>(method: Annotatable<R, Out>): Out =>
    method.annotate({ lifecycle });

/** Mark the reactive {@link State} field. @category combinators @public */
export const state = role("State");

/** Mark the start command. @category combinators @public */
export const start = role("Start");

/** Mark the pause command. @category combinators @public */
export const pause = role("Pause");

/** Mark the resume command. @category combinators @public */
export const resume = role("Resume");

/** Mark the stop / shutdown command. @category combinators @public */
export const stop = role("Stop");

/**
 * Sugar: `.pipe(Lifecycle.lifecycle("Pause"))` — prefer the named combinators above.
 *
 * @category combinators
 * @public
 */
export const lifecycle = <R extends Role>(lifecycleRole: R) => role(lifecycleRole);

// =============================================================================
// State (wire vocabulary — services + tools)
// =============================================================================

/**
 * Shared lifecycle badge on the wire. A participating service exposes this as a
 * `Hyperlink.ref(Lifecycle.State)` (or equivalent) stamped with {@link state}.
 *
 * @category models
 * @public
 */
export type State = "Idle" | "Running" | "Paused" | "Draining" | "Off";

/**
 * Wire schema for {@link State} — the success schema of a Role `"State"` field.
 *
 * @category schemas
 * @public
 */
export const State = Schema.Literals([
  "Idle",
  "Running",
  "Paused",
  "Draining",
  "Off",
]);
