/**
 * @module tui/make
 *
 * `make(record, runtime)` — build a terminal dashboard from the **same**
 * `Record<string, tag>` that {@link cli} turns into a CLI. It's the TUI
 * projection of a set of `Hyperlink` specs: each entry becomes a **widget**, and
 * each widget falls out of the contract via `methodMeta` —
 *
 * - **query, no payload** → a live read field (name: value), refreshed on actions;
 * - **anything else** (a `mutate`, or a query with a payload) → a numbered
 *   **action**: no-payload actions fire on the number key; actions with a payload
 *   open the command bar prefilled (`name field=…`), coerced from the field schema.
 *
 * For a `Group.Service`, prefer {@link Dashboard} / {@link layer} (Group nav + kind widgets).
 * `make` remains the generic contract-driven grid for a flat `Record` of tags.
 */

import { Box, Text, useApp, useInput, useStdout } from "ink";
import * as React from "react";
import { Effect } from "effect";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import {
  methodMeta,
  specOf,
  isVoidCommand,
  type AnyMethod,
  type AnyLocalMethod,
  type AnyDefaultMethod,
  type FlatSpec,
} from "../Hyperlink";
import {
  RegistryProvider,
  useAtomSet,
  useAtomValue,
} from "../ui/atom-react";
import type { CliHyperlinkTag } from "../cli/index";
import { retype } from "../internal/nodeServerCommon";

/** @public */
export type AnyTag = CliHyperlinkTag;

// Wire RPC only — skip local + Tag-baked default (neither carries `kind`).
const isWireMethod = (
  m: AnyMethod | AnyLocalMethod | AnyDefaultMethod,
): m is AnyMethod => "kind" in m;

interface QueryField {
  readonly name: string;
  readonly atom: Atom.Atom<AsyncResult.AsyncResult<unknown, unknown>>;
}

interface ActionField {
  readonly name: string;
  readonly destructive: boolean;
  readonly fields: ReadonlyArray<readonly [string, "number" | "boolean" | "string"]>;
  readonly atom: Atom.AtomResultFn<unknown, unknown, unknown>;
}

interface WidgetModel {
  readonly key: string;
  readonly title: string;
  readonly queries: ReadonlyArray<QueryField>;
  readonly actions: ReadonlyArray<ActionField>;
}

const fieldKind = (tag: string): "number" | "boolean" | "string" =>
  tag === "Number" ? "number" : tag === "Boolean" ? "boolean" : "string";

// Build the UI model for one tag — a heterogeneous-record sibling of
// makeHyperlinkAtoms (which needs the precise per-tag type). Atom values are
// `unknown`; a dashboard renders them as text and dispatches actions by name.
const buildWidget = (
  runtime: Atom.AtomRuntime<unknown, unknown>,
  key: string,
  tag: AnyTag,
): WidgetModel => {
  const reactivityKey = [tag.key];
  const call = (service: unknown, name: string): unknown =>
    (service as Record<string, unknown>)[name];

  const queries: Array<QueryField> = [];
  const actions: Array<ActionField> = [];

  for (const [name, spec] of Object.entries(specOf(tag) as unknown as FlatSpec)) {
    // local methods (streams / local-only capabilities) carry no payload and aren't
    // rendered by the generic form — skip them (narrows to the rpc Method type).
    if (!isWireMethod(spec)) {
      continue;
    }
    const method = spec;
    const meta = methodMeta(method);
    const hasPayload = method.payload !== undefined;
    if (!hasPayload && meta.kind === "query" && !isVoidCommand(method)) {
      queries.push({
        name,
        atom: Atom.withReactivity(reactivityKey)(
          runtime.atom(
            Effect.gen(function* () {
              const service = yield* retype<Effect.Effect<unknown, never, never>>(tag as never);
              return yield* (call(service, name) as Effect.Effect<unknown>);
            }),
          ),
        ),
      });
    } else {
      const payloadFields =
        hasPayload && method.payload !== undefined && !("ast" in method.payload)
          ? Object.entries(method.payload)
          : [];
      const fields = payloadFields.map(
        ([f, schema]) => [f, fieldKind((schema as { ast: { _tag: string } }).ast._tag)] as const,
      );
      actions.push({
        name,
        destructive: meta.destructive,
        fields,
        atom: runtime.fn(
          (arg: unknown) =>
            Effect.gen(function* () {
              const service = yield* retype<Effect.Effect<unknown, never, never>>(tag as never);
              const target = call(service, name);
              return yield* (hasPayload
                ? (target as (p: unknown) => Effect.Effect<unknown>)(arg)
                : (target as Effect.Effect<unknown>));
            }),
          { reactivityKeys: reactivityKey },
        ),
      });
    }
  }
  return { key, title: tag.description ?? key, queries, actions };
};

const showValue = (value: unknown): string => {
  if (value === undefined || value === null) return "ok";
  if (Array.isArray(value)) return value.length === 0 ? "(empty)" : value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

// `field=value field=value` → a payload object, coerced by the field's kind.
const parsePayload = (
  args: ReadonlyArray<string>,
  fields: ActionField["fields"],
): Record<string, unknown> => {
  const kinds = new Map(fields);
  const out: Record<string, unknown> = {};
  for (const token of args) {
    const eq = token.indexOf("=");
    if (eq <= 0) continue;
    const k = token.slice(0, eq);
    const raw = token.slice(eq + 1);
    const kind = kinds.get(k);
    out[k] =
      kind === "number" ? Number(raw) : kind === "boolean" ? raw === "true" : raw;
  }
  return out;
};

const CELL_WIDTH = 30;
const CELL_HEIGHT = 8;

const QueryLine = (props: { readonly field: QueryField }): React.ReactElement => {
  const result = useAtomValue(props.field.atom);
  const text = AsyncResult.isSuccess(result) ? showValue(result.value) : "…";
  return (
    <Text>
      <Text dimColor>{props.field.name} </Text>
      <Text bold>{text}</Text>
    </Text>
  );
};

const Widget = (props: {
  readonly model: WidgetModel;
  readonly selected: boolean;
}): React.ReactElement => {
  const { model, selected } = props;
  return (
    <Box
      flexDirection="column"
      borderStyle={selected ? "double" : "round"}
      borderColor={selected ? "green" : "gray"}
      width={CELL_WIDTH}
      height={CELL_HEIGHT}
      paddingX={1}
      marginRight={1}
      marginBottom={1}
    >
      <Text bold color="cyan">
        {model.title}
      </Text>
      {model.queries.slice(0, 3).map((q) => (
        <QueryLine key={q.name} field={q} />
      ))}
      {model.actions.length > 0 ? (
        <Text dimColor wrap="truncate">
          {model.actions
            .map((a, i) => `${i + 1} ${a.name}${a.fields.length > 0 ? "…" : ""}`)
            .join("  ")}
        </Text>
      ) : null}
    </Box>
  );
};

/**
 * Build the Ink app for a record of resource tags.
 *
 * @public
 */
export const make = <R, ER>(
  record: Record<string, AnyTag>,
  runtime: Atom.AtomRuntime<R, ER>,
) => {
  // Boundary: a heterogeneous record builds atoms structurally (R = unknown);
  // the runtime's layer provides every tag's service at run time. (Same edge as cli.)
  const rt = runtime as Atom.AtomRuntime<unknown, unknown>;
  const widgets = Object.entries(record).map(([key, tag]) =>
    buildWidget(rt, key, tag),
  );
  const first = widgets[0];
  if (first === undefined) {
    throw new Error("tui.make: empty record");
  }

  const Dashboard = (): React.ReactElement => {
    const { exit } = useApp();
    const { stdout } = useStdout();
    const cols = stdout?.columns ?? 80;
    const rows = stdout?.rows ?? 24;

    const [sel, setSel] = React.useState(0);
    const [mode, setMode] = React.useState<"Normal" | "Command">("Normal");
    const [cmd, setCmd] = React.useState("");
    const [msg, setMsg] = React.useState("press a number to act · : for command");

    // One setter per action (stable: widgets/actions are fixed at build time).
    // eslint-disable-next-line react-hooks/rules-of-hooks -- fixed widget tree from `make`
    const setters = widgets.map((w) => w.actions.map((a) => useAtomSet(a.atom)));

    const selected = widgets[sel] ?? first;

    const invoke = (action: ActionField, setter: (arg: unknown) => void, args: ReadonlyArray<string>) => {
      const payload =
        action.fields.length > 0 ? parsePayload(args, action.fields) : undefined;
      setter(payload);
      setMsg(
        `${action.name}${payload !== undefined ? ` ${JSON.stringify(payload)}` : ""} → ok`,
      );
    };

    const runCommand = (line: string) => {
      const parts = line.trim().split(/\s+/).filter(Boolean);
      const verb = parts[0];
      if (verb === undefined) return;
      if (verb === "q" || verb === "quit") {
        exit();
        return;
      }
      const idx = selected.actions.findIndex((a) => a.name === verb);
      if (idx < 0) {
        setMsg(`no action "${verb}" on ${selected.key}`);
        return;
      }
      const action = selected.actions[idx];
      const setter = setters[sel]?.[idx];
      if (action !== undefined && setter !== undefined) {
        invoke(action, setter, parts.slice(1));
      }
    };

    useInput((input, key) => {
      if (mode === "Command") {
        if (key.return) {
          runCommand(cmd);
          setCmd("");
          setMode("Normal");
        } else if (key.escape) {
          setCmd("");
          setMode("Normal");
        } else if (key.backspace || key.delete) {
          setCmd((c) => c.slice(0, -1));
        } else if (input.length > 0 && !key.ctrl && !key.meta) {
          setCmd((c) => c + input);
        }
        return;
      }
      if (input === ":") {
        setMode("Command");
        setCmd("");
      } else if (key.leftArrow || input === "h") {
        setSel((s) => Math.max(0, s - 1));
      } else if (key.rightArrow || input === "l") {
        setSel((s) => Math.min(widgets.length - 1, s + 1));
      } else if (input === "q") {
        exit();
      } else if (input >= "1" && input <= "9") {
        const idx = Number(input) - 1;
        const action = selected.actions[idx];
        const setter = setters[sel]?.[idx];
        if (action !== undefined && setter !== undefined) {
          if (action.fields.length > 0) {
            // needs args → open the command bar prefilled
            setMode("Command");
            setCmd(`${action.name} `);
            setMsg(`args: ${action.fields.map(([f, k]) => `${f}=<${k}>`).join(" ")}`);
          } else {
            invoke(action, setter, []);
          }
        }
      }
    });

    const perRow = Math.max(1, Math.floor((cols - 2) / (CELL_WIDTH + 1)));

    return (
      <Box flexDirection="column" width={cols} height={rows}>
        <Box paddingX={1}>
          <Text bold color="black" backgroundColor="cyan">
            {" ⬢ resources "}
          </Text>
          <Text dimColor> {widgets.length} · {perRow}/row</Text>
        </Box>

        <Box flexGrow={1} flexDirection="row" flexWrap="wrap" padding={1}>
          {widgets.map((w, i) => (
            <Widget key={w.key} model={w} selected={i === sel} />
          ))}
        </Box>

        <Box flexDirection="column">
          <Box borderStyle="round" borderColor="gray" paddingX={1}>
            {mode === "Command" ? (
              <Text color="yellowBright">
                :{cmd}
                <Text inverse> </Text>
              </Text>
            ) : (
              <Text dimColor>{msg}</Text>
            )}
          </Box>
          <Box paddingX={1} backgroundColor="gray">
            <Text color="greenBright" bold>
              ▸ {selected.key}
            </Text>
            <Text dimColor>
              {"   [←→] select  [1-9] act  [:] command  [q] quit"}
            </Text>
          </Box>
        </Box>
      </Box>
    );
  };

  const App = (): React.ReactElement => (
    <RegistryProvider>
      <Dashboard />
    </RegistryProvider>
  );

  return { App };
};
