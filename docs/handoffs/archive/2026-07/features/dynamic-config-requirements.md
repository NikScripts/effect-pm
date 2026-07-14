# DynamicConfig — verification status (shipped)

Conditions the shipped API satisfies, and how each is verified. Tests live in
`test/dynamic-config.test.ts`. Status: ✓ = covered by a test, ⊙ = guaranteed by
the type system / construction, — = known gap / not yet covered.

## Construction & reads

- ✓ `make` accepts a mixed bag (`Config` and `swappable(Config)`); fields named
  anything (incl. `key`) work — no tag, no collision.
- ✓ `yield* cfg.field` reads natively through the ambient provider; defaults apply.
- ⊙ Reads are `R = never` (the `ConfigField` delegates to its `Config`; typechecks).
- ✓ Swappable field returns the latest value after a swap.
- ✓ A raw `Config` reader of the same key sees the swap (shared provider).
- ✓ `all` reads the whole config as one object (like `Config.all`); `make` ↔ `all`
  convert (pass a bag/an `all` into the other).

## Control — field methods + setByKey

- ⊙ `.set` / `.reset` / `.changes` exist only on `SwappableField`; a `FixedField`
  has none (compile error — covered by the `_typeChecks` block).
- ✓ A valid `field.set` is reflected on the next read.
- ✓ An invalid `field.set` value fails with `ConfigError`; the store is left intact.
- ✓ `setByKey` rejects keys not in the per-runtime allowlist (`ConfigKeyNotSwappable`).
- ✓ `setByKey` validates the value through that key's `Config`.
- ✓ `field.reset` reverts a swapped field to env/default.
- ✓ `field.reset` of a never-overridden key is a no-op.

## Extend / freeze

- ✓ `extend` clones the base's fields and adds; the inherited swappable key is
  shared (swapping the base is seen through the child).
- ⊙ `freeze` / `freezeField` demote to `FixedField` (`.set` won't compile —
  covered by the `_typeChecks` block).
- ✓ `freeze` view still reads the live value.

## Notifications & isolation

- ✓ `field.changes` reflects a swapped key.
- ⊙ Redaction held: `changes` emits env **keys**, never values; secret fields stay `Redacted` on read.
- ✓ Per-provision isolation — a fresh layer provision doesn't see another's swap.
- ✓ Nested-key swap (`Config.nested("DCFG3_DB")` → `DCFG3_DB_HOST`) seen by a raw nested reader.
- ✓ Scoped + forked worker inherits the provider and sees a swap.

## House rules

- ✓ `tsgo` clean on `tsconfig.json` and `tsconfig.src.strict-effect-provide.json`.
- ✓ No brands, no marker flag — swappability is structural (a `SwappableField`
  is one that carries the control methods); field identity is a symbol-keyed meta.
- ⊙ One cast in the whole module (`rebuildBag` — a per-key mapped type TS can't
  infer from a runtime loop), proven necessary + safe; field construction goes
  through `makeEffectable`, which type-checks every member assignment.
- ✓ `vitest run test/dynamic-config.test.ts` passes.

## Open / deferred

- Typed key-literal manifest (compile-time `setByKey` key checking; contract
  derivation). Needs env keys captured as literals — `Config` erases them.
- Probe-based env-key extraction: documented as robust for single-key fields,
  coarse for composite ones.
