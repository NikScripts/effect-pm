/**
 * Lifecycle — contract roles + shared state projection for HyperService management tools.
 *
 * **Controls** are stamped on Spec methods (same grain as `.annotate`):
 *
 * ```ts
 * import * as Lifecycle from "hyperlink-ts/Lifecycle"
 *
 * pause: Hyperlink.effect(Schema.Void)
 *   .annotate({ description: "Pause processing." })
 *   .pipe(Lifecycle.pause),
 * ```
 *
 * Generic CLI / TUI / dashboard code discovers them via `methodMeta`
 * (`meta.lifecycle === "pause"`), without hardcoding WorkPool vs Daemon method names.
 *
 * **State** is a shared badge vocabulary ({@link State}); project kind-native snapshots with
 * {@link fromWorkPool} / {@link fromDaemon}. Mark the status field with {@link state}.
 *
 * Deferred engine bring-up is **not** here — pipe `Hyperlink.deferStart` onto the
 * HyperService **layer** (`WorkPool.serve(…).pipe(Hyperlink.deferStart)`).
 *
 * @module Lifecycle
 */

// =============================================================================
// Roles (method annotations)
// =============================================================================

/**
 * Lifecycle role on a contract method — inert to the wire; tools read it via
 * `Hyperlink.methodMeta`.
 *
 * @category models
 * @public
 */
export type Role = "state" | "start" | "pause" | "resume" | "stop";

/**
 * Shared lifecycle badge for management UIs. Kind-native fields (WorkPool `phase` + `paused`,
 * Daemon `supervising`) project into this via {@link fromWorkPool} / {@link fromDaemon}.
 *
 * @category models
 * @public
 */
export type State = "idle" | "running" | "paused" | "draining" | "off";

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

/** Mark a status / snapshot field as the lifecycle state source. @category combinators @public */
export const state = role("state");

/** Mark a start / begin-supervising command. @category combinators @public */
export const start = role("start");

/** Mark a pause command. @category combinators @public */
export const pause = role("pause");

/** Mark a resume command. @category combinators @public */
export const resume = role("resume");

/** Mark a stop / shutdown command (terminal or restartable per kind). @category combinators @public */
export const stop = role("stop");

/**
 * Sugar: `.pipe(Lifecycle.lifecycle("pause"))` — prefer the named combinators above.
 *
 * @category combinators
 * @public
 */
export const lifecycle = <R extends Role>(lifecycleRole: R) => role(lifecycleRole);

// =============================================================================
// State projection
// =============================================================================

/**
 * Project a WorkPool (or priority) status snapshot into {@link State}.
 * `paused` collapses into `"paused"` only while `phase === "running"`.
 *
 * @category constructors
 * @public
 */
export const fromWorkPool = (status: {
  readonly phase: "idle" | "running" | "draining" | "off";
  readonly paused: boolean;
}): State => {
  if (status.phase === "idle") return "idle";
  if (status.phase === "draining") return "draining";
  if (status.phase === "off") return "off";
  return status.paused ? "paused" : "running";
};

/**
 * Project a Daemon status snapshot into {@link State}.
 *
 * @category constructors
 * @public
 */
export const fromDaemon = (status: {
  readonly supervising: boolean;
}): State => (status.supervising ? "running" : "idle");
