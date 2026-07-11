{#verification-and-testing title="Verification & testing" order=140 appliesTo=test}
# Verification & testing

Every increment earns its commit by being green — and Effect code is tested with the Effect test
tools, on the right clock.

{#green-before-commit .must appliesTo=test}
## Green before every commit

Four checks pass before anything is committed or released — no exceptions, including docs-adjacent
code changes:

``` sh
pnpm typecheck   # tsgo on BOTH projects; patched with the Effect language-service,
                 # so it enforces the Effect rules plain tsc/tsgo would miss
pnpm lint        # eslint
pnpm test        # vitest run — the full suite
pnpm build       # tsup
```

Red on any of them means it isn't done. Never commit on a broken check "to fix later."

{#effect-vitest .must appliesTo=test}
## Effect programs are tested with `@effect/vitest`

An Effect is tested with `it.effect` / `it.live` from `@effect/vitest`, which run the effect for you.
Import `expect` from plain `vitest`.

``` ts
import { it } from "@effect/vitest"
import { expect } from "vitest"

it.effect("dedup rejects a repeat key", () =>
  Effect.gen(function* () {
    const q = yield* Mail
    const first = yield* q.add(job)
    const second = yield* q.add(job)
    expect(second).toEqual(first)
  }),
)
```

{#it-live-for-timing .must appliesTo=test}
## Timing and polling tests use `it.live`

`it.effect` runs on the `TestClock`, which stalls real `sleep`, `delay`, and interval polling — the
effect would hang. Anything that advances in real time (a queue that polls, a scheduled process) uses
`it.live`.

``` ts
// ✅ real interval → live clock
it.live("queue drains on its poll interval", () =>
  Effect.gen(function* () {
    yield* Mail.pipe(Effect.flatMap((q) => q.add(job)))
    yield* Effect.sleep(Duration.millis(50)) // real time passes
    expect(yield* size(Mail)).toBe(0)
  }),
)
```

{#test-d-for-public-types .should appliesTo=test}
## Pin public types with `*.test-d.ts`

A public type is a contract; assert it at the type level in a `*.test-d.ts` file — and with **no
casts**, or the test proves nothing.

``` ts
// queue-tag.test-d.ts
import { expectTypeOf } from "vitest"

expectTypeOf(Mail.add).returns.toEqualTypeOf<Effect.Effect<string, QueueFull>>()
```

{#tests-need-no-approval .must appliesTo=test}
## Testing never needs approval

Write thorough tests, always — covering the no-op-vs-persist paths, each projection, and the type
surface. Tests are exempt from the "no code without a go" gate: you never wait for permission to add
them.
