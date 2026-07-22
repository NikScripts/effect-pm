# Rename: effect-pm → Effect Hyperlink (`hyperlink-ts`)

Owner decision, 2026-07-21. This doc is the SSOT for the rename — work from it, do not
re-derive the naming from chat history.

## The decision

- **Brand: "Effect Hyperlink". npm package: `hyperlink-ts`.**
- The pitch (use it in the README): *the web made documents location-transparent;
  Effect Hyperlink does it for services.*
- **The primitive `Resource` is REPLACED by `Hyperlink`** — this was an explicit owner
  requirement: the new name names the thing you declare, not just the package.
  `class Emails extends Hyperlink.Tag<Emails>()("app/Emails", { … }) {}`

## Kind renames — the `*Resource` types (owner-locked 2026-07-22)

Generic, pattern-free nouns — **not** a `*Resource`/`*Link` suffix. "What would Effect do" applied
throughout: behavior-named peer constructors, `with*` reserved for aspect config, inference over
overloads. Two of the old kinds **collapse** into others, so the public kind list shrinks.

| Today | New | Notes |
|---|---|---|
| `Resource` | **`Hyperlink`** | core namespace + the thing you declare |
| `QueueResource` | **`WorkPool`** | |
| `CustomQueueResource` | **`WorkPool.priority(…)`** | FOLD IN as a behavior-named **peer constructor** beside `WorkPool.Tag` (Effect's `Queue.bounded`/`dropping` shape). NOT an overload on `.Tag`, NOT `.leveled`, NOT `withLane` (a `with*` is an aspect modifier; lanes change the *contract* — wire level union + `add(item, lane?)`), NOT `makeCustom`. Keep the leveled **engine its own internal module** (the tree-shake split that deferred this rename before). Sweep the mixed `level`/`lane`/`priority` vocab (`levelCount`/`namedLevels`/`add(item, level?)`) to ONE term. |
| `RunResource` | **`Gate`** | it's a concurrency gate for effects, not a process runner |
| `HttpApiResource` | **`Gate.httpApiClient(…)`** | FOLD IN — the module *is* a `Semaphore` gate over the HttpClient transport (`HttpClientRunGate.withRunner` wrapping `HttpApiClient.make`) + per-endpoint metrics. Peer constructor beside `Gate.Tag`. Takes an HttpApi *schema*, builds+gates the client → name describes the output. `HttpClientRunGate` stays the shared internal engine. |
| `Process` | **`Daemon`** | supervised long-running process |
| `NodeStatus` | **node accessor** — `node.pulse` / `Hyperlink.status(node)` | Reserved resource every node auto-serves. It MUST stay a served RPC resource on the wire (live server-side state — uptime, per-resource readiness, contract hashes, logs relay — can't be static node data; only a served resource answers over the transport). But DEMOTE the public surface: no user declares a `NodeStatus.Tag`; expose it as a **node accessor**. `Pulse` is the name only if that accessor is first-class. Ties into the deferred host-health/reserved-prefix idea. |
| `BuiltResource` / `ServedResource` | `BuiltLink`/`ServedLink` or generic `Built`/`Served` | structural shapes, not kinds — pick during the sweep, low stakes |

Before locking the short names, **check `Gate` / `priority` / `pulse` against Effect's namespace**
(the `Queue`-collision lesson).

## Already secured on npm (owner's account: `nikolasstow`)

- `hyperlink-ts@0.0.1` — THE package name (placeholder published 2026-07-21).
- `effect-hyperlink@0.0.1` — published as a brand signpost. ⚠️ OWNER DECISION PENDING:
  keep as a "you want hyperlink-ts" pointer, or unpublish — the clean-unpublish window
  closes ~2026-07-24. Ask before it lapses.
- Also owned (earlier candidate, superseded): `torsor-ts@0.0.1`. Leave it.
- Bare `hyperlink` is a real maintained project (link checker) — never claimable; the
  brand does not depend on it.

## Rename scope (in dependency order)

1. **Module**: `src/Resource.ts` → the `Hyperlink` namespace (`import * as Hyperlink from
   "hyperlink-ts/Hyperlink"` — final subpath naming is part of this work; keep the
   `import * as X` namespace convention).
2. **Package identity**: `package.json` name → `hyperlink-ts`; subpath exports;
   `@nikscripts` scope stays unless the owner says otherwise.
3. **Every `Resource.` call site** — src, examples, test, docs (guides use it in twoslash
   blocks; they typecheck, so misses fail loudly).
4. **Docs site**: glossary entries (Resource/Tag/Contract/Handle), nav, api-slugs, the
   `@pm/Resource` aliases, search corpus + llms regen, README, hero copy.
5. **Changeset**: this is THE breaking change of the next release; write it prominently.

## Precedent & tooling

The `Node.Tag` two-stage break migrated 148 call sites with a regex sweep + full gates —
see commit 6972d5558 and its migration script pattern. Reuse the approach: regex the call
forms, then let tsc + docs twoslash find the stragglers.

## Constraints (house rules that bit before)

- Editing `docs/site/src/lib/**` or `docs/docgen/**` re-keys the hover cache → a ~1.5 h
  background gen-hovers re-stamp. Batch such edits.
- After the sweep: gen-api → gen-search → gen-llms → check-links must all pass; the
  byte-diff discipline doesn't apply (this is an intentional full-surface change).
- Full root tsc + tests + effect-language-service on touched files; docs suite; the
  works. No `as` casts, exported interfaces, camelCase values.
- "What would effect do" is the standing design tiebreaker (see memory/feedback).

## Known context, NOT this work's fault

The 17 node-transport test failures that were on integration's tip are **RESOLVED** (2026-07-22,
merge `63b51ea1a`). Root cause: default-on client verify probes real sockets with real-time
`Effect.sleep`/`Effect.timeout`, which deadlock under `@effect/vitest`'s `it.effect` virtual
`TestClock`. Fix: real-transport verify tests run under `it.live`; the browser-guard `ws` test opts
out via `Resource.clientVerify(false)`. **House rule for the rename:** any test that builds a real
client+server (thus hits default-on verify) MUST use `it.live`, never `it.effect` — if the sweep
touches those tests, keep them `it.live`.

## Open questions for the owner (ask, don't assume)

1. `effect-hyperlink`: keep as signpost or unpublish (deadline above)?
2. GitHub repo rename (effect-pm → ?) and the `@nikscripts` scope question.
3. Docs domain (blocks DOCS_SITE_ORIGIN, the banner stamp, and deploy — see
   docs/site/deploy/README.md).
