import { Schema, SchemaTransformation } from "effect";
import * as Versioned from "../src/Versioned";

const JobV1 = Schema.Struct({ id: Schema.String, note: Schema.String });
const JobV2 = Schema.Struct({
  id: Schema.String,
  note: Schema.String,
  priority: Schema.Number,
});
const JobV3 = Schema.Struct({
  id: Schema.String,
  body: Schema.Struct({ note: Schema.String, priority: Schema.Number }),
});

declare const toV2: SchemaTransformation.Transformation<
  typeof JobV2.Type,
  typeof JobV1.Type
>;
declare const toV3: SchemaTransformation.Transformation<
  typeof JobV3.Type,
  typeof JobV2.Type
>;

const ok: Versioned.VersionedSchema<typeof JobV3, typeof JobV1> = Versioned.make(
  JobV1,
)
  .migrate(JobV2, toV2)
  .migrate(JobV3, toV3);
void ok;

// Contiguous tip: after V1→V2, next step must be V2→V3 (not V1→V2 again).
const mid = Versioned.make(JobV1).migrate(JobV2, toV2);
// @ts-expect-error — wrong step for tip V2 (toV2 expects V1 encoded)
mid.migrate(JobV3, toV2);
