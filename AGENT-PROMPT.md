# Transport agent — slices 6.4–6.6

**Branch (required):** `cursor/transport-protocol-unify`  
**Worktree:** `/Users/nikolasstow/Coding/packages/effect-pm-alt-transport`  
**Tmux session:** `effect-pm`  
**Tip:** `605ed9c` + local WIP (`src/index.ts`, `test/store-transport.test.ts`)  
**Verdict:** Not merge-ready — finish 6.4 gaps, then 6.5 and 6.6.

---

## Bootstrap (paste into agent)

```text
You are the transport agent.

WORK HERE ONLY: /Users/nikolasstow/Coding/packages/effect-pm-alt-transport
BRANCH (verify before every commit): cursor/transport-protocol-unify
Run: git branch --show-current  — must print cursor/transport-protocol-unify

Read first: AGENT-PROMPT.md in this directory, then docs/handoffs/transport-protocol-unify-review.md

Do NOT work in effect-pm-alt (hub) or effect-pm (integration branch).
Do NOT checkout rewrite/store-transport for implementation.

Hub branch (read-only reference): cursor/hub-runresource-vertical @ effect-pm-alt worktree.
```

---

## Read first

1. This prompt (you are here)
2. [`docs/handoffs/transport-protocol-unify-review.md`](./docs/handoffs/transport-protocol-unify-review.md)
3. [`docs/handoffs/architecture-transport-unify-handoff.md`](./docs/handoffs/architecture-transport-unify-handoff.md)
4. [`docs/recipes/architecture-split-and-transports.md`](./docs/recipes/architecture-split-and-transports.md)

**Do not touch:** `TelemetryHub`, `ArchiveSink`, `src/store/runResource/**`, projection modules,
`sink/*`, `telemetryTransport` — hub agent owns those on `cursor/hub-runresource-vertical`.

---

## Shipped (keep)

- `storeTransport` uses `RpcServer.Protocol` directly (no `StoreTransportProtocol`)
- Subpath `@nikscripts/effect-pm/storeTransport`
- No `as any` in `makeStore` Protocol boundary
- `StoreTransportApi` naming; changeset + docs for rename

---

## Remaining (required before merge)

### 6.4 — storeTransport Protocol unify

- [ ] Round-trip test via real `storeTransport.serverLayer` + `RpcServer.Protocol` (no harness `as any`)
- [ ] Export policy: deprecated `StoreTransportRpc` subpath **or** remove `makeStoreTransportRpcClient` from index — pick one

### 6.5 — control / log dedup

- [ ] Remove `GET /logs/stream` from `ControlTransportHttp.ts`
- [ ] Scaffold `logTransport.ts`, `controlTransport.ts` (`makeNo*` + `RpcServer.Protocol`)

### 6.6 — terminalTransport v1

- [ ] `terminalTransport.ts` on `/ws/terminal`; smoke test; no hub imports

---

## Verification (every commit)

```sh
git branch --show-current   # must be cursor/transport-protocol-unify
pnpm run typecheck && pnpm test && pnpm run lint && pnpm run build
```

No `as any` in new code. Recommend changeset when exports/behavior change.

---

## Merge coordination

After done, rebase onto `cursor/hub-runresource-vertical` and resolve:
`package.json`, `tsup.config.ts`, `src/index.ts`, `ProcessStorage.ts`.

Reserve `/ws/telemetry` for hub; use `/ws/store`, `/ws/log`, `/ws/control`, `/ws/terminal`.
