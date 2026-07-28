{#documentation title="Documentation" order=50 appliesTo=src}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://hyperlink.cool/docs/documentation>.
<!-- docs-site-link:end -->
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
 * Dial a HyperService `tag` over a transport you provide — no batteries. Pass
 * {@link protocolHttp} / {@link protocolWebsocket} / {@link protocolIpc}.
 *
 * @example
 * Effect.provide(program, Hyperlink.connect(Emails, Hyperlink.protocolHttp(3001)))
 *
 * @public
 */
export const connect = /* … */
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
/** The HyperService's peer clients, for its own cross-node logic. Requires {@link peersLayer}; fold them
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
 * @module WorkPool
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
const node = Node.httpServer([Counter.serve]).pipe(Layer.provideMerge(deps))

// ❌ bad — restates the obvious
const total = a + b // add a and b
```

## Narrative docs

Narrative pages compound and use a controlled vocabulary. The named goals below are the review
language — cite them by name ("this violates *No Simply*"). Accuracy, runnable examples, and knowing
which mode a page is in are assumed. The meta-lesson: docs compound only as cleanly as the system
they describe; incoherent design forces re-teaching no craft can fix.

Existing operational rules (show / verify / handoff / glossary / capitalize) stay below — these goals
sit alongside them, not in place of them.

{#the-spine .must appliesTo=docs}
## The Spine

Hang nearly every page off one load-bearing mental model, stated up front. New material is a facet
of that spine — recontextualization, not a pile of independent topics. Error handling is "what that
one channel does," not a new chapter identity.

For this book the spine is the **Hyperlink**: a [**Tag**](/docs/glossary#tag) carrying a
[**Contract**](/docs/glossary#contract), fulfilled by an **Implementation**, placed by a
[**Layer**](/docs/glossary#layer), used through a [**Handle**](/docs/glossary#handle) that reads the
same locally or across a network. If a feature cannot be phrased as a facet of that spine, either
the framing is wrong or the feature sits off-model — and both are worth knowing.

{#make-the-invisible-visible .should appliesTo=docs}
## Make the Invisible Visible

Composition shown beats composition described. Find the dynamic the static medium hides — type
evolution under combinators, a Handle that stays the same while the Layer changes, work moving
through a queue — invent **one** consistent device to render it, and use that device everywhere the
dynamic appears. Readers learn the device once; then it compounds across pages. Prefer three short
frames (or three annotated fences) over a paragraph that narrates motion.

In this book the default device is the Twoslash fence with a `---cut---` preamble and inline type
comments on the Handle. Stay with that device unless a page has a stronger domain-specific one, and
then use *that* one consistently on that subject.

{#earn-the-abstraction .should appliesTo=docs}
## Earn the Abstraction

Lead with the wall the reader will hit — the try/catch, the hand-rolled client, the untyped Promise —
then present the abstraction as the release of pressure they already feel. An unmotivated abstraction
reads as ceremony; a motivated one reads as inevitable. This matters most for the best features,
where the temptation to open with the fireworks is strongest.

{#naming-is-pedagogy .must appliesTo=docs}
## Naming Is Pedagogy

One name per concept, identical in code and prose. Where naming is inconsistent the docs are forced
to re-teach and compounding collapses. Treat the vocabulary as a fixed ledger (see *The glossary
defines what the API docs can't* and *Capitalize the domain terms*). **If a page has to stop and
disambiguate two names for one thing, that is an API smell surfacing as a docs problem.** Fix it
upstream.

{#minimal-deltas .should appliesTo=docs}
## Minimal Deltas

Each example isolates exactly the one concept the page is teaching, presented as the smallest change
from the prior fence — not a fresh full program the reader must diff mentally. A sequence of small
deltas teaches the *axis of variation*; three complete dumps teach less. Prefer `---cut---` /
repeated preambles over restarting from imports every time. Deltas over dumps.

{#present-tense-imperative-affirmative .should appliesTo=docs}
## Present-Tense, Imperative, Affirmative

Describe behavior in present tense — "the app opens," not "will open" — so the system reads as a
stable set of facts. Address the reader directly and tell them to act: "Tap Settings," not "the user
should navigate to." Prefer the affirmative: "enter eight or more characters" beats "don't use fewer
than eight." Active voice throughout, with the actor named.

{#one-door-for-tasks .should appliesTo=docs}
## One Door for Tasks, a Staircase to the Machinery

Tutorials and how-tos stay clean of internals — the reader accomplishes the task without learning the
mechanism. Explanation and architecture pages carry the mechanism, clearly labeled, because for hard
features "how does this even work" is load-bearing for trust. One front door for tasks; a well-marked
staircase downstairs. Do not force the task-doer downstairs, and do not leave the curious reader
without a staircase. Link the staircase; do not dump it in the hallway.

{#no-simply .must appliesTo=docs}
## No Simply

Ban "simply," "just," and "obviously" as hedges that imply the reader is slow when they struggle. For
anything conceptually heavy this is corrosive: the concept *is* hard, and pretending otherwise breaks
trust the moment reality disagrees. State the hard thing plainly, in a confident unhedged tone. No
apologizing, no padding. Calm authority. (Complements *Show, don't tell*.)

{#sharp-edges-in-place .must appliesTo=docs}
## Sharp Edges, In Place

Document failure modes on the page for the feature that has them, not in a "gotchas" appendix. A
happy-path-only doc set is a trap that costs credibility on the pages where credibility matters most.
Honesty about limitations on the hard features earns trust for the easy ones.

{#no-em-dash .must appliesTo=docs}
## No Em Dash

Do not use the em dash (—) or en dash (–) in prose. Prefer a period, comma, colon, parentheses, or a
full rewrite of the clause. Do not character-swap an em dash for a hyphen and call it done; rewrite
so the pause is unnecessary. Hyphens in compound modifiers (`cross-runtime`) and in code remain fine.
Literal dashes inside code, regexes, or Unicode escapes are exempt.

{#no-ai-fingerprints .should appliesTo=docs}
## No AI Fingerprints

Cut patterns that read as machine-smoothed copy rather than a person making choices:

- Bold-prefix bullets (`**Feature:** description`)
- Corrective antithesis ("Not X. But Y.")
- Dramatic pivots ("Here's the catch", "But here's the thing")
- Throat-clearing ("Let's dive in", "In this guide we'll")
- Gift-wrapped endings and mid-page scaffolds ("In summary", "Putting it together")
- Soft hedges and enthusiasm padding ("worth noting", "really shines", "ensures")
- Stacks of same-length punch sentences with no rhythm variation

State the point. Vary sentence length. Name concrete actors and verbs. Complements *No Simply* and
*Show, don't tell*.

{#show-dont-tell .should appliesTo=docs}
## Show, don't tell

A guide earns trust with real, working code a reader can run — not adjectives about how clean or
powerful the thing is. Lead with the code doing the job and let it carry the claim; cut "effortless",
"elegant", "simply". If a sentence would survive being replaced by a code block, replace it.

``` ts
// ✅ good — the feature, shown
const worker = WorkPool.serve(Emails, { effect: sendEmail }).pipe(nodeServer(3001))

// ❌ bad — telling, not showing
// "hyperlink-ts makes serving a queue across runtimes effortless and elegant."
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

The toolkit's concepts are proper terms — **Tag**, **Service**, **Contract**, **Hyperlink**, **Layer**,
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
  slug and the filename. `title` is the **sidebar** label (nav derives it; do not duplicate titles in
  `nav.ts`). The **H1** is the full page title — they may differ when the sidebar needs the short
  form. Pattern for Hyperlink Service pages: sidebar uses **HyperService** (e.g. `Creating a
  HyperService`); H1 uses the full term (e.g. `Creating a Hyperlink Service`). Included Hyperlink
  Service pages use the module name in the sidebar (`WorkPool`, `Daemon`, …).
- **Rule block.** A standard is `{#id .severity appliesTo="…"}` followed by an H2 whose text *is* the
  rule's title. `severity` is a closed set: `must` / `should` / `may`.
- **`appliesTo` is a rule concern.** It scopes a rule to code trees — `src` / `examples` / `test` /
  `docs` / `process`, with `all` = `src examples test`, space-joined for multiples. It belongs on
  **rule blocks only**; on a page block the parser discards it (see rough edges).
- **Fenced code names its language** — the opening fence is three backticks, a space, then the
  language (`ts`, `bash`, …).
- **`{.note}`** marks a callout, like this one.
- **Draft status (content-side).** Live book pages that are **not** Standards and **not** the
  Introduction open with `status="draft"` until tip-stable. The **Glossary page** is draft, and
  **every glossary term** is marked with a `{.draft}` callout above its heading. Standards and the
  Introduction omit `status="draft"` (they are tip guidance / book home). Optional `done="…"` is a
  space-joined checklist of what has been tip-checked (`api`, `previews`, `types`, `verified`).
  When a page is **freshly ported** (or still immature), keep `status="draft"` and put a `{.draft}`
  callout immediately under the H1 until a tip-check clears it:

  ```
  {.draft}
  **Draft** — ported from the pre-site corpus; tip-check before treating as SSOT.
  ```

  After tip-check: remove the `{.draft}` callout; set `done=` honestly. **Do not** invent site CSS /
  nav badges for Draft — that is lettered-agent / Agent B work. The pre-site corpus under
  `docs/legacy/**` has been **removed** (see [`legacy-docs-migration.md`](../handoffs/legacy-docs-migration.md)).

**Known rough edges — for the LSP work to resolve, not to hand-fix now:**
- `order=N` on standards pages duplicates `nav.ts`'s ordering — two sources for one fact.
- Page-level `appliesTo` is parsed-but-discarded, yet still written on every page (including the
  non-rule guides, which have no rules to scope) — dead metadata that reads as load-bearing.

{.note}
**Examples are an open question.** How the real `examples/` apps are sourced, kept building, and used
as the canonical demos is still being decided — a separate discussion from this chapter.
