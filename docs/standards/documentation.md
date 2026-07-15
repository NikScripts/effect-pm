{#documentation title="Documentation" order=50 status="draft" appliesTo=src}
# Documentation

Three kinds of documentation, three different jobs — and each has a shape worth holding to:

- **Doc comments** on the public surface — what a symbol is, for a reader on hover or in the API docs.
- **Inline comments** — the *why* behind a line that a competent junior dev couldn't infer from the code.
- **Narrative docs** — the guides and reference (pages like this one) and the handoffs that teach the
  whole picture.

## Doc comments

{#doc-comment-anatomy .must appliesTo=src}
## A doc comment has a fixed shape

Every exported symbol opens with a `/** … */` doc comment in one order: a **one-sentence summary**
(imperative — what it does and why, never a restatement of the signature), then any detail paragraphs,
then an `@example`, then the marker tags. Describe parameters and the return **in prose** — this
codebase does not use `@param` / `@returns`; they duplicate the types and rot as signatures change.

``` ts
/**
 * Wire a served resource `tag` to a remote over http and get a ready client `Layer` — {@link client}
 * plus the batteries-included transport, bundled. `target` is a port (`3009` → `localhost:3009/rpc`)
 * for a runtime on the same machine, or a full url for one across the network.
 *
 * @example
 * Effect.provide(program, Resource.clientHttp(Emails, 3001))
 *
 * @public
 */
export const clientHttp = /* … */
```

{#example-must-be-real .must appliesTo="src examples"}
## `@example` code is real code

An `@example` compiles against the actual API — real symbol names, real signatures, the call written
the way a caller would write it. An example that wouldn't type-check is worse than none: it teaches the
wrong shape. Lift it from a passing test, or verify it before committing.

``` ts
// ✅ good — the real call
/** @example const total = yield* combineQuery(peers, (p) => p.size, Combine.sum) */

// ❌ bad — invented API that doesn't exist
/** @example const total = peers.sumBy("size") */
```

{#link-related-symbols .should appliesTo=src}
## Cross-reference the surface with `{@link}`

When a doc comment names a related symbol — the layer that provides it, the helper that folds it, the
error it throws — wrap it in `{@link name}` so a reader can navigate the surface instead of grepping
for it. A doc comment is a node in a graph, not an island.

``` ts
/** The resource's peer clients, for its own cross-node logic. Requires {@link peersLayer}; fold them
 *  with {@link combineQuery} / {@link combineStream}. */
```

{#mark-the-surface .must appliesTo=src}
## Mark the surface with `@public` / `@internal` / `@module`

Every export carries exactly one visibility marker: an app-facing symbol is `@public`; a package-only
one is `@internal`. A module opens with a `@module` overview whose name matches the file's primary
export, so a reader lands with context.

``` ts
/**
 * The queue worker namespace — Tag, make, layer, serve.
 * @module QueueResource
 */

/** @public */
export const layer = /* … */

/** @internal */
export const makeQueueEffect = /* … */
```

{#no-since-until-1-0 .must appliesTo=src}
## No `@since` until 1.0

The surface is **fluid** (see *Breaking Changes & Stability*) — nothing has a stable version yet, so a
pre-1.0 `@since` claims a release that doesn't exist and reads as a lock the owner never made. **Never
add `@since` while pre-1.0.** At the 1.0 release, every `@public` symbol gains `@since <release>` in one
motion, alongside `@locked`. Until then, a doc comment ends at its visibility marker.

``` ts
/**
 * …summary…
 * @public
 */
```

## Inline comments

{#comment-for-the-junior-dev .should appliesTo="src examples"}
## Comment what a junior dev couldn't infer

An inline comment carries what the code can't show a competent-but-junior reader: *why* this line, not
what it does. A type-level trick, an Effect layer-ordering constraint, runtime ownership, a timing
subtlety, a non-obvious workaround. If a reader who knows the language would ask "wait, why?", answer
it. If they wouldn't, stay silent — never narrate what the code already says.

``` ts
// ✅ good — answers the "why?" a junior would have
// provideMerge, not provide: a bare provide prunes the serve layers off httpServer
const node = Resource.httpServer([Counter.serve]).pipe(Layer.provideMerge(deps))

// ❌ bad — restates the obvious
const total = a + b // add a and b
```

## Narrative docs

{#show-dont-tell .should appliesTo=docs}
## Show, don't tell

A guide earns trust with real, working code a reader can run — not adjectives about how clean or
powerful the thing is. Lead with the code doing the job and let it carry the claim; cut "effortless",
"elegant", "simply". If a sentence would survive being replaced by a code block, replace it.

``` ts
// ✅ good — the feature, shown
const worker = QueueResource.serve(Emails, { effect: sendEmail }).pipe(nodeServer(3001))

// ❌ bad — telling, not showing
// "effect-pm makes serving a queue across runtimes effortless and elegant."
```

{#narrative-code-is-verified .must appliesTo=docs}
## Code in prose is verified, like any example

A snippet in a guide is held to the same bar as an `@example`: it compiles against the real API before
it ships. A reader will copy it verbatim — a snippet that doesn't type-check teaches the wrong shape
and burns the trust the guide is built on. (How we standardize examples end to end is still being
settled — see the note below.)

{#handoff-is-self-contained .must appliesTo=docs}
## A handoff is self-contained requirements for its reader

A handoff is written for the person who will do the work, not as a first-person letter about what you
did. State what they must build and know — paths, constraints, the real gotchas, the acceptance bar —
so they never have to reconstruct your session to act. If it only makes sense to someone who was there,
it isn't a handoff.

{#glossary-defines-concepts .should appliesTo=docs}
## The glossary defines what the API docs can't

The API reference documents *symbols* — every exported function and type. The **glossary** documents
*concepts*: Tag, Service, Contract, cross-runtime service — the vocabulary a reader needs that no single
export names. Define each such term once, in the glossary, and link to it (`/docs/glossary#term`) the
first time it matters on a page. A term a doc comment already defines belongs in the API docs, not here.

{#capitalize-domain-terms .should appliesTo=docs}
## Capitalize the domain terms

The toolkit's concepts are proper terms — **Tag**, **Service**, **Contract**, **Resource**, **Layer**,
**Handle**, **Node**, **Implementation** — and read as such: capitalized, so *a Tag* (the concept) is
distinct from the ordinary word. The glossary is the list of what counts; a lowercase `tag` in prose
reads as a mistake. Where a word is genuinely generic — "reach it through an HTTP client" — leave it be;
capitalize the term when it names the concept, not every time the letters appear.

## Authoring Djot (prototype)

{.note}
**Prototype — provisional.** The authoring format below is documented as it stands today. **LSP support
for the docs is coming and will change it** — read this as a description of the current shape, not a
locked contract. It firms up into enforced rules once the LSP lands.

Our docs are [Djot](https://djot.net), and the format doubles as data — the standards manifest is
parsed straight from the blocks, so a page is both prose and a machine contract. The conventions today:

- **Page block.** Every page opens with `{#id title="…"}` on the line above the H1. `id` matches the
  slug and the filename; `title` is the single source — nav and the manifest *derive* it, never repeat
  it.
- **Rule block.** A standard is `{#id .severity appliesTo="…"}` followed by an H2 whose text *is* the
  rule's title. `severity` is a closed set: `must` / `should` / `may`.
- **`appliesTo` is a rule concern.** It scopes a rule to code trees — `src` / `examples` / `test` /
  `docs` / `process`, with `all` = `src examples test`, space-joined for multiples. It belongs on
  **rule blocks only**; on a page block the parser discards it (see rough edges).
- **Fenced code names its language** — the opening fence is three backticks, a space, then the
  language (`ts`, `bash`, …).
- **`{.note}`** marks a callout, like this one.
- **Draft status (content-side).** Almost every live page opens with `status="draft"` until tip-stable.
  Optional `done="…"` is a space-joined checklist of what has been tip-checked (`api`, `previews`,
  `types`, `verified`). When a page is **ported from `docs/legacy/**`**, keep `status="draft"` and put
  a `{.draft}` callout immediately under the H1 until a tip-check clears it:

  ```
  {.draft}
  **Draft** — ported from the pre-site corpus; tip-check before treating as SSOT.
  ```

  After tip-check: remove the `{.draft}` callout; set `done=` honestly. **Do not** invent site CSS /
  nav badges for Draft — that is lettered-agent / Agent B work (see handoff Phase 3).

**Known rough edges — for the LSP work to resolve, not to hand-fix now:**
- `order=N` on standards pages duplicates `nav.ts`'s ordering — two sources for one fact.
- Page-level `appliesTo` is parsed-but-discarded, yet still written on every page (including the
  non-rule guides, which have no rules to scope) — dead metadata that reads as load-bearing.

{.note}
**Examples are an open question.** How the real `examples/` apps are sourced, kept building, and used
as the canonical demos is still being decided — a separate discussion from this chapter.
