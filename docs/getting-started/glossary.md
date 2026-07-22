{#glossary title="Glossary" status="draft" appliesTo=all}
# Glossary

Concise definitions for the terms used throughout these docs. Link to any entry with
`/docs/glossary#term`; on wide screens, a linked term shows its definition on hover.

{.draft}
## Tag

A typed identifier for a Service or Hyperlink. Code depends on the Tag rather than on a concrete
Implementation — `yield* Tag` obtains it, and a Layer provides it.

{.draft}
## Service

A capability a program depends on: a clock, a database, a mailer. In Effect, a Service is reached
through its Tag, so code states what it needs without deciding how that need is met.

{.draft}
## Contract

The methods of a Hyperlink together with a schema for every value that passes through them. Because a
Contract is schema-typed, the Hyperlink can be reached across runtimes, not only within one.

{.draft}
## Hyperlink

A Service whose Tag carries a Contract. A Hyperlink can run in the current runtime, be served over RPC,
or be reached as a client — the same Tag in every case.

{.draft}
## Implementation

The code that fulfils a Contract — the concrete behaviour behind each of its methods.

{.draft}
## Layer

How a Hyperlink is provided, and therefore where it runs: `Hyperlink.layer` runs it in process,
`Node.httpServer` / `Node.wsServer` serve it over RPC (HTTP or WebSocket), and
`Hyperlink.connect` / `Hyperlink.ws` connect to one running elsewhere — a browser dashboard
uses the WebSocket pair. See [Managing Layers](/docs/managing-layers).

{.draft}
## Handle

The value `yield* Tag` returns. It exposes the Contract's methods and reads the same whether the
Hyperlink runs locally or across a network.

{.draft}
## Node

A named runtime endpoint, carrying the address at which its Hyperlinks can be reached. Served Hyperlinks
find one another through the Nodes they share.

{.draft}
## Cross-runtime Service

A Hyperlink defined once and reached through the same Tag wherever it runs — in the same process, served
over RPC, or across the network.
