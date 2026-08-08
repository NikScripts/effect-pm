/**
 * **Versioned** — contiguous Schema migration chains for cross-version handoff.
 *
 * Consume as `import * as Versioned from "hyperlink-ts/Versioned"`.
 *
 * Tip identity is per schema (`Schema.Class.identifier` or AST content-hash) via
 * {@link schemaVersion}. The chain composes transforms only — it is not a separately
 * named entity. App code always speaks the current tip; codecs on seams apply
 * {@link decodeFromVersion} / {@link wireSchema} automatically where wired
 * (WorkPool payload, durable reopen, handoff).
 *
 * @see `docs/handoffs/versioned-schema-decisions.md`
 * @see `docs/guides/versioned.md`
 * @module Versioned
 */
export {
  make,
  isVersioned,
  schemaVersion,
  wireSchema,
  decodeFromVersion,
  encodeToVersion,
  MigrationPathMissing,
  MigrationDecodeFailed,
  VersionedTypeId,
} from "./internal/versioned";
export type { VersionedSchema } from "./internal/versioned";
