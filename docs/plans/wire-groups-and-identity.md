# Plan: wire groups, identity, and shared Spec families

**Status:** owner-locked direction (2026-07-27). Not Eng’d.  
**Agent:** 4 (`cursor/hyperservice-open-deps-5679`).  
**Supersedes:** casual use of public `groupId` as a second identity; doc/examples that teach `tagFor("queue", …)` as the WorkPool model; the 2026-07-14 “keep `groupId`” exception for RPC naming (see owner-decisions).

---

## Two different “groups” (do not conflate)

### 1. Regular RPC group (dogfooded path — WorkPool, Daemon, Gate, …)

One Tag → one Effect `RpcGroup` → wire procedures prefixed by **that tag’s key**.

```ts
class Mail extends WorkPool.Tag<Mail>()("@app/Mail", { payload: Job }) {}
// RpcGroup / wire prefix = "@app/Mail"
// kindOf(Mail) = "hyperlink-ts/WorkPool"  (classification only — not the RpcGroup name)
```

- **Wire prefix = tag `.key`.**  
- **Kind** = toolkit / dashboard classify (`kindOf`), not the group name.  
- Today’s public `.groupId` is a redundant copy of `.key` on this path — remove it; use `.key`.

### 2. Shared Spec family (special case)

Several instances, **one identical wire Spec**, one RpcGroup, instances distinguished by routing (header `key` / instance table).

- **Wire prefix = kind key** (`kindOf` / toolkit `kind`).  
- **Instance `.key`** = Context identity + routing.  
- Authors never set a `wireMode` flag — Effect style: **different factory** stamps the behavior (Tag vs family/Prototype).

---

## What can share a Spec (kind-keyed family)

Share only when every instance has the **same** procedure names and schemas.

| Can share (fixed Spec) | Kind key | Notes |
|------------------------|----------|--------|
| ApiMetrics full Spec | `hyperlink-ts/ApiMetrics` | Clean family candidate |
| Daemon.Schedule full Spec | `hyperlink-ts/Daemon/Schedule` | Clean family candidate |
| WorkPool **control only** | `hyperlink-ts/WorkPool` | `queueControlSpec` — no item type |
| Priority **control only** | `hyperlink-ts/WorkPool/priority` | `priorityControlSpec` |
| Daemon **control only** | `hyperlink-ts/Daemon` | `daemonControlSpec` — no typed `run`/`events` |
| Gate **observation only** | `hyperlink-ts/Gate` | refs only — not `run` |

| Cannot share **full** instance Spec | Why |
|-------------------------------------|-----|
| WorkPool.Tag / priority | Item-typed data plane (`add`, `events`, …); priority also lane schemas |
| Daemon.Tag with success/error | Typed `run` / `events` / optional `result` |
| Daemon + schedule graft | Spec **shape** differs from base |
| Gate.Tag | Typed `run` payload/success/error |
| Arbitrary `Hyperlink.Tag` | Author Spec |

Toolkits already split **shared control + per-instance data**. Kind-keyed family is honest for control-only (or ApiMetrics/Schedule), not for today’s full WorkPool/Daemon/Gate Tags without a deliberate control vs data-plane wire split.

Never merge different kinds into one group (`WorkPool` ≠ `WorkPool/priority`, `Daemon` ≠ `Daemon/Schedule`).

---

## Author-facing API (hide the mechanism)

| Entry point | Meaning | Wire (internal) |
|-------------|---------|-----------------|
| `Hyperlink.Tag(key, spec)` / toolkit `.Tag` | One resource | prefix = **tag key** |
| Family / Prototype factory (name TBD) minting instances under a kind + shared Spec | Related instances | prefix = **kind key**; route by instance key |

No public `groupId`. No author-facing `wireMode`.  
Internal discriminant allowed (private symbol) so `serve` / `client` pick the right path.

Optional helper (internal or public): `Hyperlink.wireKey(tag)` → tag key or kind key from that discriminant. UI `tagWireKey` should call the same rule.

---

## Cleanup vs current code

| Today | Target |
|-------|--------|
| `.groupId` === `.key` on toolkit Tags | Drop `.groupId`; wire uses `.key` |
| `tagFor` / `serveInstances` / `clientInstances` unused in `src/` toolkits; incomplete health registration | Demote or remove from front door until family factory is real; fix ApiMetrics/WorkPool docs that lie |
| Examples `tagFor("queue", …)` | Gone — never use `"queue"` as a wire/contract key |
| `forwardClient` always sends header `key` | Instance mode: omit or ignore; shared mode: required |
| `ServedHyperlinks` keyed by `groupId` | Keyed by wire key (`.key` or kind key) |
| Double `register` append | Reject duplicate wire key |

Spec-hash stays **`contractHash` / verify**, not the RpcGroup name.

---

## Eng slices (suggested order)

| Slice | Scope |
|-------|--------|
| **W0** | This plan + owner-decisions row (supersede “keep groupId”); agent-status |
| **W1** | Solo path: remove public `groupId`; wire/serve/client/verify/registry use `.key`; changeset major; fix doc lies |
| **W2** | Demote/remove unused `tagFor` / `serveInstances` / `clientInstances` from public narrative (or `@internal` until W3) |
| **W3** | Family factory (Effect-hidden): shared Spec + kind-keyed wire; start with ApiMetrics and/or Schedule and/or control-only surfaces |
| **W4** | Prototype story (compose Spec + features, mint named keys) — align `Node.Prototype` later; no service-extends-service |
| **W5** | Optional: WorkPool/Daemon control vs data-plane wire split if product wants kind-keyed control family |

**Not in this plan:** bare values in Spec / `Hyperlink.handle` adornments (separate service-shapes track). Prefer finishing W1–W2 before Creating polish.

---

## Non-goals

- Kind key as RpcGroup prefix for regular (per-instance Spec) Tags.  
- Forcing full WorkPool/Daemon/Gate Specs onto one kind-keyed group.  
- Spec-hash as human wire group name.  
- Public `wireMode` flag on every tag.

---

## References

- Claim / build: `src/Hyperlink.ts` (`Tag`, `tagFor`, `buildInstanceTag`, `wireTag`, `forwardClient`, `serveInstances`).  
- Shareable fragments: `queueControlSpec` / `priorityControlSpec` (`WorkPool.ts`), `daemonControlSpec` / `scheduleHyperlinkSpec` (`Daemon.ts`), `apiMetricsSpec` (`ApiMetrics.ts`), Gate observation in `internal/gateSchema.ts`.  
- UI: `tagWireKey` in `src/ui/data.ts`.  
- Related: [`service-shapes.md`](./service-shapes.md) (handle taxonomy; orthogonal).
