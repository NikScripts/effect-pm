/**
 * @module ui/DaemonView
 *
 * Shared Daemon View handles + contribution Layer — no platform TSX.
 */
import { Layer } from "effect";
import * as Daemon from "../Daemon";
import * as View from "./View";

/** @public */
export const DaemonCard = View.make({
  key: "hyperlink/view/daemon-card",
  kind: "card",
  spec: Daemon.daemonControlSpec,
});

/** @public */
export const DaemonDetail = View.make({
  key: "hyperlink/view/daemon-detail",
  kind: "detail",
  spec: Daemon.daemonControlSpec,
});

/** @public */
export const layer = Layer.mergeAll(
  View.kind(Daemon.kind, DaemonCard),
  View.kind(Daemon.kind, DaemonDetail),
);
