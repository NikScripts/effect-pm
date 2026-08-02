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
import * as Ui from "./Ui";

export { pack };

/** @public */
export class DaemonCard extends Ui.Card.Tag<DaemonCard>()(
  "hyperlink/view/daemon-card",
  { spec: Daemon.daemonControlSpec },
) {}

/** @public */
export class DaemonDetail extends Ui.Detail.Tag<DaemonDetail>()(
  "hyperlink/view/daemon-detail",
  { spec: Daemon.daemonControlSpec },
) {}

/**
 * Default Daemon page View service — logs / schedule fullscreen (`/…/logs` · `/…/schedule`).
 *
 * @public
 */
export class DaemonPage extends Ui.Page.Tag<DaemonPage>()(
  "hyperlink/view/daemon-page",
  { spec: Daemon.daemonControlSpec },
) {}

/** @public */
export const layer = Layer.mergeAll(
  Ui.bind(Daemon.kind, DaemonCard),
  Ui.bind(Daemon.kind, DaemonDetail),
  Ui.bind(Daemon.kind, DaemonPage),
);
