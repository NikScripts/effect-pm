{#design-and-approval title="Design & approval" order=160 appliesTo=process}
# Design & approval

How design work reaches a decision — and the line between deliberating and building. These protect
the owner's time and keep settled decisions settled.

{#no-code-without-a-go .must appliesTo=process}
## No code until an explicit go

During design, deliberate — don't implement. A passing "sounds good," an external opinion, or your
own confidence is **not** approval. "Let's discuss first" is a hard stop on implementation. And never
build a design that's been blocked or rejected on the chance it lands — that just earns a revert.

> Approval is a clear, direct go from the owner on *this* change. Nothing else counts as one.

{#decisions-doc-is-ssot .must appliesTo=process}
## The decisions doc is the source of truth

A design bake writes each decision into a decisions doc **as it's made** — you don't wait to be asked.
Build from that doc; never regenerate a locked API shape from memory or chat, and never re-propose a
shape the doc already records as rejected. Keep a "do not resurrect" section so dead ideas stay dead.

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
