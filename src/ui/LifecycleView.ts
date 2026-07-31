/**
 * @module ui/LifecycleView
 *
 * Shared Lifecycle observe **pack** — badge + start/stop (+ pause/resume).
 * No platform TSX; renderers compose chrome over these atoms.
 *
 * @example
 * ```ts
 * import * as Observe from "hyperlink-ts/Observe"
 * import * as LifecycleView from "hyperlink-ts/ui/LifecycleView"
 *
 * const box = Observe.use(Jobs, LifecycleView.pausable)
 * yield* box.start()
 * ```
 */
export {
  controls,
  pack,
  pausable,
  pausableControls,
} from "./lifecycleViewPack";
