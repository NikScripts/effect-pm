{#no-backward-compat title="Breaking changes & stability" order=135 appliesTo=src}
# Breaking changes & stability

The package has no external users yet — one internal repo, the owner's. So the surface is **fluid**:
break it freely, no compatibility layers. That holds until a symbol is deliberately **locked** with
`@since` — after which it's a commitment.

{#break-freely-while-fluid .must appliesTo=src}
## While fluid, break freely — no BC shims

Because there are no users, an unlocked symbol has no compatibility to preserve. Rename or remove it
outright: no alias, no re-export under the old name, no `@deprecated` shim. The old name lives on only
in a migration note in the docs — never in surviving code.

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

{#since-is-the-lock .must appliesTo=src}
## `@since <version>` locks a symbol

`@since` is the one sanctioned version annotation, and it means **committed**: a symbol tagged
`@since <version>` is part of the stable surface as of that version, so changing it from then on
requires a deliberate breaking-change or legacy plan — no longer free. Untagged symbols stay fluid.

Apply it **deliberately**, as an explicit locking decision — never sprinkle it, never copy Effect's
habit of tagging everything. A stray `@since` (or a "since 1.0.0") is a lock nobody approved, and is
illegal until the owner locks that surface.

``` ts
// ✅ locked — committed as of 1.0.0; changing `resolve` now needs a BC plan
/** @since 1.0.0 */
export const resolve = /* … */

// fluid — no annotation, break it freely
export const draft = /* … */
```

{#no-suppression-comments .must appliesTo=src}
## No error-suppression comments in the library

Fix the diagnostic, don't silence it. No `@effect-diagnostics-next-line`, no `eslint-disable` in
shipped library code. If one is genuinely unavoidable, it carries a one-line reason and is re-checked
whenever the surrounding code changes.
