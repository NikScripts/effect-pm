{#formatting-and-comments title="Formatting & comments" order=190 appliesTo=src}
# Formatting & comments

Small rules with big readability payoff — the code is read on a phone as often as a desktop.

{#one-field-per-line .must appliesTo=src}
## One field per line

Never collapse a multi-field object or parameter list onto one line. One field per line, always — a
collapsed literal is unreadable on a narrow screen and buries a bad diff.

``` ts
// ❌ bad — collapsed onto one line
const config = { levelCount: 4, namedLevels: { interactive: 0, batch: 3 }, takeAlgorithm: "weighted" }

// ✅ good — one field per line
const config = {
  levelCount: 4,
  namedLevels: { interactive: 0, batch: 3 },
  takeAlgorithm: "weighted",
}
```

{#comment-non-obvious-plumbing .should appliesTo=src}
## Comment the non-obvious plumbing, not the obvious

Comment where the code relies on something it doesn't show — a type-level trick, an Effect
layer-ordering constraint, runtime ownership, a timing subtlety. Don't narrate what the code already
says.

``` ts
// ✅ good — explains a constraint you can't see in the call
// provideMerge, not provide: a bare provide prunes the serve layers off httpServer
const node = Resource.httpServer([Counter.serve]).pipe(Layer.provideMerge(deps))

// ❌ bad — restates the obvious
const total = a + b // add a and b
```

{#mark-the-surface .should appliesTo=src}
## Mark the surface with `@public` / `@internal` / `@module`

An app-facing symbol carries `@public`; a package-only one carries `@internal`; a large module opens
with a `@module` overview so a reader lands with context.

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
