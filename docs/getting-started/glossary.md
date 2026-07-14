{#glossary title="Glossary" status="draft" appliesTo=all}
# Glossary

Concise definitions for the terms used throughout these docs. Link to any entry with
`/docs/glossary#term`; on wide screens, a linked term shows its definition on hover.

## Tag

A typed identifier for a service or resource. Code depends on the tag rather than on a concrete
implementation — `yield* Tag` obtains it, and a layer provides it.

## Service

A capability a program depends on: a clock, a database, a mailer. In Effect, a service is reached
through its tag, so code states what it needs without deciding how that need is met.

## Contract

The methods of a resource together with a schema for every value that passes through them. Because a
contract is schema-typed, the resource can be reached across runtimes, not only within one.

## Resource

A service whose tag carries a contract. A resource can run in the current runtime, be served over RPC,
or be reached as a client — the same tag in every case.

## Implementation

The code that fulfils a contract — the concrete behaviour behind each of its methods.

## Layer

How a resource is provided, and therefore where it runs: `Resource.layer` runs it in process,
`Resource.serve` exposes it over HTTP, and `Resource.clientHttp` connects to one running elsewhere.

## Handle

The value `yield* Tag` returns. It exposes the contract's methods and reads the same whether the
resource runs locally or across a network.

## Node

A named runtime endpoint, carrying the address at which its resources can be reached. Served resources
find one another through the nodes they share.

## Cross-runtime service

A resource defined once and reached through the same tag wherever it runs — in the same process, served
over RPC, or across the network.
