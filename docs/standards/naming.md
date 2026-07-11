{#naming title="Naming" order=50 appliesTo=src}
# Naming

Casing carries meaning here: it tells you whether an identifier is a type or a value at a glance.
One rule underlies the rest — **PascalCase is for the type level, camelCase is for the value
level.**

{#pascalcase-types-only .must appliesTo=src}
## PascalCase only for types, classes, and namespaces

PascalCase names a class, a type, a namespace, or a namespace-member factory (`Tag`, `Service`,
`Schedule`). Nothing else. If it's a value you can pass around, it is not PascalCase — the sole
exception is a factory that stands in for a namespace member.

{#values-are-camelcase .must appliesTo=src}
## Values are camelCase; UPPER_SNAKE only for magic constants

Every value is camelCase: layers, schemas, symbol consts, and ordinary module constants and
defaults. Reserve `UPPER_SNAKE_CASE` for the narrow set of fixed *magic* values Effect itself uses
it for — external-protocol codes, regex/pattern literals, spec URIs, and low-level algorithmic magic
numbers. A tunable default is a value, not a magic constant.

``` ts
// ❌ bad — an ordinary default is just a value
export const DEFAULT_POLL_MS = 5_000
// ✅ good
export const defaultPollMs = 5_000

// ✅ fine — a fixed protocol code / pattern is genuinely magic; UPPER_SNAKE, as Effect does
const PARSE_ERROR_CODE = -32700
const STRING_PATTERN = /^[a-z]+$/
```

{#schema-value-vs-class .must appliesTo=src}
## A schema value is camelCase; a schema class is PascalCase

A schema comes in two forms, and both honor the type/value split:

- A schema bound to a const (`Schema.Struct`, `Schema.Union`, …) is a **value** → camelCase; derive
  a PascalCase type alias when you need the type.
- A `Schema.Class` **is a class** → PascalCase, and it is value and type in one, so no separate
  alias.

``` ts
// value schema — camelCase value, PascalCase type derived from it
export const workItem = Schema.Struct({ id: Schema.String })
export type WorkItem = typeof workItem.Type

// class schema — PascalCase class, value + type in one
export class WorkItem extends Schema.Class<WorkItem>("WorkItem")({
  id: Schema.String,
}) {}
```

Both drop into any config that takes a schema — `payload` / `success` / `error` accept any
`Schema.Top`.

{#prefer-schema-class .should appliesTo=src}
## Prefer a class schema when it earns its keep

Reach for a `Schema.Class` when a schema is **named, reused, carries behaviour, or wants a nominal
identity** — a payload, a response, a domain entity, an error. You get one name for the value and
the type, a validating constructor (`new WorkItem({…})`), `instanceof`, and room for methods. Keep a
plain struct value for **inline or anonymous** shapes, where a class is just ceremony.

{#layers-read-as-layers .should appliesTo=src}
## Layers read as layers

Layers are camelCase. The canonical toolkit entrypoint is `layer` (and `layer*` variants like
`layerMemory`); a composed or auxiliary layer takes a `*Layer` suffix (`persistLayer`, `peersLayer`).
Either way the name says "layer."

{#discriminant-tags-pascalcase .must appliesTo=src}
## Discriminant tags are PascalCase

A tagged-union `_tag` value is PascalCase: `Started`, `Completed`, `Failed`, `Interrupted` — never
kebab (`run-started`) or a `Run*`-style prefix. The tag names the case; it reads like the variant it
is.

{#canonical-ids-slash-scoped .must appliesTo=src}
## Canonical ids are slash-scoped

A service or contract id is a slash-separated, package-scoped string with PascalCase segments:
`@nikscripts/effect-pm/QueueResource`, `@nikscripts/effect-pm/ApiMetrics/clientId`. (CLI and remote
surfaces additionally accept normalized kebab suffix aliases; an ambiguous suffix errors with the
candidate list.)

{#name-for-what-it-is .must appliesTo=src}
## Name for what a thing is, not who uses it

A name describes the thing's own role, never a consumer's vocabulary. The package surface names
*serving* — it never borrows a downstream app's domain word (a queue is a `QueueResource`, not a
`SourceQueue` because one caller calls it a "source").
