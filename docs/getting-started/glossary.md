{#glossary title="Glossary" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/glossary>.
<!-- docs-site-link:end -->
# Glossary

Concise definitions for the terms used throughout these docs. Link to any entry with
`/docs/glossary#term`; on wide screens, a linked term shows its definition on hover.

{.draft}
## Tag

A typed identifier for a Service or Hyperlink Service. Code depends on the Tag rather than on a
concrete Implementation — `yield* Tag` obtains it, and a Layer provides it.

{.draft}
## Service

A capability a program depends on: a clock, a database, a mailer. In Effect, a Service is reached
through its Tag, so code states what it needs without deciding how that need is met.

{.draft}
## Contract

The methods of a Hyperlink Service together with a schema for every value that passes through them.
Because a Contract is schema-typed, the HyperService can be reached across runtimes, not only within
one.

{.draft}
## Hyperlink Service

A Service whose Tag carries a Contract. A Hyperlink Service can run in the current runtime, be served
over RPC, or be reached as a client — the same Tag in every case. **HyperService** is the short form
— use it when space is tight or the full term would repeat in a paragraph. ("Hyperlink" alone still
names the package / foundation module.)

{.draft}
## HyperService

Short for [Hyperlink Service](#hyperlink-service). Prefer the full term on first use in a page or
section; use HyperService thereafter or in nav labels.

{.draft}
## Implementation

The code that fulfils a Contract — the concrete behaviour behind each of its methods.

{.draft}
## Layer

How a HyperService is provided, and therefore where it runs: `Hyperlink.layer` runs it in process,
`Node.http` / `Node.ws` serve it over RPC (HTTP or WebSocket; pass `3000` / `":3000"` / a url for a fixed
address), and `Hyperlink.connect` / `Hyperlink.ws` connect to one running elsewhere — a browser
dashboard uses the WebSocket pair. See [Managing Layers](/docs/managing-layers).

{.draft}
## Handle

The value `yield* Tag` returns. It exposes the Contract's methods and reads the same whether the
HyperService runs locally or across a network.

{.draft}
## Node

A named runtime endpoint, carrying the address at which its HyperServices can be reached. Served
HyperServices find one another through the Nodes they share. Node plane: `Node.drain` /
`Node.shutdown` / `Node.launch` — see [Identity coordinator](/docs/identity-coordinator#node-lifecycle-drain--shutdown--launch).
HyperService plane (WorkPool / Daemon / Gate badge + `start` / `stop`): [Lifecycle](/docs/lifecycle).

{.draft}
## Cross-runtime Service

A Hyperlink Service defined once and reached through the same Tag wherever it runs — in the same
process, served over RPC, or across the network.

## Lookup

Control-plane Node that hosts Identity, Directory, and Advice. Listens pipe
`Lookup.client` / `Lookup.layer` to advertise; clients dial with `Hyperlink.lookupClient`.
Guide: [Identity coordinator](/docs/identity-coordinator).

## Identity

Exclusive claim at Lookup — one live winner for a stamped HyperService (the “brain”). Sibling
module: `import * as Identity from "hyperlink-ts/Identity"`.

## Directory

Membership table at Lookup — who advertises which HyperServices and on which dial. Sibling
module: `import * as Directory from "hyperlink-ts/Directory"`.

## Advice

Soft placement hint (`Advice.prefer`) for clients when Identity missed and Directory has
multiple rows. Sibling module: `import * as Advice from "hyperlink-ts/Advice"` — never
`Lookup.Advice.*`.

## Policy

Composable Layer fragments for dial sticky / stream gap / cold pick, client verify, advertise
conflict, and yield. `import * as LookupPolicy from "hyperlink-ts/LookupPolicy"`. Guide: [Policy](/docs/policy).

## Launcher

Short-lived OS custody bring-up: spawn → Ready → `Node.assume` → exit. Not membership — that
is Lookup after the child assumes. Guide: [Launcher](/docs/launcher).

## lookupClient

`Hyperlink.lookupClient(Tag)` — client Layer that resolves the dial target from Lookup
(Directory + Advice + Policy), without naming a Node.

## Handoff

Two different words:

- **Custody** — Launcher `Handle.handoff` / `Node.assume` (“I own myself; launcher may exit”)
- **Migration** — `Hyperlink.serve(…, { handoff })` / WorkPool `releaseEnqueueHandoff` during
  `Node.shutdown` (move HyperService work A→B)

Do not collapse them. Guide: [Identity coordinator](/docs/identity-coordinator).
