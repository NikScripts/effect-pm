{#examples title="Examples" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/examples>.
<!-- docs-site-link:end -->
# Examples

Runnable teaching scripts live under `examples/forms/`. Each form below has a **paired doc**
with Twoslash — the fence **includes the real `.ts` file** (`include="examples/…"`). Cuts in
that file (`// ---cut---` / `---cut-after---`) hide harness noise on the page; Twoslash still
type-checks the full program. Run with the `pnpm run example:…` command on each page.

Individual example docs are **not** in the sidebar; this hub is the index. Deep-link a module
with `#queue`, `#daemon-store`, …

---

## Queue

### [Priority, Dedup, Retry](/docs/workpool-priority-retry)

Source: `examples/forms/queue/workpool-priority-retry.ts`  
Run: `pnpm run example:workpool-retry`

### [Custom N-Lane Priorities](/docs/workpool-priority-lanes)

Source: `examples/forms/queue/workpool-priority-lanes.ts`  
Run: `pnpm run example:workpool-priority`

---

## Daemon Store

### [Soft store auto-write](/docs/daemon-layer-store-auto-write)

Source: `examples/forms/daemon-store/daemon-layer-store-auto-write.ts`  
Run: `pnpm run example:daemon-layer-store-auto-write`

### [Typed Failed.error](/docs/daemon-layer-typed-error-store)

Source: `examples/forms/daemon-store/daemon-layer-typed-error-store.ts`  
Run: `pnpm run example:daemon-layer-typed-error-store`

---

## Hyperlink

### [Gate — unit + input](/docs/gate-unit-and-input)

Source: `examples/forms/hyperlink/gate-unit-and-input.ts`  
Run: `pnpm run example:gate`

### [Gate — fleet rate limit](/docs/gate-rate-limit-fleet)

Source: `examples/forms/hyperlink/gate-rate-limit-fleet.ts`  
Run: `pnpm run example:gate-rate-limit-fleet`

### [Gate — store readback](/docs/gate-store-readback)

Source: `examples/forms/hyperlink/gate-store-readback.ts`  
Run: `pnpm run example:gate-store-readback`

### [HttpClientGate](/docs/http-client-gate)

Source: `examples/forms/hyperlink/http-client-gate.ts`  
Run: `pnpm run example:http-client-gate`

### [Gate.HttpApiClient](/docs/gate-http-api-client)

Source: `examples/forms/hyperlink/gate-http-api-client.ts`  
Run: `pnpm run example:gate-http-api-client`

### [Gate.httpApiClientLayer + capture](/docs/gate-http-api-layer-effect)

Source: `examples/forms/hyperlink/gate-http-api-layer-effect.ts`  
Run: `pnpm run example:gate-http-api-layer-effect`

### [Telemetry — fleet glass](/docs/telemetry-fleet-glass)

Source: `examples/forms/hyperlink/telemetry-fleet-glass.ts`  
Run: `pnpm run example:telemetry-fleet-glass`

### [FleetHealth — fleet glass](/docs/fleet-health-glass)

Source: `examples/forms/hyperlink/fleet-health-glass.ts`  
Run: `pnpm run example:fleet-health-glass`

### [ShardMap — sessions](/docs/shardmap-sessions)

Source: `examples/forms/hyperlink/shardmap-sessions.ts`  
Run: `pnpm run example:shardmap-sessions`

### [Gate — runtime observer](/docs/gate-runtime-observer)

Source: `examples/forms/hyperlink/gate-runtime-observer.ts`  
Run: `pnpm run example:gate-runtime-observer`

### [Hyperlink — Tag defaults](/docs/default-defaults)

Source: `examples/forms/hyperlink/default-defaults.ts`  
Run: `pnpm run example:default-defaults`

### [Hyperlink — shared Spec wire](/docs/shared-tag-wire)

Source: `examples/forms/hyperlink/shared-tag-wire.ts`  
Run: `pnpm run example:shared-tag-wire`

### [Launcher — Lookup membership](/docs/launcher-lookup-membership)

Source: `examples/forms/hyperlink/launcher-lookup-membership.ts`  
Run: `pnpm run example:launcher-lookup-membership`  
Child: [membership child](/docs/launcher-lookup-membership-child)

### [Node — clients catalog](/docs/node-clients)

Source: `examples/forms/hyperlink/node-clients.ts`  
Run: `pnpm run example:node-clients`

### [Node — asLookup](/docs/node-lookup)

Source: `examples/forms/hyperlink/node-lookup.ts`  
Run: `pnpm run example:node-lookup`

### [Node — Prototype](/docs/node-prototype)

Source: `examples/forms/hyperlink/node-prototype.ts`  
Run: `pnpm run example:node-prototype`

### [Node.Tag — fixed address](/docs/node-tag-addressed)

Source: `examples/forms/hyperlink/node-tag-addressed.ts`  
Run: `pnpm run example:node-tag-addressed`

### [Node.Tag — addressless serve](/docs/node-tag-addressless-serve) · [call](/docs/node-tag-addressless-call)

Source: `node-tag-addressless-serve.ts` / `node-tag-addressless-call.ts`  
Run: `pnpm run example:node-tag-addressless-serve` then `example:node-tag-addressless-call`

### [Node — Tag-bound serve](/docs/node-tag-bound)

Source: `examples/forms/hyperlink/node-tag-bound.ts`  
Run: `pnpm run example:node-tag-bound`

### [Node — nameless listen demo](/docs/node-nameless-listen-demo)

Source: `examples/forms/hyperlink/node-nameless-listen-demo.ts`  
Run: `pnpm run example:node-nameless-listen-demo`  
Also: [serve](/docs/node-nameless-listen-serve) · [call](/docs/node-nameless-listen-call)

### [Node — nameless HTTP serve](/docs/node-http-nameless-serve) · [WebSocket](/docs/node-ws-nameless-serve)

Run: `pnpm run example:node-http-nameless-serve` / `example:node-ws-nameless-serve` (hold until interrupt)

### [Node — identity coordinator](/docs/node-identity-coordinator)

Source: `examples/forms/hyperlink/node-identity-coordinator.ts`  
Run: `pnpm run example:node-identity-coordinator`

### [Node — verifyConnection](/docs/node-verify-connection)

Source: `examples/forms/hyperlink/node-verify-connection.ts`  
Run: `pnpm run example:node-verify-connection`

---

## Schedule

Coming next (`examples/forms/schedule`).

---

## Polling

Coming next (`examples/forms/polling`).

---

## Store

Coming next (`examples/forms/store`).

---

## Dynamic Config

Coming next (`examples/forms/dynamic-config`).
