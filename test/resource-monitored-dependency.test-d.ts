/**
 * Type-level proof: {@link Resource.monitoredDependency} returns a checked
 * {@link Resource.contract | contract} spec and a readiness derivation for its
 * service shape; `readyWhen` is keyed on the decoded `status` type.
 */
import { Schema } from "effect";
import * as Resource from "../src/Resource";

const DbStatus = Schema.Struct({
  connected: Schema.Boolean,
  latencyMs: Schema.Number,
});

const options = {
  status: DbStatus,
  changes: DbStatus,
  readyWhen: (s: Schema.Schema.Type<typeof DbStatus>) => s.connected,
  detail: (s: Schema.Schema.Type<typeof DbStatus>) => `${s.latencyMs}ms`,
} satisfies Resource.MonitoredDependencyOptions<typeof DbStatus, typeof DbStatus>;

const built = Resource.monitoredDependency(options);

void built.spec.status;
void built.spec.changes;
void built.readiness;

// Assignability: factory leaves match ordinary constructors.
const _statusOk: typeof built.spec.status = Resource.effect(DbStatus);
const _changesOk: typeof built.spec.changes = Resource.stream(DbStatus);
void _statusOk;
void _changesOk;

// withReadiness accepts the factory readiness on a tag built from its spec.
class Database extends Resource.withReadiness(
  Resource.Tag<Database>()("monitored/Database", built.spec),
  built.readiness,
) {}
void Database;

Resource.monitoredDependency({
  status: DbStatus,
  changes: DbStatus,
  // @ts-expect-error readyWhen must take the status decoded type, not a string
  readyWhen: (_s: string) => true,
});
