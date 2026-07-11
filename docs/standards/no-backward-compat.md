{#no-backward-compat title="No backward-compat shims" order=135 appliesTo=src}
# No backward-compat shims

Pre-1.0, a rename is a clean break, not a layer of aliases. Old names don't linger; suppressions
don't accumulate.

{#no-deprecated-aliases .must appliesTo=src}
## Delete renamed symbols — no `@deprecated` aliases

When a symbol is renamed or removed, it's gone. No alias, no re-export under the old name, no
`@deprecated` shim kept "for now." The old name lives on only in a migration note in the docs.

``` ts
// ❌ bad — the old name kept alive as an alias
export const resolve = /* … */
export const withStorage = resolve // @deprecated — drags a dead name forward forever

// ✅ good — renamed outright
export const resolve = /* … */
```

{#rename-is-one-change .must appliesTo=src}
## A rename is one complete breaking change

Move everything together in a single change: the symbol, every call site, the tests, the examples,
and the docs. A rename spread across releases or split over several PRs is a half-ship that leaves the
tree inconsistent. Migration guidance goes in the changeset and docs — never in surviving code.

{#no-suppression-comments .must appliesTo=src}
## No error-suppression comments in the library

Fix the diagnostic, don't silence it. No `@effect-diagnostics-next-line`, no `eslint-disable` in
shipped library code. If one is genuinely unavoidable, it carries a one-line reason and is re-checked
whenever the surrounding code changes.

``` ts
// ❌ bad — silencing the checker instead of fixing the cause
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const spec = build(tag)

// ✅ good — the code is correct, so nothing needs silencing
const spec = build(tag)
```
