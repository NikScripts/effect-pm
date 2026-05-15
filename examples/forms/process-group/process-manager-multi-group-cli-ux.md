# Expected multi-group ProcessManager CLI UX

This form is a transcript-style design example, not a runnable script. The
current CLI is a single-control-endpoint client; the multi-group CLI should be
introduced through `ProcessManager.cli([GroupA, GroupB] as const)` and a typed
connection registry.

## Setup shape

```typescript
class BillingGroup extends ProcessGroup.Service<BillingGroup>()(
  "@app/BillingGroup",
  [SyncInvoices, BillingEmailQueue] as const,
) {}

class SupportGroup extends ProcessGroup.Service<SupportGroup>()(
  "@app/SupportGroup",
  [PullTickets, SupportEmailQueue] as const,
) {}

const RemoteGroupsLive = ProcessManager.ConnectionRegistry.layer(
  [BillingGroup, SupportGroup] as const,
  {
    [BillingGroup.id]: "http://127.0.0.1:32130",
    [SupportGroup.id]: "http://127.0.0.1:32131",
  },
);

yield* ProcessManager.cli([BillingGroup, SupportGroup] as const).pipe(
  Effect.provide(RemoteGroupsLive),
);
```

## Expected command flow

List configured groups first:

```bash
$ effect-pm groups
GROUP                 ENDPOINT
@app/BillingGroup     http://127.0.0.1:32130
@app/SupportGroup     http://127.0.0.1:32131
```

List one group explicitly:

```bash
$ effect-pm --group @app/BillingGroup ls
PROCESSES
@app/SyncInvoices     stopped

QUEUES
@app/BillingEmailQueue     0 pending
```

Run a process in one group:

```bash
$ effect-pm --group @app/BillingGroup now @app/SyncInvoices
OK process @app/SyncInvoices run requested in @app/BillingGroup
```

Pause a queue in another group:

```bash
$ effect-pm --group @app/SupportGroup pause @app/SupportEmailQueue
OK queue @app/SupportEmailQueue paused in @app/SupportGroup
```

## Ambiguity rules

- When more than one group is configured, commands that target a process or queue
  must include `--group <group-id>` unless the target id is globally unique and
  the CLI has already fetched every contract.
- If a process or queue id appears in more than one group, the CLI must fail
  with a clear ambiguity message instead of guessing.
- `--all` is only for read-only aggregate commands such as `groups`, `ls`, and
  status summaries. Mutating commands such as `start`, `stop`, `now`, `pause`,
  `resume`, and `clear` must target exactly one group.
- Group ids come from the imported group service contracts. Optional human
  aliases can be config sugar, but diagnostics should always include the
  canonical group id.
- Every command should verify the remote contract before controlling a group and
  surface drift as a checked control error.

## Non-goals for this UX slice

- Do not make `ControlService` own multiple groups; it remains a local control
  plane for one typed group.
- Do not implement remote queue enqueue as part of the CLI. Queue `add`,
  `enqueue`, `prioritize`, and `defer` stay blocked until schema-backed item
  contracts land.
- Do not hide network, protocol, or contract drift failures as defects.
