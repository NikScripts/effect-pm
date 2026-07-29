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

Remaining node-listen / launcher / wire forms under `examples/forms/hyperlink/` —
pair next (E2b).

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
