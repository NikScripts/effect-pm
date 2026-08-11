/**
 * Shared identity for the forward-proxy example.
 *
 * Public `Worker` = client dial only.
 * `WorkerPrivate` = same key + labeled Unix A/B (HttpApi-shaped pipe).
 */
import { Schema } from "effect";
import * as Address from "../../../src/Address";
import * as Hyperlink from "../../../src/Hyperlink";
import * as Node from "../../../src/Node";
import * as NodePolicy from "../../../src/NodePolicy";

export class Probe extends Hyperlink.Service<Probe>()(
  "examples/forward-proxy/Probe",
  {
    tip: Hyperlink.effect(Schema.String),
  },
) {}

/** Client-facing dial — no A/B here. */
export class Worker extends Node.make(
  "examples/forward-proxy/Worker",
  Address.http(":18765"),
) {}

/** Private dials + proxy — never a second `Node.make` with the same key. */
export class WorkerPrivate extends Worker.pipe(
  Address.unix({
    A: "/tmp/hyperlink-forward-proxy-a.sock",
    B: "/tmp/hyperlink-forward-proxy-b.sock",
  }),
  NodePolicy.proxy("Prefer"),
) {}
