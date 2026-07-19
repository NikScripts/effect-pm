/**
 * Type-level lock: node-bound data-last `.pipe(withReadiness)` stays shallow under stock tsc
 * (PipeableTag fix). Consumer-shaped readiness typed as {@link Resource.ServiceOf} of the shared
 * spec must not trip TS2589 across many league sites.
 */
import { Effect, Schema } from "effect";
import * as Resource from "../src/Resource";

const Status = Schema.Struct({
  connected: Schema.Boolean,
  latencyMs: Schema.Number,
});

const databaseSpec = {
  status: Resource.effect(Status),
} as const;

/** Consumer pattern that formerly stacked depth — full ServiceOf of the shared spec. */
const databaseReadiness = (
  db: Resource.ServiceOf<typeof databaseSpec>,
): Effect.Effect<Resource.Readiness> =>
  Effect.map(db.status, (s) =>
    s.connected ? { ready: true as const, detail: `${s.latencyMs}ms` } : { ready: false as const },
  );

class N1 extends Resource.Node<N1>("pipe-depth/n1") {}
class N2 extends Resource.Node<N2>("pipe-depth/n2") {}
class N3 extends Resource.Node<N3>("pipe-depth/n3") {}
class N4 extends Resource.Node<N4>("pipe-depth/n4") {}
class N5 extends Resource.Node<N5>("pipe-depth/n5") {}
class N6 extends Resource.Node<N6>("pipe-depth/n6") {}

class D1 extends Resource.Tag<D1>()("pipe-depth/D1", databaseSpec, { node: N1 }).pipe(
  Resource.withReadiness(databaseReadiness),
) {}
class D2 extends Resource.Tag<D2>()("pipe-depth/D2", databaseSpec, { node: N2 }).pipe(
  Resource.withReadiness(databaseReadiness),
) {}
class D3 extends Resource.Tag<D3>()("pipe-depth/D3", databaseSpec, { node: N3 }).pipe(
  Resource.withReadiness(databaseReadiness),
) {}
class D4 extends Resource.Tag<D4>()("pipe-depth/D4", databaseSpec, { node: N4 }).pipe(
  Resource.withReadiness(databaseReadiness),
) {}
class D5 extends Resource.Tag<D5>()("pipe-depth/D5", databaseSpec, { node: N5 }).pipe(
  Resource.withReadiness(databaseReadiness),
) {}
class D6 extends Resource.Tag<D6>()("pipe-depth/D6", databaseSpec, { node: N6 }).pipe(
  Resource.withReadiness(databaseReadiness),
) {}

void [D1, D2, D3, D4, D5, D6];

// Inferred svc on a pipe site is precise enough to reject junk fields.
class Precise extends Resource.Tag<Precise>()("pipe-depth/Precise", databaseSpec, {
  node: N1,
}).pipe(
  Resource.withReadiness((svc) => {
    const _ok: Effect.Effect<Schema.Schema.Type<typeof Status>> = svc.status;
    void _ok;
    // @ts-expect-error readiness svc has no `nope` field
    return Effect.map(svc.nope, () => ({ ready: true as const }));
  }),
) {}
void Precise;

// Data-first control — same readiness, node-bound class.
class First extends Resource.withReadiness(
  Resource.Tag<First>()("pipe-depth/First", databaseSpec, { node: N1 }),
  databaseReadiness,
) {}
void First;

// Stacked duals: withReadiness then distributed on a node-bound class.
class FleetNodeA extends Resource.Node<FleetNodeA>("pipe-depth/fleet-a", {
  url: "http://127.0.0.1:1/rpc",
}) {}
class FleetNodeB extends Resource.Node<FleetNodeB>("pipe-depth/fleet-b", {
  url: "http://127.0.0.1:2/rpc",
}) {}

class Fleeted extends Resource.Tag<Fleeted>()("pipe-depth/Fleeted", databaseSpec).pipe(
  Resource.withReadiness(databaseReadiness),
  Resource.nodes([FleetNodeA, FleetNodeB]),
) {}
void Fleeted;
