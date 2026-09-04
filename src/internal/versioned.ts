/**
 * Versioned schema migration chain — engine.
 *
 * @module internal/versioned
 * @internal
 */
import {
  Effect,
  Exit,
  Hash,
  Option,
  Predicate,
  Schema,
  SchemaIssue,
  SchemaTransformation,
  SchemaAST,
} from "effect";
import { fingerprintAst } from "./contractHash";

// =============================================================================
// Brand / errors
// =============================================================================

/** Identity brand for a {@link VersionedSchema}. @internal */
export const VersionedTypeId = "~hyperlink-ts/Versioned" as const;

/**
 * No contiguous migration path between two tip ids in a Versioned chain.
 *
 * @since 0.9.0
 * @category errors
 * @public
 */
export class MigrationPathMissing extends Schema.TaggedErrorClass<MigrationPathMissing>()(
  "MigrationPathMissing",
  {
    serviceKey: Schema.String,
    leaf: Schema.String,
    from: Schema.String,
    to: Schema.String,
  },
) {}

/**
 * A migration step failed to decode/encode while applying a Versioned path.
 *
 * @since 0.9.0
 * @category errors
 * @public
 */
export class MigrationDecodeFailed extends Schema.TaggedErrorClass<MigrationDecodeFailed>()(
  "MigrationDecodeFailed",
  {
    serviceKey: Schema.String,
    leaf: Schema.String,
    from: Schema.String,
    step: Schema.String,
  },
) {}

// =============================================================================
// Tip identity
// =============================================================================

/** Read `Schema.Class.identifier` or AST identifier annotation. @internal */
export const tipIdentifier = (schema: Schema.Top): string | undefined => {
  if (
    Predicate.hasProperty(schema, "identifier") &&
    typeof (schema as { readonly identifier: unknown }).identifier === "string"
  ) {
    return (schema as { readonly identifier: string }).identifier;
  }
  return SchemaAST.resolveIdentifier(schema.ast);
};

const tipVersionOf = (schema: Schema.Top): string => {
  const id = tipIdentifier(schema);
  if (id !== undefined) return id;
  const canonical = JSON.stringify(fingerprintAst(schema.ast));
  return (Hash.hash(canonical) >>> 0).toString(16).padStart(8, "0");
};

/**
 * Stable tip id: Class/AST `identifier` when present, else AST content-hash
 * (same fingerprint family as contract hash).
 *
 * @since 0.9.0
 * @category constructors
 * @public
 */
export const schemaVersion = (schema: Schema.Top): string => {
  if (isVersioned(schema)) {
    return schema[VersionedTypeId].steps.at(-1)!.version;
  }
  return tipVersionOf(schema);
};

// =============================================================================
// Chain model
// =============================================================================

type ChainStep = {
  readonly schema: Schema.Top;
  readonly version: string;
  readonly fromPrevious:
    | SchemaTransformation.Transformation<unknown, unknown>
    | undefined;
};

/** @internal */
export interface VersionedMeta {
  readonly steps: ReadonlyArray<ChainStep>;
}

/**
 * A Versioned carrier: tip Schema + contiguous migration chain.
 * The carrier itself is a Schema (Type = tip) that accepts older tips on decode.
 *
 * @since 0.9.0
 * @category models
 * @public
 */
export interface VersionedSchema<
  Current extends Schema.Top,
  Origin extends Schema.Top,
> extends Schema.Top {
  readonly [VersionedTypeId]: VersionedMeta;
  readonly current: Current;
  readonly origin: Origin;
  migrate: <Next extends Schema.Top>(
    next: Next,
    step: SchemaTransformation.Transformation<
      Schema.Schema.Type<Next>,
      Schema.Schema.Type<Current>
    >,
  ) => VersionedSchema<Next, Origin>;
}

/**
 * Returns `true` when `u` is a {@link VersionedSchema} carrier.
 *
 * @since 0.9.0
 * @category refinements
 * @public
 */
export const isVersioned = (u: unknown): u is VersionedSchema<Schema.Top, Schema.Top> =>
  Predicate.hasProperty(u, VersionedTypeId);

const asCodec = <A>(schema: Schema.Top): Schema.Codec<A, unknown> =>
  schema as unknown as Schema.Codec<A, unknown>;

const stepSchema = (
  previous: Schema.Top,
  next: Schema.Top,
  step: SchemaTransformation.Transformation<unknown, unknown>,
): Schema.Top =>
  previous.pipe(
    Schema.decodeTo(next, step as SchemaTransformation.Transformation<any, any>),
  );

const failDecode = (
  options: { readonly serviceKey: string; readonly leaf: string; readonly from: string },
  step: string,
): MigrationDecodeFailed =>
  new MigrationDecodeFailed({
    serviceKey: options.serviceKey,
    leaf: options.leaf,
    from: options.from,
    step,
  });

const upcastFromIndexExit = (
  steps: ReadonlyArray<ChainStep>,
  fromIndex: number,
  value: unknown,
  options: { readonly serviceKey: string; readonly leaf: string; readonly from: string },
): Exit.Exit<unknown, MigrationDecodeFailed> => {
  let current = value;
  for (let i = fromIndex + 1; i < steps.length; i++) {
    const step = steps[i]!;
    const transform = step.fromPrevious;
    if (transform === undefined) continue;
    const linked = stepSchema(steps[i - 1]!.schema, step.schema, transform);
    const decoded = Schema.decodeUnknownExit(asCodec(linked))(current);
    if (Exit.isFailure(decoded)) {
      return Exit.fail(failDecode(options, step.version));
    }
    current = decoded.value;
  }
  return Exit.succeed(current);
};

const buildWireSchema = <Current extends Schema.Top>(
  tip: Current,
  steps: ReadonlyArray<ChainStep>,
): Schema.Top => {
  const tipId = tipVersionOf(tip);
  const transformation = SchemaTransformation.transformOrFail({
    decode: (input: unknown): Effect.Effect<Schema.Schema.Type<Current>, SchemaIssue.Issue> => {
      for (let i = steps.length - 1; i >= 0; i--) {
        const step = steps[i]!;
        const decoded = Schema.decodeUnknownExit(asCodec(step.schema))(input);
        if (Exit.isSuccess(decoded)) {
          if (i === steps.length - 1) {
            return Effect.succeed(decoded.value as Schema.Schema.Type<Current>);
          }
          const up = upcastFromIndexExit(steps, i, decoded.value, {
            serviceKey: "",
            leaf: "payload",
            from: step.version,
          });
          if (Exit.isSuccess(up)) {
            return Effect.succeed(up.value as Schema.Schema.Type<Current>);
          }
          return Effect.fail(
            new SchemaIssue.InvalidValue(Option.some(input), {
              message: `MigrationDecodeFailed at ${step.version}`,
            }),
          );
        }
      }
      return Effect.fail(
        new SchemaIssue.InvalidValue(Option.some(input), {
          message: `MigrationPathMissing: cannot decode into ${tipId}`,
        }),
      );
    },
    encode: (
      value: Schema.Schema.Type<Current>,
    ): Effect.Effect<unknown, SchemaIssue.Issue> => {
      const encoded = Schema.encodeUnknownExit(asCodec<Schema.Schema.Type<Current>>(tip))(
        value,
      );
      return Exit.isSuccess(encoded)
        ? Effect.succeed(encoded.value)
        : Effect.fail(
            new SchemaIssue.InvalidValue(Option.some(value), {
              message: "MigrationDecodeFailed: encode tip",
            }),
          );
    },
  });
  return Schema.Unknown.pipe(Schema.decodeTo(tip, transformation as never));
};

const brand = <Current extends Schema.Top, Origin extends Schema.Top>(
  tip: Current,
  origin: Origin,
  steps: ReadonlyArray<ChainStep>,
): VersionedSchema<Current, Origin> => {
  const meta: VersionedMeta = { steps };
  const wire = buildWireSchema(tip, steps);
  const migrate = <Next extends Schema.Top>(
    next: Next,
    step: SchemaTransformation.Transformation<
      Schema.Schema.Type<Next>,
      Schema.Schema.Type<Current>
    >,
  ): VersionedSchema<Next, Origin> =>
    brand(
      next,
      origin,
      steps.concat({
        schema: next,
        version: tipVersionOf(next),
        fromPrevious: step as SchemaTransformation.Transformation<unknown, unknown>,
      }),
    );

  return Object.assign(wire, {
    [VersionedTypeId]: meta,
    current: tip,
    origin,
    migrate,
  }) as unknown as VersionedSchema<Current, Origin>;
};

/**
 * Start a Versioned chain at `origin`. Tip id = {@link schemaVersion}`(origin)`.
 *
 * @since 0.9.0
 * @category constructors
 * @public
 */
export const make = <S extends Schema.Top>(origin: S): VersionedSchema<S, S> =>
  brand(origin, origin, [
    {
      schema: origin,
      version: tipVersionOf(origin),
      fromPrevious: undefined,
    },
  ]);

/** Index of a tip id in the chain, or `-1`. @internal */
export const indexOfVersion = (
  versioned: VersionedSchema<Schema.Top, Schema.Top>,
  version: string,
): number => versioned[VersionedTypeId].steps.findIndex((s) => s.version === version);

/**
 * Decode `encoded` written at `fromVersion` into the Versioned tip type.
 *
 * @since 0.9.0
 * @category codecs
 * @public
 */
export const decodeFromVersion = <Current extends Schema.Top>(
  versioned: VersionedSchema<Current, Schema.Top>,
  fromVersion: string,
  encoded: unknown,
  options?: { readonly serviceKey?: string; readonly leaf?: string },
): Effect.Effect<Schema.Schema.Type<Current>, MigrationPathMissing | MigrationDecodeFailed> => {
  const serviceKey = options?.serviceKey ?? "";
  const leaf = options?.leaf ?? "payload";
  const steps = versioned[VersionedTypeId].steps;
  const fromIndex = indexOfVersion(versioned, fromVersion);
  if (fromIndex < 0) {
    return Effect.fail(
      new MigrationPathMissing({
        serviceKey,
        leaf,
        from: fromVersion,
        to: schemaVersion(versioned),
      }),
    );
  }
  const atFrom = Schema.decodeUnknownExit(asCodec(steps[fromIndex]!.schema))(encoded);
  if (Exit.isFailure(atFrom)) {
    return Effect.fail(failDecode({ serviceKey, leaf, from: fromVersion }, fromVersion));
  }
  if (fromIndex === steps.length - 1) {
    return Effect.succeed(atFrom.value as Schema.Schema.Type<Current>);
  }
  const up = upcastFromIndexExit(steps, fromIndex, atFrom.value, {
    serviceKey,
    leaf,
    from: fromVersion,
  });
  return Exit.match(up, {
    onSuccess: (value) => Effect.succeed(value as Schema.Schema.Type<Current>),
    onFailure: () =>
      Effect.fail(failDecode({ serviceKey, leaf, from: fromVersion }, schemaVersion(versioned))),
  });
};

/**
 * Encode a tip value down to `toVersion` (for an older peer).
 *
 * @since 0.9.0
 * @category codecs
 * @public
 */
export const encodeToVersion = <Current extends Schema.Top>(
  versioned: VersionedSchema<Current, Schema.Top>,
  toVersion: string,
  tipValue: Schema.Schema.Type<Current>,
  options?: { readonly serviceKey?: string; readonly leaf?: string },
): Effect.Effect<unknown, MigrationPathMissing | MigrationDecodeFailed> => {
  const serviceKey = options?.serviceKey ?? "";
  const leaf = options?.leaf ?? "payload";
  const steps = versioned[VersionedTypeId].steps;
  const toIndex = indexOfVersion(versioned, toVersion);
  if (toIndex < 0) {
    return Effect.fail(
      new MigrationPathMissing({
        serviceKey,
        leaf,
        from: schemaVersion(versioned),
        to: toVersion,
      }),
    );
  }
  // Compose target → … → tip as one Schema (Type = tip, Encoded = target tip encoding),
  // then encode once — avoids Encoded/Type mismatch when stepping down the chain.
  let composed: Schema.Top = steps[toIndex]!.schema;
  for (let i = toIndex + 1; i < steps.length; i++) {
    const step = steps[i]!;
    const transform = step.fromPrevious;
    if (transform === undefined) continue;
    composed = stepSchema(composed, step.schema, transform);
  }
  const encoded = Schema.encodeUnknownExit(
    asCodec<Schema.Schema.Type<Current>>(composed),
  )(tipValue);
  return Exit.isSuccess(encoded)
    ? Effect.succeed(encoded.value)
    : Effect.fail(
        failDecode({ serviceKey, leaf, from: schemaVersion(versioned) }, toVersion),
      );
};

/**
 * Wire Schema for a Versioned carrier (same as the carrier itself — Type = tip).
 *
 * @since 0.9.0
 * @category codecs
 * @public
 */
export const wireSchema = <Current extends Schema.Top>(
  versioned: VersionedSchema<Current, Schema.Top>,
): Schema.Top => versioned;

/**
 * Resolve the Schema used on the wire for a WorkPool payload.
 *
 * @internal
 */
export const payloadWireSchema = (payload: Schema.Top): Schema.Top =>
  isVersioned(payload) ? payload : payload;

/** Same Symbol.for key as WorkPool `itemSchemaSym`. @internal */
const workPoolItemSchemaSym = Symbol.for("hyperlink-ts/WorkPool/itemSchema");

/**
 * WorkPool `itemSchema` stamped on a served tag, when present.
 *
 * @internal
 */
export const itemSchemaOf = (tag: unknown): unknown => {
  if (
    (typeof tag === "object" || typeof tag === "function") &&
    tag !== null &&
    workPoolItemSchemaSym in tag
  ) {
    return Reflect.get(tag, workPoolItemSchemaSym);
  }
  return undefined;
};

/**
 * Whether `from` is the tip or an intermediate step of a Versioned (or plain) schema.
 *
 * @internal
 */
export const versionInChain = (schema: unknown, from: string): boolean => {
  if (!isVersioned(schema)) {
    return Schema.isSchema(schema) && schemaVersion(schema) === from;
  }
  return schema[VersionedTypeId].steps.some((step) => step.version === from);
};

/**
 * Tip `schemaVersion` for a served tag when it carries a WorkPool item schema.
 *
 * @internal
 */
export const schemaVersionFromTag = (tag: unknown): string | undefined => {
  const item = itemSchemaOf(tag);
  if (Schema.isSchema(item)) return schemaVersion(item);
  return undefined;
};

/**
 * Decode a persisted/opaque payload using an optional stamped version.
 *
 * @internal
 */
export const decodePersisted = (
  itemSchema: Schema.Top,
  fromVersion: string | undefined,
  encoded: unknown,
  options?: { readonly serviceKey?: string },
): Effect.Effect<unknown, MigrationPathMissing | MigrationDecodeFailed> => {
  if (isVersioned(itemSchema)) {
    const version = fromVersion ?? schemaVersion(itemSchema);
    return decodeFromVersion(itemSchema, version, encoded, {
      serviceKey: options?.serviceKey,
      leaf: "payload",
    });
  }
  const decoded = Schema.decodeUnknownExit(asCodec(itemSchema))(encoded);
  return Exit.isSuccess(decoded)
    ? Effect.succeed(decoded.value)
    : Effect.fail(
        new MigrationDecodeFailed({
          serviceKey: options?.serviceKey ?? "",
          leaf: "payload",
          from: fromVersion ?? schemaVersion(itemSchema),
          step: schemaVersion(itemSchema),
        }),
      );
};
