{#no-backward-compat title="Breaking Changes & Stability" order=135 status="draft" appliesTo=src}
# Breaking Changes & Stability

The package's only consumers are the owner's own — this repo and a private organization sister repo,
both maintained by the owner. There are no external users, so a breaking change is propagated
everywhere by the same hand, in the same motion. The surface is therefore **fluid**: break it freely,
no compatibility layers — until a symbol is deliberately **locked** with `@locked`, after which it's a
commitment.

{#break-freely-while-fluid .must appliesTo=src}
## While fluid, break freely — no compatibility shims

Because every consumer is the owner's own, an unlocked symbol has no external compatibility to
preserve — a break is fixed at every call site by the same hand. Rename or remove it outright: no
alias, no re-export under the old name, no `@deprecated` shim. The old name lives on only in a
migration note in the docs — never in surviving code.

``` ts
// ❌ bad — old name kept alive as an alias
export const resolve = /* … */
export const withStorage = resolve // @deprecated — drags a dead name forward forever

// ✅ good — renamed outright, every call site moved with it
export const resolve = /* … */
```

{#rename-is-one-change .must appliesTo=src}
## A rename is one complete breaking change

Move everything together in a single change: the symbol, every call site, the tests, the examples, and
the docs. A rename spread across releases or split over several PRs is a half-ship that leaves the tree
inconsistent. Migration guidance goes in the changeset and docs, not in surviving code.

{#locked-marks-frozen .must appliesTo=src}
## `@locked` marks a frozen symbol

A symbol tagged `@locked` is frozen: changing it requires a deliberate backward-compatibility or
legacy plan — it is no longer free to break. Untagged symbols stay fluid. `@locked` is applied **only**
as an explicit locking decision by the owner; never sprinkle it.

``` ts
// frozen — changing `resolve` now requires a backward-compatibility plan
/** @locked */
export const resolve = /* … */

// fluid — no annotation, break it freely
export const draft = /* … */
```

{.note}
**Right now nothing is locked** — the whole surface is fluid. At the 1.0 release, `@locked` converts to
`@since 1.0.0`, and `@since` becomes the ongoing stability annotation. Until then, any `@since` (or
"since 1.0.0") comment already in the code is a lock nobody approved — it is illegal and must be
removed.

{#no-suppression-comments .must appliesTo="src examples"}
## No error-suppression comments in the library

Fix the diagnostic, don't silence it. No `@effect-diagnostics-next-line`, no `eslint-disable` in
shipped library code. If one is genuinely unavoidable, it carries a one-line reason and is re-checked
whenever the surrounding code changes.
