/**
 * @module cli
 *
 * Build a **CLI + default TUI** from a `Group.Tag` (or a `{ name: tag }` record) — the
 * control surface counterpart to `<Dashboard group={Fleet} />`.
 *
 * - `hyperlink` → open the TUI at the root
 * - `hyperlink my-queue` → open the TUI focused on that resource (or group subtree)
 * - `hyperlink my-queue pause` → run-and-exit CLI verb
 *
 * The TUI is optional: handlers call {@link openTui}, which reads {@link Tui} via
 * `Effect.serviceOption`. Provide `layer` from `hyperlink-ts/tui` to enable dashboards;
 * without it, a path with no action fails as {@link TuiNotConfigured}.
 *
 * This module is **not** a shipped `hyperlink` / `hl` binary. Import as
 * `Hyperlink.cli` (re-exported from `hyperlink-ts/Hyperlink`) or from `hyperlink-ts/cli`.
 * The private repo-dev gate CLI is **`hyp`** and is unrelated.
 *
 * ```ts
 * import * as Hyperlink from "hyperlink-ts/Hyperlink"
 * import { layer as tuiLayer } from "hyperlink-ts/tui"
 *
 * Hyperlink.cli(Fleet, { name: "hyperlink", version })(args).pipe(
 *   Effect.provide(Layer.mergeAll(appLayer, tuiLayer)),
 * )
 * ```
 *
 */
import { Console, Effect, type Schema } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import * as Group from "../Group";
import { methodMeta, specOf } from "../Hyperlink";
import type { AnyLocalMethod, AnyMethod, FlatSpec } from "../Hyperlink";
import { openTui } from "./Tui";
import type { CliHyperlinkTag, CliNode, CliTree } from "./types";

export type { CliGroup, CliHyperlinkTag, CliNode, CliTree } from "./types";
export { openTui, Tui, TuiNotConfigured, type TuiOpenInput } from "./Tui";

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
const methodCommand = (name: string, method: AnyMethod, tag: CliHyperlinkTag) => {
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

const membersOf = (tree: CliTree): Record<string, CliNode> =>
  Group.isGroup(tree) ? Group.members(tree) : tree;

/** Flatten a node to leaf tags keyed by slash-joined command path segments. */
export const leavesOf = (
  node: CliNode,
  path: ReadonlyArray<string> = [],
): Record<string, CliHyperlinkTag> => {
  if (Group.isGroup(node)) {
    const out: Record<string, CliHyperlinkTag> = {};
    for (const [name, child] of Object.entries(Group.members(node))) {
      Object.assign(out, leavesOf(child as CliNode, [...path, name]));
    }
    return out;
  }
  const key = path.length > 0 ? path.join("/") : node.key;
  return { [key]: node };
};

// Heterogeneous tree: group vs leaf handlers widen error/context; keep the builder unblocked.
// Effect CLI types an empty config as `{}` — match that, don't invent a wider object type.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- Effect CLI Command config
type AnyCliCommand = Command.Command<string, {}, {}, never, never>;

const nodeCommand = (
  name: string,
  node: CliNode,
  path: ReadonlyArray<string>,
  root: CliTree,
): AnyCliCommand => {
  const here = [...path, name];
  if (Group.isGroup(node)) {
    const kids = Object.entries(Group.members(node)).map(([childName, child]) =>
      nodeCommand(childName, child as CliNode, here, root),
    );
    return Command.make(name).pipe(
      Command.withDescription(`group ${node.key}`),
      // Same tree the web Dashboard gets — path focuses the subgroup (parity with `/Mini`).
      Command.withHandler(() => openTui({ tree: root, path: here })),
      Command.withSubcommands(kids),
    ) as AnyCliCommand;
  }
  return Command.make(name).pipe(
    Command.withDescription(node.description ?? `commands for ${name}`),
    Command.withHandler(() => openTui({ tree: root, path: here })),
    Command.withSubcommands(
      Object.entries(specOf(node) as unknown as FlatSpec).flatMap(([method, spec]) =>
        isCliMethod(spec) ? [methodCommand(method, spec, node)] : [],
      ),
    ),
  ) as AnyCliCommand;
};

const buildCommand = (tree: CliTree, rootName: string) => {
  const members = membersOf(tree);
  const namespaces = Object.entries(members).map(([name, node]) =>
    nodeCommand(name, node, [], tree),
  );
  // Group → flatten leaves by path; flat record → keep command names as keys.
  const rootFocus: Record<string, CliHyperlinkTag> = Group.isGroup(tree)
    ? leavesOf(tree)
    : Object.fromEntries(
        Object.entries(members).flatMap(([name, node]) =>
          Group.isGroup(node)
            ? Object.entries(leavesOf(node, [name]))
            : [[name, node as CliHyperlinkTag]],
        ),
      );
  const width = Object.keys(rootFocus).reduce((max, name) => Math.max(max, name.length), 0);
  const ls = Command.make("ls").pipe(
    Command.withDescription("List resources (command name → id)."),
    Command.withHandler(() =>
      Console.log(
        Object.entries(rootFocus)
          .map(([name, tag]) => `  ${name.padEnd(width)}  ${tag.key}`)
          .join("\n"),
      ),
    ),
  );
  return Command.make(rootName).pipe(
    Command.withDescription("Resource CLI — bare path opens the TUI when configured."),
    Command.withHandler(() => openTui({ tree, path: [] })),
    Command.withSubcommands([...namespaces, ls]),
  );
};

export type CliOptions = {
  readonly name?: string;
  readonly version: string;
};

/**
 * Args runner from the options overload of {@link cli}. Provide resource + TUI layers
 * when you run it.
 *
 * @public
 */
export type CliRun = (
  args: ReadonlyArray<string>,
) => Effect.Effect<void, unknown, unknown>;

/**
 * Name a list of leaf tags by the **shortest unique slash-suffix** of each key —
 * `@acme/Mail` → `Mail`; collisions lengthen (`Regional/RegionUS`). Prefer a `Group.Tag`
 * when you have one — command paths then follow the group.
 *
 * @public
 */
export const byName = <T extends CliHyperlinkTag>(
  tags: ReadonlyArray<T>,
): Record<string, T> => {
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

/**
 * Build the Hyperlink control surface from a {@link CliTree}.
 *
 * - `cli(Fleet, "hyperlink")` → Effect `Command` (wire with `Command.runWith`)
 * - `cli(Fleet, { name: "hyperlink", version })` → {@link CliRun} (runWith baked in)
 *
 * @public
 */
export const cli: {
  (tree: CliTree, rootName?: string): ReturnType<typeof buildCommand>;
  (tree: CliTree, options: CliOptions): CliRun;
} = ((tree: CliTree, second?: string | CliOptions) => {
  if (typeof second === "object" && second !== null) {
    return Command.runWith(buildCommand(tree, second.name ?? "cli"), {
      version: second.version,
    });
  }
  return buildCommand(tree, second ?? "cli");
}) as typeof cli;
