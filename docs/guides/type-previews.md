{#type-previews title="Type previews (demo)"}
# Type previews — the dual-view trick

A scratch page to verify one thing on a phone: a handle can hover as a **compact named
type**, while a **helper** reveals its **full expanded shape** — the same split
[prettify-ts](https://marketplace.visualstudio.com/items?itemName=mylesmurphy.prettify-ts)
gives in the editor, reproduced here so it renders in the browser.

Both `// ^?` popups below are **persistent** (no hover needed) and sit in **one block**, so
you see *both at once* — the compact name up top, the full shape right under it:

{.twoslash}
``` ts
import { Effect, Stream } from "effect"

type EmailJob = { to: string }
type QueueEvent = { readonly _tag: "Enqueued" | "Drained" }

// The handle, as a NAMED interface — the compact default.
interface EmailsQueue {
  add: {
    (item: EmailJob): Effect.Effect<void>
    (items: ReadonlyArray<EmailJob>): Effect.Effect<void>
  }
  size: Effect.Effect<number>
  events: Stream.Stream<QueueEvent>
  pause: Effect.Effect<void>
}

// A helper whose RETURN type prettifies. The result arrives by inference, so TS
// resolves the mapped type to the concrete members (no alias, nothing "as written").
declare function expand<T>(x: T): { [K in keyof T]: T[K] }

declare const emails: EmailsQueue
// ---cut---
emails
// ^?

const shape = expand(emails)
shape
// ^?
```

**Top popup** = the compact name `EmailsQueue`. **Bottom popup** = the same type expanded to
its members. Same value, two views, on one screen.

The caveat that shaped the plan: the expansion only renders when the type arrives by
**inference** (via `expand(...)`). Writing `declare const x: Prettify<EmailsQueue>` directly
would just show `Prettify` — TS preserves the alias name. That's why the real docs "expand"
is a compiler-API port of prettify-ts (D3), not a plain type alias; and why on *your* machine
the extension already does it for free once the handles are named.
