{#index title="Getting started" appliesTo=all}
# effect-pm

{.note}
**⚠️ Example only** — placeholder content that demonstrates the docs platform. **Not final**; to be replaced by Agent A. Do not treat as canonical.

effect-pm is a toolkit for **durable, observable background work** built on
[Effect](https://effect.website). You declare a _resource_ — a queue, a run
gate, a scheduled process — as a service tag, and get a typed handle plus live
dashboards (web, TUI, CLI) over the same tag.

## Install

``` sh
pnpm add @nikscripts/effect-pm effect
```

## The shape of everything

Every resource is a class that extends a `*.Service` factory. You name it,
describe its behaviour, and then use the class as an ordinary Effect service —
`yield*` the tag to get its handle.

``` ts
import { QueueResource } from "@nikscripts/effect-pm"
import { Effect } from "effect"

class Emails extends QueueResource.Service<Emails, string>()("app/Emails", {
  concurrency: 4,
  effect: (address) => Effect.log(`sending to ${address}`),
}) {}

const program = Effect.gen(function* () {
  const emails = yield* Emails            // the handle
  yield* emails.add(["a@example.com"])    // enqueue
  yield* emails.start                     // fork workers
})
```

{.note}
A resource is just an Effect service tag: provide its layer, `yield*` the tag,
call methods on the handle. That same tag is what the dashboards render — you
never wire the UI to the implementation.

## Core features

- [Queues](/docs/queues) — priority, dedup, retry, and workers over a stream of items.
- [Run resources](/docs/run-resources) — concurrency-gated effects with typed input and output.
- [Processes](/docs/processes) — long-running and scheduled work with execution history.

Each page below is a short, runnable tour of one feature.
