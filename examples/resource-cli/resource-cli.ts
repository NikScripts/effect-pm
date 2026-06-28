/**
 * @module examples/resource-cli/resource-cli
 *
 * `makeResourceCli({ name: tag, … })` — build a CLI from a `Record` of `Resource`
 * tags. Each entry is a subcommand namespace; each method of a tag's spec becomes
 * a subcommand, its flags derived from the payload schema, its description and
 * `query`/`mutate` label from the contract metadata, its handler `yield* tag` then
 * calling the method. "1 or 100" resources is just a bigger record.
 *
 * Provide a local layer (resource runs in-process) or an RPC client layer (drive a
 * running server) when you run it — location-transparent.
 */

import { Console, Effect, type Schema } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { methodMeta, specOf } from "../../src/Resource";
import type { AnyLocalMethod, AnyMethod } from "../../src/Resource";

// A spec entry is a runnable CLI verb when it's a wire method (`kind`: query/mutate) that
// isn't a streaming read. Streams have no run-and-exit form (their one-shot peers do —
// statusNow, logHistory, …); local methods aren't on the wire at all.
const isCliMethod = (m: AnyMethod | AnyLocalMethod): m is AnyMethod =>
  "kind" in m && m.stream !== true;

// The CLI maps over a heterogeneous record of different resource tags. A precise
// union can't be expressed (the tag identity is invariant), so the values are a
// structural type — yieldable (→ its service) with the bits we read: `id`,
// `description`, and the stowed spec (`specOf`). Dispatch is dynamic (handlers
// cast per method); each method stays typed `AnyMethod` for metadata/flags.
type AnyTag = Effect.Effect<unknown, never, unknown> & {
  readonly key: string;
  readonly description: string | undefined;
} & Parameters<typeof specOf>[0];

const isSchema = (x: unknown): x is Schema.Top =>
  typeof x === "object" && x !== null && "ast" in x;

/** A CLI flag for a primitive payload field, or `undefined` to skip it (optional-wrapped
 *  fields, dates/durations, nested schemas — not expressible as a simple flag). */
const flagFor = (name: string, schema: unknown): Flag.Flag<unknown> | undefined => {
  if (!isSchema(schema)) {
    return undefined;
  }
  switch (schema.ast._tag) {
    case "String":
      return Flag.string(name) as Flag.Flag<unknown>;
    case "Number":
      return Flag.float(name) as Flag.Flag<unknown>;
    case "Boolean":
      return Flag.boolean(name) as Flag.Flag<unknown>;
    default:
      return undefined;
  }
};

const flagsOf = (method: AnyMethod): Record<string, Flag.Flag<unknown>> => {
  const payload = method.payload;
  // No payload, or a whole-Schema payload (e.g. `Schema.Array(entry)`) that isn't a
  // record of named fields → no flags to derive.
  if (payload === undefined || isSchema(payload)) {
    return {};
  }
  const flags: Record<string, Flag.Flag<unknown>> = {};
  for (const [field, schema] of Object.entries(payload)) {
    const flag = flagFor(field, schema);
    if (flag !== undefined) {
      flags[field] = flag;
    }
  }
  return flags;
};

/** Use the declared description, else fall back to the method kind. */
const describe = (name: string, method: AnyMethod): string => {
  const meta = methodMeta(method);
  return meta.description ?? `${meta.kind}: ${name}`;
};

const renderInline = (value: unknown): string =>
  typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);

/** Human-friendly default output: scalars plain, arrays as lines, structs aligned. */
export const render = (value: unknown): string => {
  if (value === undefined || value === null) {
    return "ok";
  }
  if (typeof value !== "object") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.length === 0
      ? "(empty)"
      : value.map((item) => `  ${renderInline(item)}`).join("\n");
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) {
    return "(empty)";
  }
  const width = entries.reduce((max, [key]) => Math.max(max, key.length), 0);
  return entries
    .map(([key, val]) => `  ${key.padEnd(width)}  ${renderInline(val)}`)
    .join("\n");
};

/** One method → its subcommand. */
const methodCommand = (name: string, method: AnyMethod, tag: AnyTag) => {
  const hasPayload = method.payload !== undefined;
  const command = Command.make(name, flagsOf(method)).pipe(
    Command.withDescription(describe(name, method)),
  );
  return Command.withHandler((input: Record<string, unknown>) =>
    Effect.gen(function* () {
      const service = yield* tag;
      const target = (service as Record<string, unknown>)[name];
      const result = yield* (hasPayload
        ? (target as (p: unknown) => Effect.Effect<unknown>)(input)
        : (target as Effect.Effect<unknown>));
      yield* Console.log(render(result));
    }),
  )(command);
};

export const makeResourceCli = (
  resources: Record<string, AnyTag>,
  rootName = "cli",
) => {
  const namespaces = Object.entries(resources).map(([name, tag]) =>
    Command.make(name).pipe(
      Command.withDescription(tag.description ?? `commands for ${name}`),
      Command.withSubcommands(
        Object.entries(specOf(tag)).flatMap(([method, spec]) =>
          isCliMethod(spec) ? [methodCommand(method, spec, tag)] : [],
        ),
      ),
    ),
  );
  // `<root> ls` — the command-name → id map (mirrors the dashboard's resource list).
  const width = Object.keys(resources).reduce((max, name) => Math.max(max, name.length), 0);
  const ls = Command.make("ls").pipe(
    Command.withDescription("List resources (command name → id)."),
    Command.withHandler(() =>
      Console.log(
        Object.entries(resources)
          .map(([name, tag]) => `  ${name.padEnd(width)}  ${tag.key}`)
          .join("\n"),
      ),
    ),
  );
  return Command.make(rootName).pipe(Command.withSubcommands([...namespaces, ls]));
};
