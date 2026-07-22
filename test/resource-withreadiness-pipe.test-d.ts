/**
 * Type-level lock: node-bound data-last `.pipe(withReadiness)` stays shallow under stock tsc
 * (PipeableTag fix). Consumer-shaped readiness typed as {@link Hyperlink.ServiceOf} of the shared
 * spec must not trip TS2589 across many league sites.
 */
import { Effect, Schema } from "effect";
import * as Hyperlink from "../src/Hyperlink";
import * as Node from "../src/Node";

const Status = Schema.Struct({
  connected: Schema.Boolean,
  latencyMs: Schema.Number,
});

const databaseSpec = {
  status: Hyperlink.effect(Status),
} as const;

/** Consumer pattern that formerly stacked depth — full ServiceOf of the shared spec. */
const databaseReadiness = (
  db: Hyperlink.ServiceOf<typeof databaseSpec>,
): Effect.Effect<Hyperlink.Readiness> =>
  Effect.map(db.status, (s) =>
    s.connected ? { ready: true as const, detail: `${s.latencyMs}ms` } : { ready: false as const },
  );

class N1 extends Node.Tag<N1>()("pipe-depth/n1") {}
class N2 extends Node.Tag<N2>()("pipe-depth/n2") {}
class N3 extends Node.Tag<N3>()("pipe-depth/n3") {}
class N4 extends Node.Tag<N4>()("pipe-depth/n4") {}
class N5 extends Node.Tag<N5>()("pipe-depth/n5") {}
class N6 extends Node.Tag<N6>()("pipe-depth/n6") {}

class D1 extends Hyperlink.Tag<D1>()("pipe-depth/D1", databaseSpec, { node: N1 }).pipe(
  Hyperlink.withReadiness(databaseReadiness),
) {}
class D2 extends Hyperlink.Tag<D2>()("pipe-depth/D2", databaseSpec, { node: N2 }).pipe(
  Hyperlink.withReadiness(databaseReadiness),
) {}
class D3 extends Hyperlink.Tag<D3>()("pipe-depth/D3", databaseSpec, { node: N3 }).pipe(
  Hyperlink.withReadiness(databaseReadiness),
) {}
class D4 extends Hyperlink.Tag<D4>()("pipe-depth/D4", databaseSpec, { node: N4 }).pipe(
  Hyperlink.withReadiness(databaseReadiness),
) {}
class D5 extends Hyperlink.Tag<D5>()("pipe-depth/D5", databaseSpec, { node: N5 }).pipe(
  Hyperlink.withReadiness(databaseReadiness),
) {}
class D6 extends Hyperlink.Tag<D6>()("pipe-depth/D6", databaseSpec, { node: N6 }).pipe(
  Hyperlink.withReadiness(databaseReadiness),
) {}

void [D1, D2, D3, D4, D5, D6];

// Inferred svc on a pipe site is precise enough to reject junk fields.
class Precise extends Hyperlink.Tag<Precise>()("pipe-depth/Precise", databaseSpec, {
  node: N1,
}).pipe(
  Hyperlink.withReadiness((svc) => {
    const _ok: Effect.Effect<Schema.Schema.Type<typeof Status>> = svc.status;
    void _ok;
    // @ts-expect-error readiness svc has no `nope` field
    return Effect.map(svc.nope, () => ({ ready: true as const }));
  }),
) {}
void Precise;

// Data-first control — same readiness, node-bound class.
class First extends Hyperlink.withReadiness(
  Hyperlink.Tag<First>()("pipe-depth/First", databaseSpec, { node: N1 }),
  databaseReadiness,
) {}
void First;

// Stacked duals: withReadiness then distributed on a node-bound class.
class FleetNodeA extends Node.Tag<FleetNodeA>()("pipe-depth/fleet-a", {
  url: "http://127.0.0.1:1/rpc",
}) {}
class FleetNodeB extends Node.Tag<FleetNodeB>()("pipe-depth/fleet-b", {
  url: "http://127.0.0.1:2/rpc",
}) {}

class Fleeted extends Hyperlink.Tag<Fleeted>()("pipe-depth/Fleeted", databaseSpec).pipe(
  Hyperlink.withReadiness(databaseReadiness),
  Hyperlink.nodes([FleetNodeA, FleetNodeB]),
) {}
void Fleeted;
