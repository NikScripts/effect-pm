# WOW repo — agent handoff prompts (dashboard slice 2, plane A control)

Copy-paste sections below into a Cloud Agent (or local agent) working in the **WOW / Next** application repo.

**Upstream library:** [NikScripts/effect-pm](https://github.com/NikScripts/effect-pm) is vendored in WOW via **git subtree** (not npm for active development). The agent must **pull upstream commits** into the subtree path before assuming APIs exist.

**Styled dashboard:** After effect-pm Phase 1 lands on **`main`**, import `@nikscripts/effect-pm/ops-ui` — see [dashboard-ops-ui.md](../guides/dashboard-ops-ui.md). Until then use headless `@nikscripts/effect-pm/react` + slots.

**Product owner decisions (accepted for this iteration):**

- Gateway: **Next Route Handler REST proxy first** (`/api/control/*` → private `ControlService`); tRPC gateway later; widgets stay on `ControlPlanePort` + fetch adapter until then.
- **One ProcessGroup per ops page** (env-fixed); no multi-group switcher yet.
- **Queue controls in UI** once `@nikscripts/effect-pm/react` ships a queue panel (slice 2a in effect-pm); WOW gateway must forward queue routes now.
- **Auth:** Tailscale / noop forwarder for dev; no Better Auth enforcement on mutations yet.
- **No analytics plane** (`ProcessStorage` / Prisma tRPC) in this iteration.
- **No TanStack Query** in widgets yet; polling in package components is enough.
- **`PM_CONTROL_URL`:** single server env per deploy.

---

## Subtree sync policy (read before any prompt)

### Recommendation (use this unless owner says otherwise)

| Phase | WOW agent pulls from effect-pm |
|-------|--------------------------------|
| **Now** | **`main` only** — dashboard + storage work merged; record full SHA in WOW PR |
| **Never** | Pin obsolete feature branches (`cursor/dashboard-control-slice-1-158c`, etc.) |

**Why:** One stable upstream ref (`main`) avoids WOW agents chasing branch names. Until slice 1 merges, pin the branch explicitly and record the **commit SHA** in the WOW PR description.

### What the WOW agent must do every session

1. **Discover subtree prefix** in WOW (common paths: `vendor/effect-pm`, `packages/effect-pm`, `lib/effect-pm` — search for `git subtree` in README or `git log --grep=subtree`).
2. **Do not edit** files inside the subtree for product features; only **pull** upstream. Feature work stays in WOW app code.
3. **Pull upstream** before `pnpm install` / typecheck:

```bash
# Replace PREFIX and REMOTE per WOW repo docs
export EFFECT_PM_REMOTE=https://github.com/NikScripts/effect-pm.git
export EFFECT_PM_BRANCH=main   # or cursor/dashboard-control-slice-1-158c until merge

git fetch effect-pm "$EFFECT_PM_BRANCH"   # remote name may differ
git subtree pull --prefix=PREFIX effect-pm "$EFFECT_PM_BRANCH" -m "chore: sync effect-pm subtree ($EFFECT_PM_BRANCH)"
```

4. **Verify React subpath exists** after pull:

```bash
ls PREFIX/package.json
node -e "const p=require('./PREFIX/package.json'); console.log(p.exports['./react'], p.exports['./react/adapters/fetch'])"
```

5. **Point WOW `package.json`** at the subtree copy (workspace path or `"file:./PREFIX"`), not published npm, unless owner explicitly uses npm.

6. **Post sync status** in PR/commit message: `effect-pm @ <full-sha> from <branch>`.

### When to pull again

| Event | Action |
|-------|--------|
| effect-pm agent says “slice 2a merged / pushed SHA abc123” | Subtree pull that branch or `main` |
| WOW typecheck: cannot find `@nikscripts/effect-pm/react` | Pull latest; confirm slice 1 landed |
| Owner merges effect-pm dashboard PR to `main` | Switch `EFFECT_PM_BRANCH=main`, pull, rebuild |

### Do not

- Import `ControlService`, `ProcessStorage.layer`, SQLite, or `*.runtime.ts` in **client** components.
- Expose `PM_CONTROL_URL` or `127.0.0.1:3001` to the browser.
- Build analytics tRPC (`ProcessStore` facets) in this slice.

---

## Reference: slice 1 already in effect-pm (read in subtree)

| Piece | Location in effect-pm |
|-------|---------------------|
| Port | `src/react/ControlPlanePort.ts` |
| Fetch adapter | `src/react/adapters/fetch.ts` |
| Provider + hook | `src/react/ControlPlaneContext.tsx` |
| Process panel widget | `src/react/ProcessGroupControlPanel.tsx` |
| Vite demo (copy gateway pattern) | `examples/dashboard-demo/web/` + `web/vite.config.ts` |
| Optional Node forwarder | `examples/dashboard-demo/control-gateway.ts` |
| Guide | `docs/guides/dashboard-integration.md`, `docs/guides/service-tags-and-runtime-split.md` |

**Canonical topology:**

```text
Browser → same-origin /api/control/* → (server) → PM_CONTROL_URL → ControlService (127.0.0.1:PORT)
```

**REST mapping** (gateway strips `/api/control` prefix):

| Browser | Upstream |
|---------|----------|
| `GET /api/control/contract` | `GET /contract` |
| `GET /api/control/status` | `GET /status` |
| `POST /api/control/processes/:id/start` | `POST /processes/:id/start` |
| `GET /api/control/queues/:id` | `GET /queues/:id` |
| `POST /api/control/queues/:id/pause` | `POST /queues/:id/pause` |

Use `encodeURIComponent(id)` for ids like `@app/Billing/Sync`.

---

# PROMPT 0 — Orientation (run once)

```markdown
You are working in the WOW (Next.js) application repo. Process management comes from **@nikscripts/effect-pm**, vendored via **git subtree** — not a normal npm version during active development.

**Your job (slice 2b — WOW):** Wire the **control plane UI** (plane A only):

1. Sync effect-pm subtree to the branch/SHA the owner specifies (see docs/handoffs/wow-dashboard-slice-2-agent-prompts.md in the subtree after pull).
2. Add `*.tags.ts` for the production ProcessGroup (browser-safe; no layers).
3. Add a **Route Handler** gateway: `/api/control/[...path]` forwards to `process.env.PM_CONTROL_URL` (server-only).
4. Add a client ops page using `ControlPlaneProvider`, `createFetchControlPlaneAdapter({ baseUrl: "/api/control" })`, and `ProcessGroupControlPanel`.
5. Document env vars and manual test steps (owner may not run tests immediately).

**Accepted product decisions:** REST gateway first (not tRPC yet); one group per page; noop/Tailscale auth; include queue route forwarding in gateway even before queue UI exists; no ProcessStorage analytics tRPC.

**Before coding:** Find subtree prefix, pull upstream, confirm `@nikscripts/effect-pm/react` exports exist, read `examples/dashboard-demo/web/App.tsx` in the subtree.

**Report back:** subtree path, effect-pm SHA, files created, env vars, and anything blocked (missing exports, unknown group id).
```

---

# PROMPT 1 — Subtree sync + dependency wiring

```markdown
## Task: Sync effect-pm subtree and wire WOW to local package

1. Locate git subtree prefix for effect-pm in this repo (search README, package.json `file:` deps, or `git log --grep=subtree`).
2. Pull upstream:
   - Until owner confirms merge: branch `cursor/dashboard-control-slice-1-158c`
   - After merge: `main` only
3. Record full commit SHA in your summary.
4. Ensure WOW depends on the subtree package path (e.g. `"@nikscripts/effect-pm": "file:./<prefix>"` or monorepo workspace protocol — match existing convention).
5. Run WOW install + typecheck. Fix only WOW-side path/tsconfig issues; do not patch subtree unless owner approves.
6. Confirm imports resolve:
   - `@nikscripts/effect-pm/react`
   - `@nikscripts/effect-pm/react/adapters/fetch`

**Do not** proceed to UI if `./react` export is missing — stop and report SHA/branch needed.

**Deliverable:** PR/commit `chore: sync effect-pm subtree for dashboard control` + short note with SHA.
```

---

# PROMPT 2 — Tags module (browser-safe)

```markdown
## Task: Add production ProcessGroup tags module

Follow effect-pm `docs/guides/service-tags-and-runtime-split.md` (in subtree).

1. Create `*.tags.ts` (path per WOW conventions, e.g. `src/process-groups/<name>.tags.ts`) defining:
   - Your real `Process` / `QueueResource` service classes used in the hero ProcessGroup
   - `ProcessGroup.Service` for the **one** production group (owner provides id or copy from existing Effect definitions)
2. **Forbidden in this file:** `ControlService`, `ProcessStorage.layer`, `layerHttp`, SQLite/Prisma, `Layer.mergeAll`, `Endpoint.local`, any Node-only imports.
3. Export tags for use in client components (ids for display only if needed).

**Do not** create `*.runtime.ts` in this task unless needed for local dev scripts — runtime stays server-only.

**Deliverable:** tags file + one sentence on which group id and process/queue tags are included.
```

---

# PROMPT 3 — Control gateway (Route Handler)

```markdown
## Task: Same-origin control gateway via Next Route Handler

Implement REST forwarder equivalent to effect-pm `examples/dashboard-demo/web/vite.config.ts` proxy and `examples/dashboard-demo/control-gateway.ts`.

1. Route: `app/api/control/[...path]/route.ts` (App Router) or equivalent in WOW stack.
2. Behavior:
   - Join segments after `/api/control/` → upstream path `/${segments}` on `PM_CONTROL_URL`
   - Forward method, body, and relevant headers (strip `host`; avoid forwarding cookies to PM unless intentional)
   - `PM_CONTROL_URL` from env, default `http://127.0.0.1:3001` for local dev — **server-only**, never `NEXT_PUBLIC_*`
3. Support GET and POST for control routes (process + queue actions).
4. Return upstream status/body (JSON) transparently; handle connection errors as 502 with `{ success: false, error: "..." }` shape when practical.
5. No auth enforcement yet (owner: Tailscale / trusted network). Optional comment where Better Auth will run later.

**Test plan (document for owner):** With PM running on 3001, `curl -s http://localhost:3000/api/control/status` (adjust port) should return `{ success: true, ... }`.

**Deliverable:** gateway route + `.env.example` entry for `PM_CONTROL_URL`.
```

---

# PROMPT 4 — Ops page (client)

```markdown
## Task: Operator page with effect-pm React widgets

1. Add a **client** page (e.g. `app/ops/processes/page.tsx` or existing dashboard route) that:
   ```tsx
   "use client";
   import { ControlPlaneProvider, ProcessGroupControlPanel } from "@nikscripts/effect-pm/react";
   import { createFetchControlPlaneAdapter } from "@nikscripts/effect-pm/react/adapters/fetch";

   const port = createFetchControlPlaneAdapter({
     baseUrl: "/api/control",
     defaultInit: { credentials: "same-origin" },
   });

   export default function OpsPage() {
     return (
       <ControlPlaneProvider port={port}>
         <ProcessGroupControlPanel pollIntervalMs={2000} />
       </ControlPlaneProvider>
     );
   }
   ```
2. Optional: import group **tags** for static labels / future typed props — never import runtime module.
3. Minimal layout (WOW design system if one exists; unstyled OK for v1).
4. When effect-pm adds `QueueControlPanel` (slice 2a), leave a commented placeholder or second section — do not implement queue UI until export exists.

**Deliverable:** ops page + link from nav if applicable + manual test checklist in PR body.
```

---

# PROMPT 5 — Docs + handoff back to effect-pm agent

```markdown
## Task: Document WOW integration for the owner

Add `docs/ops-control-plane.md` (or WOW README section):

1. Subtree sync commands (prefix, remote, branch policy).
2. Env: `PM_CONTROL_URL`, how to start PM child / group (pointer to WOW's existing process launcher if any).
3. Manual verification:
   - PM listening on control port
   - `curl /api/control/status`
   - Open ops page; network tab shows only `/api/control/*`, never `:3001`
   - Click start/stop on one process
4. Known limitations: no auth, one group, no analytics, no queues UI until package ships.

**Report to owner / effect-pm agent:**

- effect-pm SHA synced
- WOW PR link
- Hero group id
- PM control port in dev
- Blockers (if any)
```

---

## Coordination with effect-pm agent (slice 2a)

| Owner | Repo | Delivers |
|-------|------|----------|
| effect-pm agent | effect-pm | `createTrpcControlPlaneAdapter` (later), `QueueControlPanel`, typed status polish |
| WOW agent | WOW | Gateway, tags, ops page, env docs |

**Order:** WOW can land gateway + process panel **before** queue widget exists. Gateway must already forward `/queues/*` routes.

When effect-pm publishes queue widget, WOW agent: subtree pull → add component under same `ControlPlaneProvider` (same port).

---

## Optional: tRPC gateway prompt (defer)

Use only after REST proxy works and owner requests tRPC:

```markdown
Add `control` tRPC router: procedures mirror ControlPlanePort (contract, status, processAction, queueAction). Each procedure server-side fetch to PM_CONTROL_URL. Swap client to createTrpcControlPlaneAdapter when effect-pm ships it. Widget URLs unchanged (/api/control or trpc path — pick one; do not break existing fetch adapter until cutover).
```

---

## Checklist for owner when back at keyboard

- [ ] Subtree SHA matches expected effect-pm branch
- [ ] `curl` gateway `/api/control/status`
- [ ] Ops page loads; process mutations work
- [ ] Merge effect-pm dashboard PR → switch subtree pulls to `main`
- [ ] Changeset on effect-pm before npm publish (separate from WOW)

---

*Maintained in effect-pm at `docs/handoffs/wow-dashboard-slice-2-agent-prompts.md` — subtree pull or copy from GitHub raw when briefing WOW agents.*
