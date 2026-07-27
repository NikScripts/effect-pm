/**
 * @module ui/DaemonView
 *
 * Shared Daemon View handles + contribution Layer — no platform TSX.
 */
import { Layer } from "effect";
import * as Daemon from "../Daemon";
import * as View from "./View";

/** @public */
export class DaemonCard extends View.Tag<DaemonCard>()(
  "hyperlink/view/daemon-card",
  "card",
  Daemon.daemonControlSpec,
) {}

/** @public */
export class DaemonDetail extends View.Tag<DaemonDetail>()(
  "hyperlink/view/daemon-detail",
  "detail",
  Daemon.daemonControlSpec,
) {}

/** @public */
export const layer = Layer.mergeAll(
  View.kind(Daemon.kind, DaemonCard),
  View.kind(Daemon.kind, DaemonDetail),
);
