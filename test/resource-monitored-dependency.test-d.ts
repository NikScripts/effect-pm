/**
 * Type-level proof: {@link Resource.monitoredDependency} returns effect/stream methods and
 * a readiness derivation keyed on the decoded `status` type.
 */
import { Schema } from "effect";
import * as Resource from "../src/Resource";

const DbStatus = Schema.Struct({
  connected: Schema.Boolean,
  latencyMs: Schema.Number,
});

const built = Resource.monitoredDependency({
  status: DbStatus,
  change: DbStatus,
  readyWhen: (s) => s.connected,
  detail: (s) => `${s.latencyMs}ms`,
});

void built.spec.status;
void built.spec.changes;
void built.readiness;

// Assignability: factory leaves match ordinary constructors.
const _statusOk: typeof built.spec.status = Resource.effect(DbStatus);
const _changesOk: typeof built.spec.changes = Resource.stream(DbStatus);
void _statusOk;
void _changesOk;

Resource.monitoredDependency({
  status: DbStatus,
  change: DbStatus,
  // @ts-expect-error readyWhen must take the status decoded type, not a string
  readyWhen: (_s: string) => true,
});
