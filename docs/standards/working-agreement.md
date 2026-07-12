{#working-agreement title="Working agreement" order=90 appliesTo=process}
# Working agreement

How we work — branches and commits, how designs reach approval, and the bar every change clears before it lands.

{#branch-naming .must appliesTo=process}
## Branches are named `<action>/<description>`

Every branch is `<action>/<description>`. The **action** is the change type — `feat`, `fix`, `docs`,
`refactor`, `chore`, `integration` — and the **description** is a short kebab-case summary of the
work. Nothing else: no bare names, no personal prefixes.

``` text
✅ docs/standards-corpus      feat/queue-durability      fix/soft-break-spacing
❌ standards                  my-branch                  wip
```

{#commit-and-push-continuously .must appliesTo=process}
## Commit and push continuously

Commit at every sensible checkpoint and push in the same breath — a local commit is not done until
it is on the remote. Small, frequent, always-pushed commits; never let unpushed work pile up, and
never wait to be asked. Each finished unit (a chapter, a fix, a passing step) is a commit, pushed.

{#work-on-a-branch .must appliesTo=process}
## Work on a working branch; integration advances by merge

Cut a `<action>/<description>` working branch from your integration branch, do your regular commits
there, and **merge** into the integration branch at checkpoints. An integration branch is advanced
by merges, never by direct commits — committing straight onto it skips the working-branch step and
the review it affords.

{#no-direct-shared-writes .must appliesTo=process}
## Never touch a shared branch without a per-action go

Committing, pushing, merging, or opening a PR against `main`, a release branch, or any shared or
user-owned branch requires **explicit, per-action approval**. "Prepare to merge" is not "merge";
approval for one action does not carry to the next. Your own working branch is yours to push freely
— the gate is only on shared history.

{#changesets-and-releases .must appliesTo=process}
## Changesets and releases are deliberate

A change to public API, behaviour, or package metadata gets **one** coherent changeset, **drafted
proactively** whenever the change warrants it — don't wait to be asked to write it. But **commit the
changeset only after confirmation**: the file is prepared eagerly, committed deliberately. Beta
releases are **manual**: never run `changeset version`; the release is assembled by hand (changeset
entry, prerelease bump, changelog). Pushing is not publishing.


{#no-code-without-a-go .must appliesTo=process}
## No code until an explicit go

While a design is being discussed, discuss it — do not write the implementation. Only a clear, direct
"go" from the owner on *this* change is approval. A "sounds good," someone else's opinion, or your own
certainty is not. "Let's discuss first" means stop. And never build a design that hasn't been approved
— or one that was already rejected — hoping it lands; it only earns a revert.

{#decisions-doc-is-ssot .must appliesTo=process}
## The decisions doc is the source of truth

As each decision is made during a design discussion, record it in a decisions doc right away — don't
wait to be asked. From then on, build from the doc, not from memory or chat: never re-derive a
decision that's already written, and never re-propose a shape the doc lists as rejected. A "do not
resurrect" section keeps dead ideas dead.

``` md
## Decisions
- Tag carries `payload`/`success`/`error`; layer config never overrides them. (locked 07-03)

## Do not resurrect
- Positional-only lane config on CQR — rejected 07-04, breaks named lanes.
```

{#approve-before-lock .must appliesTo=process}
## Approve each item before it's locked

In an API walk, present **one** item, wait for the go, then mark it locked — item by item. Don't
batch-lock a list, and don't read silence as approval.

{#ask-sharp-not-barrage .must appliesTo=process}
## Ask the sharp questions, not a barrage

Open with the few highest-uncertainty questions, not a questionnaire. When the owner asks for ideas or
says "just tell me what you'd do," answer directly — proposing more questions back is the wrong move.

``` text
❌ a wall of 12 questions covering every field
✅ "Two things decide the rest: is durability opt-in or always-on, and does
   readiness fan out across nodes? Once those are set I can propose the rest."
```

{#stop-on-constraint .must appliesTo=process}
## Stop when a constraint forces a compromise

If a limitation is pushing you toward a workaround, a half-ship, or a taxonomy that was already
rejected — **stop and raise it**. Don't silently ship the fallback. Document the blocker with concrete
`file:line` pointers and let the owner make the call.


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
