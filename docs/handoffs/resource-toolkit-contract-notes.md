# Resource toolkit — contract design notes (locked)

Constraints the toolkit's `Spec`/contract must satisfy so **one contract lights up CLI,
TUI, and dashboard** automatically. Source: owner directive (2026-06-21). Build these into
the spec as resources port onto the toolkit.

## 1. Spec metadata — one field, every tool benefits

- **`description`** on each method + the resource → CLI/TUI help text, dashboard tooltips.
  Cheapest, highest value.
- **Read vs command, explicit (not heuristic).** Each method is a **`query`** (idempotent
  read) or a **`mutate`** (mutation) — encoded by the constructor used. Do **not** infer
  from `void`/payload. Drives: CLI (queries print, mutates confirm), dashboard (read Atom
  vs `runtime.fn`), TUI panes.
- **`destructive`** hint on mutates (`shutdown`/`clear`/`drop`) → CLI `--yes`/confirm, TUI
  warning, dashboard danger styling.

Status: **implemented (Design B).** A method is built by `Resource.query(success, opts?)` /
`Resource.mutate(success, opts?)` (kind = the constructor) and carries tool metadata via
`.annotate({ description, destructive })` — the Effect annotation idiom. `methodMeta()`
reads it; metadata is inert to type inference + the wire contract. `R`/error channels stay
honest (no `satisfies Spec` on specs — it contextually widens the error channel; the
`<const S extends Spec>` constraint validates without widening, and no-error overloads
hardcode `Schema.Never` so the constraint can't bind it). `ResourceTag<Self, S>` exported so
consumers can type tags. `serveInstances` takes variadic `Resource.instance(tag, impl)` (no
tuples). **TODO:** resource-level `description` (thread through `Tag`/`tagFor`).

## 2. The `changes` stream — the live-data primitive (most important for "live")

- Every handle exposes **`changes: Stream<Snapshot>`** — the whole observable state, pushed.
- One-shot reads stay `Effect`s; `changes` is the push source.
- This is the single thing that makes "live" work everywhere: dashboard atoms, CLI
  `--watch`, TUI. Build once in the contract → all three light up.
- Effect queues can't enumerate, so a **snapshot stream** (not "list items") is the shape.

Status: **TODO (next major slice).** Needs: a per-resource `Snapshot` schema, a streaming
rpc in the contract (Effect RPC supports `Rpc.make(tag, { stream: true })`), and the
server side backed by a `SubscriptionRef`/`observed` projection.

## 3. Schema as UX descriptor, not just a validator

Preserve enough schema info for tools to derive UX automatically:

- **optional/default** fields → optional flags with defaults;
- **literal/enum unions** → choice flags / dropdowns;
- **`Redacted`** → masked secret input;
- **branded `Duration`/`DateTime`** → pretty-printed output (keeps the old CLI's
  pretty-ms/table formatting without hand-writing it).

i.e. payload/success schemas must be **rich enough to render flags and output from**.

Status: **TODO.** Mostly a discipline (use rich schemas) + a small "schema → UX hints"
reader the CLI/TUI/dashboard share. Verify the chosen schema features survive RPC encode.
