/**
 * Observe pack for Lifecycle participation — badge + start/stop, optional pause/resume.
 *
 * Selects against Participating handles (WorkPool / Daemon Tags). Lifecycle core does
 * not import Observe; this pack lives under `ui/`.
 *
 * @since 0.5.0
 * @internal
 */
import { pipe, type Effect as EffectT, type Stream as StreamT } from "effect";
import * as Observe from "../Observe";

/** Structural Lifecycle surface shared by WorkPool / Daemon handles. */
type LifecycleSurface = {
  readonly lifecycle: {
    readonly get: EffectT.Effect<{ readonly _tag: string }>;
    readonly changes: StreamT.Stream<{ readonly _tag: string }>;
  };
  readonly start: EffectT.Effect<void>;
  readonly stop: EffectT.Effect<void>;
};

/** Pausable surface — Latch-backed WorkPool (and any handle with pause/resume). */
type PausableLifecycleSurface = LifecycleSurface & {
  readonly pause: EffectT.Effect<void>;
  readonly resume: EffectT.Effect<void>;
};

/**
 * Start / stop commands.
 *
 * @public
 */
export const controls = Observe.struct({
  start: Observe.fn((s: LifecycleSurface) => s.start),
  stop: Observe.fn((s: LifecycleSurface) => s.stop),
});

/**
 * Pause / resume commands (requires Latch-backed handle).
 *
 * @public
 */
export const pausableControls = Observe.struct({
  pause: Observe.fn((s: PausableLifecycleSurface) => s.pause),
  resume: Observe.fn((s: PausableLifecycleSurface) => s.resume),
});

/**
 * Core Lifecycle UI pack — badge + start/stop (Daemon / any Participating handle).
 *
 * @example
 * ```ts
 * import * as Observe from "hyperlink-ts/Observe"
 * import * as LifecycleView from "hyperlink-ts/ui/LifecycleView"
 *
 * const box = Observe.use(Sweeper, LifecycleView.pack)
 * ```
 *
 * @public
 */
export const pack = Observe.named(
  "lifecycle",
  pipe(
    Observe.struct({
      lifecycle: Observe.atom((s: LifecycleSurface) => s.lifecycle),
    }),
    Observe.and(controls),
  ),
);

/**
 * Pausable Lifecycle UI pack — core + pause/resume (WorkPool).
 *
 * @example
 * ```ts
 * const box = Observe.use(Jobs, LifecycleView.pausable)
 * ```
 *
 * @public
 */
export const pausable = Observe.named(
  "lifecycle/pausable",
  pipe(pack, Observe.and(pausableControls)),
);
