# Multi-group ProcessManager CLI UX

This form is a transcript-style design example, not a runnable script.
`ProcessManager.cli([GroupA, GroupB] as const)` is backed by
`ProcessManager.ConnectionRegistry.layer(...)`, so the CLI can derive group and
target ids from the imported group contracts.

The current implementation uses the connection registry directly. The planned
CLI/daemon model lets groups bundle endpoint config with their declarations,
while still allowing an external config layer to override those defaults.
Runtime commands should go through `ProcessManager`; non-runtime admin commands
such as Prisma setup can stay separate under the same binary.

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

## Planned bundled endpoint shape

Endpoint definitions should be available through both `ProcessManager.Endpoint`
and a direct `Endpoint` export:

```typescript
import { Endpoint, ProcessGroup, ProcessManager } from "@nikscripts/effect-pm";

class NorthWestBillingGroup extends ProcessGroup.Service<NorthWestBillingGroup>()(
  "@repo/north-west/BillingGroup",
  [NorthWestSyncInvoices, NorthWestBillingEmailQueue] as const,
  [
    Endpoint.local(
      Endpoint.module(
        () => import("./north-west-billing.runtime"),
        (module) => module.NorthWestBillingRuntime,
      ),
    ).default,
    ProcessManager.Endpoint.production(
      Endpoint.http({
        transport: ProcessManager.Transport.http({
          baseUrl: "https://north-west-billing.internal",
        }),
      }),
    ),
  ],
) {}
```

Rules captured from the CLI/daemon design discussion:

- The CLI is the entrypoint for commands; `ProcessManager` sends commands and
  does not run group fibers in-process.
- `Endpoint.module` uses a dynamic import thunk plus an optional selector so
  TypeScript validates the file path and export shape.
- A module endpoint launches a child runtime that exposes its own
  `ControlService`; same-process control is reserved for tests.
- Each endpoint item has a label, and exactly one group-bundled endpoint may be
  marked with `.default`.
- Explicit config layers override group-bundled endpoint config.
- Local groups can report `pending`, `online`, `offline`, or contract drift after
  bounded probes.
- Logs should be a sibling transport capability so operators can follow merged
  group logs while still issuing commands.
- A future daemon can reuse the same endpoint config items while taking over
  child process ownership, run-state files, and log aggregation.

## Implemented command flow

Implemented commands:

- `groups`
- `ls`
- `status <target>`
- `verify`
- process controls: `start`, `stop`, `restart`, `now`
- queue controls: `pause`, `resume`, `clear`

`--json` is implemented for `groups`, `ls`, `verify`, and `status <target>`.

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

Machine-readable output is available for read/verify commands:

```bash
$ effect-pm groups --json
{"groups":[{"groupId":"@repo/north-west/BillingGroup","baseUrl":"http://127.0.0.1:32130"},{"groupId":"@repo/south-west/BillingGroup","baseUrl":"http://127.0.0.1:32131"}]}
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
OK process @repo/north-west/BillingGroup/SyncInvoices now requested
```

Run the same process by a unique suffix alias:

```bash
$ effect-pm now north-west/billing-group/sync-invoices
OK process @repo/north-west/BillingGroup/SyncInvoices now requested
```

Process controls use the same target resolver:

```bash
$ effect-pm start north-west/billing-group/sync-invoices
OK process @repo/north-west/BillingGroup/SyncInvoices start requested

$ effect-pm restart north-west/billing-group/sync-invoices
OK process @repo/north-west/BillingGroup/SyncInvoices restart requested

$ effect-pm stop north-west/billing-group/sync-invoices
OK process @repo/north-west/BillingGroup/SyncInvoices stop requested
```

Queue controls also accept canonical ids or normalized suffix aliases:

```bash
$ effect-pm pause north-west/billing-group/billing-email-queue
OK queue @repo/north-west/BillingGroup/BillingEmailQueue pause requested

$ effect-pm resume north-west/billing-group/billing-email-queue
OK queue @repo/north-west/BillingGroup/BillingEmailQueue resume requested

$ effect-pm clear north-west/billing-group/billing-email-queue
OK queue @repo/north-west/BillingGroup/BillingEmailQueue clear requested
```

Targeted controls are gated by the imported contract before any HTTP control
request is issued. A status-only process cannot be run with `now`, because
`now` requires the process contract to expose `runImmediately`:

```bash
$ effect-pm now north-west/billing-group/status-only-process
process '@repo/north-west/BillingGroup/StatusOnlyProcess' does not expose 'runImmediately'
```

The same rule applies to queues. If a queue contract does not expose `clear`,
`clear` fails locally before the CLI calls the remote group:

```bash
$ effect-pm clear north-west/billing-group/read-only-queue
queue '@repo/north-west/BillingGroup/ReadOnlyQueue' does not expose 'clear'
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
- Targeted commands check the selected contract entry exposes the requested
  control before issuing HTTP. `status <target>` checks `status`, `now` checks
  `runImmediately`, and queue controls check `pause`, `resume`, or `clear`.
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
Ambiguous target 'sync-invoices'.
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
