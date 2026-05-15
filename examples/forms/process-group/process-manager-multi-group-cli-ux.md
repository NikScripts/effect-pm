# Multi-group ProcessManager CLI UX

This form is a transcript-style design example, not a runnable script.
`ProcessManager.cli([GroupA, GroupB] as const)` is backed by
`ProcessManager.ConnectionRegistry.layer(...)`, so the CLI can derive group and
target ids from the imported group contracts.

## Setup shape

```typescript
class NorthWestBillingGroup extends ProcessGroup.Service<NorthWestBillingGroup>()(
  "@repo/north-west/BillingGroup",
  [NorthWestSyncInvoices, NorthWestBillingEmailQueue] as const,
) {}

class SouthWestBillingGroup extends ProcessGroup.Service<SouthWestBillingGroup>()(
  "@repo/south-west/BillingGroup",
  [SouthWestSyncInvoices, SouthWestBillingEmailQueue] as const,
) {}

const RemoteGroupsLive = ProcessManager.ConnectionRegistry.layer(
  [NorthWestBillingGroup, SouthWestBillingGroup] as const,
  {
    [NorthWestBillingGroup.id]: "http://127.0.0.1:32130",
    [SouthWestBillingGroup.id]: "http://127.0.0.1:32131",
  },
);

yield* ProcessManager.cli([NorthWestBillingGroup, SouthWestBillingGroup] as const).pipe(
  Effect.provide(RemoteGroupsLive),
);
```

## Implemented command flow

Implemented commands:

- `groups`
- `ls`
- `status <target>`
- `verify`
- process controls: `start`, `stop`, `restart`, `now`
- queue controls: `pause`, `resume`, `clear`

List configured groups first:

```bash
$ effect-pm groups
GROUP                         ENDPOINT
@repo/north-west/BillingGroup http://127.0.0.1:32130
@repo/south-west/BillingGroup http://127.0.0.1:32131
```

List all configured groups:

```bash
$ effect-pm ls
GROUP @repo/north-west/BillingGroup

KIND     ID
process  @repo/north-west/BillingGroup/SyncInvoices
queue    @repo/north-west/BillingGroup/BillingEmailQueue

GROUP @repo/south-west/BillingGroup

KIND     ID
process  @repo/south-west/BillingGroup/SyncInvoices
queue    @repo/south-west/BillingGroup/BillingEmailQueue
```

Verify every configured group contract:

```bash
$ effect-pm verify
OK contract verified for @repo/north-west/BillingGroup
OK contract verified for @repo/south-west/BillingGroup
```

Read status by alias:

```bash
$ effect-pm status north-west/billing-group/sync-invoices
STATUS process @repo/north-west/BillingGroup/SyncInvoices
{
  "name": "@repo/north-west/BillingGroup/SyncInvoices",
  "status": "stopped"
}
```

Run a process by canonical id:

```bash
$ effect-pm now @repo/north-west/BillingGroup/SyncInvoices
OK process @repo/north-west/BillingGroup/SyncInvoices run requested
```

Run the same process by a unique suffix alias:

```bash
$ effect-pm now north-west/billing-group/sync-invoices
OK process @repo/north-west/BillingGroup/SyncInvoices run requested
```

## Ambiguity rules

- Commands accept canonical ids and aliases resolved from normalized full ids.
- Canonical ids are slash-separated Effect-style strings with kebab-case package
  segments and case-preserving service names, such as
  `@repo/north-west/BillingGroup/SyncInvoices`.
- CLI aliases may normalize canonical ids into lowercase/kebab-case input such
  as `north-west/billing-group/sync-invoices`.
- Normalization applies to the whole id: case-insensitive comparison,
  punctuation-insensitive word casing (`SyncInvoices` ↔ `sync-invoices`), and
  suffix matching.
- `groups`, `ls`, and `verify` operate across every configured group. `groups`
  currently prints group ids and endpoints; `ls` prints process and queue ids
  with a `KIND` column.
- `status`, process commands, and queue commands accept one canonical id or
  normalized suffix alias.
- If one normalized target matches exactly one process or queue across all
  configured group contracts, the CLI can use that target.
- If a target matches more than one process or queue, the CLI fails instead
  of guessing.
- Ambiguity diagnostics show every canonical candidate and the shortest
  kebab-case suffix the user can type for each candidate.
- Display kind separately from ids. Use a `KIND` column, label, or accessible
  color fallback instead of encoding process/queue/group kind in the id string.
- Targeted commands verify the remote contract before controlling a group and
  surface contract drift as a checked control error.

Example ambiguity:

```bash
$ effect-pm now sync-invoices
Ambiguous target "sync-invoices".
KIND    TYPE THIS MINIMUM                         CANONICAL ID
process [north-west/billing-group/sync-invoices]  @repo/north-west/BillingGroup/SyncInvoices
process [south-west/billing-group/sync-invoices]  @repo/south-west/BillingGroup/SyncInvoices
```

Keep the minimum typed suffix and canonical id separate, and keep kind as a
`KIND` column rather than encoding it in the id.

## Non-goals for this UX slice

- Do not make `ControlService` own multiple groups; it remains a local control
  plane for one typed group.
- Do not treat remote queue enqueue as supported by the CLI. Queue `add`,
  `enqueue`, `prioritize`, and `defer` stay blocked until schema-backed item
  contracts land.
- Do not hide network, protocol, or contract drift failures as defects.
