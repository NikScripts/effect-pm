/**
 * @module ui/DaemonView
 *
 * Shared View handles + contribution Layer — no platform TSX.
 */
import { Layer } from "effect";
import * as Daemon from "../Daemon";
import * as View from "./View";

const CardProto = View.card.Prototype()({
  spec: Daemon.daemonControlSpec,
});
const DetailProto = View.detail.Prototype()({
  spec: Daemon.daemonControlSpec,
});

/** @public */
export class DaemonCard extends CardProto.Tag<DaemonCard>()(
  "hyperlink/view/daemon-card",
) {}

/** @public */
export class DaemonDetail extends DetailProto.Tag<DaemonDetail>()(
  "hyperlink/view/daemon-detail",
) {}

/** @public */
export const layer = Layer.mergeAll(
  View.bind(Daemon.kind, DaemonCard),
  View.bind(Daemon.kind, DaemonDetail),
);
