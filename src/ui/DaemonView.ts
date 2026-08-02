/**
 * @module ui/DaemonView
 *
 * Shared View handles + contribution Layer + observe **pack** — no platform TSX.
 *
 * @example
 * ```ts
 * Observe.use(Nightly, DaemonView.pack)
 * ```
 */
import { Layer } from "effect";
import * as Daemon from "../Daemon";
import { pack } from "./daemonViewPack";
import * as View from "./View";
export { pack };

/** @public */
export class DaemonCard extends View.Card.Tag<DaemonCard>()(
  "hyperlink/view/daemon-card",
  { spec: Daemon.daemonControlSpec },
) {}

/** @public */
export class DaemonDetail extends View.Detail.Tag<DaemonDetail>()(
  "hyperlink/view/daemon-detail",
  { spec: Daemon.daemonControlSpec },
) {}

/**
 * Default Daemon page View service — logs / schedule fullscreen (`/…/logs` · `/…/schedule`).
 *
 * @public
 */
export class DaemonPage extends View.Page.Tag<DaemonPage>()(
  "hyperlink/view/daemon-page",
  { spec: Daemon.daemonControlSpec },
) {}

/** @public */
export const layer = Layer.mergeAll(
  View.bind(Daemon.kind, DaemonCard),
  View.bind(Daemon.kind, DaemonDetail),
  View.bind(Daemon.kind, DaemonPage),
);
