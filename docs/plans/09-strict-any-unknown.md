# 09 - Strict any/unknown rule

## Status

Planned.

## Intent

Re-enable the `@effect/language-service` `anyUnknownInErrorContext` diagnostic
once queue and process typing boundaries can support it.

The `serviceNotAsClass` diagnostic intentionally stays off.

## Current target

Only this rule is in scope:

- `anyUnknownInErrorContext`

Out of scope:

- `serviceNotAsClass`
- broad style-only diagnostic changes
- API churn solely to satisfy tooling without runtime or type-safety benefit

## Known pressure points

Likely areas:

- `ProcessGroup` queue tuple typing,
- queue service identifiers,
- queue handle type parameters,
- broad `Context.Key<any, ...>` boundaries,
- helper types that leak `any` into effect requirements.

## Strategy

Prefer stable public types over hidden casts or anonymous service shapes.

Possible steps:

1. introduce a named queue key / queue service type,
2. tighten `ProcessGroup` queue tuple inference,
3. verify multiple queues with distinct item/effect types,
4. turn `anyUnknownInErrorContext` to `error`,
5. run typecheck and tests.

## Graduation criteria

- `anyUnknownInErrorContext` is set to `error`.
- `serviceNotAsClass` remains off.
- `pnpm run typecheck` passes.
- `pnpm test` passes.
- Public declaration emit stays clean.
