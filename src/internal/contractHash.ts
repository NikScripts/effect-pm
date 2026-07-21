/**
 * Stable wire-contract fingerprint for F4 {@link ContractMismatch} — derived from a tag's
 * groupId, kind, and flat wire Spec (schemas via AST structure). Same Spec ⇒ same hash on
 * client and server; schema / method drift ⇒ mismatch.
 *
 * @module internal/contractHash
 * @internal
 */
import { Hash, Predicate, Schema } from "effect";
import type { AnyMethod, FlatSpec } from "../Resource";

const LocalMethodTypeId = "~nikscripts/effect-pm/Resource/LocalMethod";

/** Strip annotation / encoding noise so two equivalent schemas fingerprint the same. */
const fingerprintAst = (ast: unknown): unknown => {
  const seen = new WeakSet<object>();
  const walk = (node: unknown): unknown => {
    if (node === null || typeof node !== "object") {
      return node;
    }
    if (seen.has(node)) {
      return "[Cycle]";
    }
    seen.add(node);
    if (Array.isArray(node)) {
      return node.map(walk);
    }
    const record = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      if (
        key === "annotations" ||
        key === "encoding" ||
        key === "encodingChecks" ||
        key === "checks" ||
        key === "context" ||
        key.startsWith("~")
      ) {
        continue;
      }
      out[key] = walk(record[key]);
    }
    return out;
  };
  return walk(ast);
};

const fingerprintSchema = (schema: Schema.Top): unknown =>
  fingerprintAst(schema.ast);

/** Payload may be a Schema, Struct.Fields, or absent. */
const fingerprintPayload = (
  payload: Schema.Struct.Fields | Schema.Top | undefined,
): unknown => {
  if (payload === undefined) {
    return null;
  }
  if (Schema.isSchema(payload)) {
    return fingerprintSchema(payload);
  }
  const fields: Record<string, unknown> = {};
  for (const key of Object.keys(payload).sort()) {
    const field = payload[key];
    if (Schema.isSchema(field)) {
      fields[key] = fingerprintSchema(field);
    }
  }
  return { fields };
};

const isLocalMethod = (m: FlatSpec[string]): m is Exclude<FlatSpec[string], AnyMethod> =>
  Predicate.hasProperty(m, LocalMethodTypeId);

const isWireMethod = (m: FlatSpec[string]): m is AnyMethod => !isLocalMethod(m);

/**
 * Canonical wire descriptor for a flat Spec — sorted method keys, wire-only members.
 *
 * @internal
 */
export const contractDescriptor = (
  groupId: string,
  kind: string,
  spec: FlatSpec,
): unknown => {
  const methods: Record<string, unknown> = {};
  for (const key of Object.keys(spec).sort()) {
    const m = spec[key];
    if (m === undefined || !isWireMethod(m)) {
      continue;
    }
    methods[key] = {
      kind: m.kind,
      stream: m.stream,
      payload: fingerprintPayload(m.payload),
      success: fingerprintSchema(m.success),
      error: fingerprintSchema(m.error),
    };
  }
  return { v: 1, groupId, kind, methods };
};

/**
 * Compact hex fingerprint of a resource wire contract.
 *
 * @internal
 */
export const hashContract = (
  groupId: string,
  kind: string,
  spec: FlatSpec,
): string => {
  const canonical = JSON.stringify(contractDescriptor(groupId, kind, spec));
  return (Hash.hash(canonical) >>> 0).toString(16).padStart(8, "0");
};
