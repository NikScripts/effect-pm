# Expected multi-group ProcessManager CLI UX

This form is a transcript-style design example, not a runnable script. The
current CLI is a single-control-endpoint client; the multi-group CLI should be
introduced through `ProcessManager.cli([GroupA, GroupB] as const)` and a typed
connection registry.

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

## Expected command flow

List configured groups first:

```bash
$ effect-pm groups
KIND   ID                            ENDPOINT
group  @repo/north-west/BillingGroup  http://127.0.0.1:32130
group  @repo/south-west/BillingGroup  http://127.0.0.1:32131
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
- If one normalized target matches exactly one process or queue across all
  configured group contracts, the CLI can use that target.
- If a target matches more than one process or queue, the CLI must fail instead
  of guessing.
- Ambiguity diagnostics should show every canonical candidate and visually
  emphasize the shortest unique suffix the user can type for each candidate.
  Use terminal bold/color when available; fall back to brackets in plain text.
- Display kind separately from ids. Use a `KIND` column, label, or accessible
  color fallback instead of encoding process/queue/group kind in the id string.
- Every command should verify the remote contract before controlling a group and
  surface drift as a checked control error.

Example ambiguity:

```bash
$ effect-pm now sync-invoices
Ambiguous target "sync-invoices".

KIND     TYPE THIS MINIMUM                    CANONICAL ID
process  [north-west/billing-group/sync-invoices]   @repo/north-west/BillingGroup/SyncInvoices
process  [south-west/billing-group/sync-invoices]   @repo/south-west/BillingGroup/SyncInvoices
```

In a color terminal, render the `TYPE THIS MINIMUM` column in bold or an accent
color. The brackets are only the no-color fallback.

## Non-goals for this UX slice

- Do not make `ControlService` own multiple groups; it remains a local control
  plane for one typed group.
- Do not implement remote queue enqueue as part of the CLI. Queue `add`,
  `enqueue`, `prioritize`, and `defer` stay blocked until schema-backed item
  contracts land.
- Do not hide network, protocol, or contract drift failures as defects.
