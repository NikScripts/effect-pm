# Handoff — docs site origin down (`hyperlink.cool` Cloudflare 504)

**Status:** **cleared** 2026-07-27T15:42Z UTC — origin healthy; smokes green.  
**Opened:** 2026-07-27 (cloud agent probe).  
**Cleared by:** local agent with `doctl` (`cursor/docs-site-origin-recovery-dbdc`).  
**Root cause:** Node.js heap OOM on `apps-s-1vcpu-1gb-fixed` (~538MB) under Effect API SSR → container exit 134 → DO `no_healthy_upstream` / `x-do-failure-code: UH` → Cloudflare 504. Image `:latest` was fine (no rebuild).  
**Fix:** `doctl apps create-deployment` (redeploy `:latest`) + bump instance to `basic-s` (2GB) via `docs/site/deploy/do-app.yaml` + `doctl apps update`. Active deploy `6e1150bd`.

---

## Symptom (confirmed 2026-07-27)

Every public URL probed returned Cloudflare **504** in ~50–200ms with body `error code: 504`:

| URL | Result |
|-----|--------|
| `https://hyperlink.cool/` | 504 |
| `https://hyperlink.cool/docs/index` | 504 |
| `https://hyperlink.cool/healthz` | 504 |
| `https://hyperlink.cool/api/hyperlink-ts/Polling` | 504 |
| `https://hyperlink.cool/api/effect/Effect/retry` | 504 |
| `https://www.hyperlink.cool/` | 504 |

- DNS resolves to Cloudflare (`104.21…`, `172.67…`) — **edge is up**.
- Fast 504 + plain `error code: 504` ⇒ **origin (DigitalOcean App Platform) unreachable / crashed / not deployed**, not a Twoslash/content bug.
- Owner initially noticed **API pages**; probe shows the **whole site** is down. API pages are just the most obvious SSR path when origin is sick.

Cloud agent environment has **no `doctl`** — cannot inspect or restart the DO app from there.

---

## Architecture (SSOT)

| Layer | What |
|-------|------|
| Edge | Cloudflare DNS-proxy in front of `hyperlink.cool` / `www` |
| Origin | DigitalOcean App Platform app **`hyperlink-docs`** (spec: [`docs/site/deploy/do-app.yaml`](../site/deploy/do-app.yaml)) |
| Runtime | Waku Node `waku start` on `:8080` from prebuilt DOCR image `hyperlink-docs:latest` |
| Build | **Never on DO.** Local/CI runs `pnpm build` in `docs/site` (gen-api → gen-hovers → gen-search → gen-llms → check-links), then Docker packages `dist/` + `api-data/` + `api-hovers/` |

Deploy recipe: [`docs/site/deploy/README.md`](../site/deploy/README.md) · script [`docs/site/scripts/deploy-do.sh`](../site/scripts/deploy-do.sh).

### API page shapes (once origin is up)

- **`/api/hyperlink-ts/…`** — mostly pre-rendered static from `api-data/`.
- **`/api/effect/…` (and other dep packages)** — **SSR on demand** reading `api-data/` + `api-hovers/` from disk (heavy; needs healthy Node process + packaged hover cache).

If only Effect API pages fail after origin recovers, dig into SSR/`api-hovers` packaging. **Today that is not the diagnosis** — `/healthz` itself 504s.

---

## First moves (local agent)

### 1. Confirm still down

```sh
curl -sS -D- -o /dev/null --max-time 15 https://hyperlink.cool/healthz
curl -sS --max-time 15 https://hyperlink.cool/ | head -c 80
```

Expect: Cloudflare 504 until origin is fixed.

### 2. DigitalOcean — find why origin is dead

```sh
doctl auth list
doctl apps list
# locate app name hyperlink-docs / domain hyperlink.cool
doctl apps get <app-id>
doctl apps logs <app-id> --type run --follow=false
```

Check for: crashed container, failed deploy, image pull error, health check failing, scaled to zero, wrong registry/tag, OOM on 1GB instance.

Also verify DOCR image exists:

```sh
doctl registry repository list-tags hyperlink-docs
```

### 3. Prefer restart / redeploy of last known good image

If the app crashed but `:latest` is still a known-good artifact:

- Restart / force redeploy from DO dashboard or `doctl apps create-deployment <app-id>`.
- Smoke: `curl https://hyperlink.cool/healthz` → `ok`, then `/` and one static + one SSR API URL (see below).

### 4. Full rebuild + ship (if image is stale/missing/broken)

From a **clean** `integration` tip (script refuses dirty tree):

```sh
cd docs/site
# first-time / deps:
pnpm install   # in docs/site (or pnpm run docs:install from repo root)

DOCS_SITE_ORIGIN=https://hyperlink.cool ./scripts/deploy-do.sh <docr-registry-name>
doctl apps update <app-id> --spec deploy/do-app.yaml
```

**Gotcha:** image packages whatever `dist/` exists — always build immediately before `docker build` (the script does this). Hover cache is in the artifact; DO must not rebuild from scratch.

Local image smoke before trusting prod:

```sh
cd docs && docker build -f site/Dockerfile -t hyperlink-ts-docs:test .
docker run --rm -p 8081:8080 hyperlink-ts-docs:test
curl -sS localhost:8081/healthz
curl -sS -o /dev/null -w '%{http_code}\n' localhost:8081/api/hyperlink-ts/Polling
curl -sS -o /dev/null -w '%{http_code}\n' localhost:8081/api/effect/Effect/retry
```

### 5. Cloudflare (only after origin answers)

If origin is healthy on the DO app URL but `hyperlink.cool` still 504:

- Check DNS proxy orange-cloud → correct DO hostname.
- SSL/TLS mode (Full / Full strict).
- Purge cache if stale error pages linger (unlikely for 504).

Do **not** chase Twoslash / gen-api content bugs until `/healthz` is green.

---

## Success criteria

1. `GET https://hyperlink.cool/healthz` → `ok` (200). ✅
2. Landing + a docs chapter render (e.g. `/docs/index`, `/docs/work-pools`). ✅
3. Static API: `/api/hyperlink-ts/Polling` (or another shipped module) 200. ✅
4. SSR API: `/api/effect/Effect/retry` 200 with hover sidecars present. ✅
5. Update [`agent-status.md`](./agent-status.md) — note outage cleared + deploy SHA / time. ✅ (`6e1150bd` @ 2026-07-27T15:42Z; instance `basic-s`)

---

## Out of scope for this handoff

- Redesigning the docs platform / View registry (Agent G).
- Content rewrites / rebrand sweep (already on tip).
- Launcher + handoff design (separate track).
- Consuming changesets / merging `integration` → `main`.

---

## References

- Deploy: [`docs/site/deploy/README.md`](../site/deploy/README.md), [`do-app.yaml`](../site/deploy/do-app.yaml), [`deploy-do.sh`](../site/scripts/deploy-do.sh), [`Dockerfile`](../site/Dockerfile)
- Site overview: [`docs/site/README.md`](../site/README.md)
- Platform decisions: [`docs-platform-architecture-decision.md`](./docs-platform-architecture-decision.md)
