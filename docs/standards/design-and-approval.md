{#design-and-approval title="Design & approval" order=160 appliesTo=process}
# Design & approval

How design work reaches a decision — and the line between deliberating and building. These protect
the owner's time and keep settled decisions settled.

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
