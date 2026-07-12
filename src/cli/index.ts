/**
 * @module cli
 *
 * Build a **run-and-exit CLI from your resource `Tag`s** — the CLI counterpart to the
 * `web` widgets. Each resource becomes a subcommand namespace; each contract method
 * (query / mutate) becomes a verb, its flags derived from the payload schema and its help
 * text from the contract metadata (`specOf` / `methodMeta`). Streams are skipped — they
 * have no run-and-exit form (use their one-shot peers, e.g. `status.get` / `logs.query`).
 *
 * Location-transparent: provide a local layer (the resource runs in-process) or a
 * `Resource.client` + transport (drives a running server) when you run it — the command
 * tree is identical.
 *
 * ```ts
 * import { makeResourceCli, resourcesByName } from "@nikscripts/effect-pm/cli";
 * import { Command } from "effect/unstable/cli";
 *
 * const cli = makeResourceCli(resourcesByName([Mail, Jobs, KeyRotation]), "pm");
 * // pm Mail status.get · pm Mail pause · pm KeyRotation start · pm ls
 * Command.runWith(cli, { version })(process.argv.slice(2)).pipe(Effect.provide(appLayer));
 * ```
 *
 */
import { Console, Effect, type Schema } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { methodMeta, specOf } from "../Resource";
import type { AnyLocalMethod, AnyMethod, FlatSpec } from "../Resource";

/**
 * The structural shape the CLI reads from a resource tag: yieldable (→ its service), with
 * `key` / `description` and the stowed contract spec. A `Resource.Tag` / `QueueResource.Tag`
 * / `Process.Tag` class satisfies this — pass the classes directly.
 *
 */
export type CliResourceTag = Effect.Effect<unknown, never, unknown> & {
  readonly key: string;
  readonly description: string | undefined;
} & Parameters<typeof specOf>[0];

// A spec entry is a runnable CLI verb when it's a wire method (`kind`: query/mutate) that
// isn't a streaming read. Streams have no run-and-exit form; local methods aren't on the wire.
const isCliMethod = (m: AnyMethod | AnyLocalMethod): m is AnyMethod =>
  "kind" in m && m.stream !== true;

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
      return Flag.string(name);
    case "Number":
      return Flag.float(name);
    case "Boolean":
      return Flag.boolean(name);
    default:
      return undefined;
  }
};

const flagsOf = (method: AnyMethod): Record<string, Flag.Flag<unknown>> => {
  const payload = method.payload;
  // No payload, or a whole-Schema payload (e.g. `Schema.Array(entry)`) that isn't a record
  // of named fields → no flags to derive.
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

/**
 * The default output formatter: scalars plain, arrays as one item per line, structs as
 * aligned `key  value` rows. Exported so you can reuse or wrap it.
 *
 */
export const render = (value: unknown): string => {
  if (value === undefined || value === null) {
    return "ok";
  }
  if (typeof value !== "object") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? "(empty)" : value.map((item) => `  ${renderInline(item)}`).join("\n");
  }
  const entries = Object.entries(value);
  if (entries.length === 0) {
    return "(empty)";
  }
  const width = entries.reduce((max, [key]) => Math.max(max, key.length), 0);
  return entries.map(([key, val]) => `  ${key.padEnd(width)}  ${renderInline(val)}`).join("\n");
};

/** One method → its subcommand. The handler `yield* tag` then calls the method; dispatch is
 *  dynamic over a heterogeneous record, so the service/method are read through `unknown`. */
const methodCommand = (name: string, method: AnyMethod, tag: CliResourceTag) => {
  const hasPayload = method.payload !== undefined;
  const command = Command.make(name, flagsOf(method)).pipe(Command.withDescription(describe(name, method)));
  return Command.withHandler((input: Record<string, unknown>) =>
    Effect.gen(function* () {
      const service = (yield* tag) as Record<string, unknown>;
      const target = service[name];
      const result = yield* (hasPayload
        ? (target as (p: unknown) => Effect.Effect<unknown>)(input)
        : (target as Effect.Effect<unknown>));
      yield* Console.log(render(result));
    }),
  )(command);
};

/**
 * Build a CLI from a record of resource tags (`{ commandName: tag }`). Each entry is a
 * subcommand namespace exposing the tag's query/mutate verbs; a `<root> ls` lists the
 * resources. `rootName` is the top command name. Returns an `effect/unstable/cli`
 * `Command` — drive it with `Command.runWith` and provide the resources' layer.
 *
 */
export const makeResourceCli = (resources: Record<string, CliResourceTag>, rootName = "cli") => {
  const namespaces = Object.entries(resources).map(([name, tag]) =>
    Command.make(name).pipe(
      Command.withDescription(tag.description ?? `commands for ${name}`),
      Command.withSubcommands(
        Object.entries(specOf(tag) as unknown as FlatSpec).flatMap(([method, spec]) =>
          isCliMethod(spec) ? [methodCommand(method, spec, tag)] : [],
        ),
      ),
    ),
  );
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

/**
 * Name a list of tags by the **shortest unique slash-suffix** of each key — `@acme/Mail` →
 * `Mail`; only on a collision are the clashing keys lengthened (`Regional/RegionUS`). Returns
 * the `{ commandName: tag }` record {@link makeResourceCli} takes. Adding a resource never
 * renames an existing command unless it actually collides.
 *
 */
export const resourcesByName = <T extends CliResourceTag>(tags: ReadonlyArray<T>): Record<string, T> => {
  const segments = (id: string): ReadonlyArray<string> => id.split("/").filter((s) => s.length > 0);
  const suffix = (id: string, n: number): string => segments(id).slice(-n).join("/");
  const nameOf = (id: string): string => {
    const depth = segments(id).length;
    for (let n = 1; n <= depth; n += 1) {
      const candidate = suffix(id, n);
      if (tags.filter((t) => suffix(t.key, n) === candidate).length === 1) {
        return candidate;
      }
    }
    return id;
  };
  return Object.fromEntries(tags.map((t) => [nameOf(t.key), t]));
};
