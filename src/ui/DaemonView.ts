/**
 * @module ui/DaemonView
 *
 * Shared View handles + contribution Layer — no platform TSX.
 */
import { Layer } from "effect";
import * as Daemon from "../Daemon";
import * as View from "./View";

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

/** @public */
export const layer = Layer.mergeAll(
  View.bind(Daemon.kind, DaemonCard),
  View.bind(Daemon.kind, DaemonDetail),
);
