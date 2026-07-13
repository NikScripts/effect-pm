{#documentation title="Documentation" order=50 appliesTo=src}
# Documentation

How the code documents itself: the doc comment on every public symbol, the tags that mark and version
the surface, and where an inline comment earns its place. The shape is fixed so the whole surface reads
the same way — a reader who has read one doc comment knows how to read them all.

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
 * @since 1.0.0
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

{#since-targets-the-release .must appliesTo=src}
## `@since` targets the first public release

Every `@public` symbol carries `@since 1.0.0` — the release the whole surface is being built toward.
One value, everywhere, until 1.0 ships; only then do real per-symbol versions begin. `@since` records
*when a symbol appeared*; **freezing its shape is a separate concern** — see
*Breaking Changes & Stability → `@locked` marks a frozen symbol*. Never use both to mean the same thing.

``` ts
/**
 * …summary…
 * @public
 * @since 1.0.0
 */
```

{#comment-non-obvious-plumbing .should appliesTo="src examples"}
## Comment the non-obvious plumbing, not the obvious

Inline comments carry what a doc comment can't: where the code relies on something it doesn't show — a
type-level trick, an Effect layer-ordering constraint, runtime ownership, a timing subtlety. Never
narrate what the code already says.

``` ts
// ✅ good — explains a constraint you can't see in the call
// provideMerge, not provide: a bare provide prunes the serve layers off httpServer
const node = Resource.httpServer([Counter.serve]).pipe(Layer.provideMerge(deps))

// ❌ bad — restates the obvious
const total = a + b // add a and b
```
