# Deploying the docs site (DigitalOcean App Platform + Cloudflare)

The site is a Node service (Waku `start`): hyperlink-ts pages are pre-rendered static; effect dep
API pages SSR on demand reading `api-data/` + `api-hovers/` from disk. **The artifact deploys;
DO never builds** — a fresh builder has no hover cache (that's a 1.5 h gen-hovers run per deploy).

## One-time setup

1. DOCR registry + app:
   ```sh
   doctl registry create <registry-name>
   doctl apps create --spec docs/site/deploy/do-app.yaml
   ```
2. Cloudflare in front (free tier): DNS-proxy the app's hostname. Cache rules — long TTL for
   `/search/*`, `/assets/*`, `/llms*.txt`, `/sitemap.xml`; plus the dep-API SSR rule from
   `./scripts/cf-edge-cache.sh ensure` (see below). Edge brotli covers the corpus the origin
   serves uncompressed.
3. At launch (and on any domain change), stamp the sources once:
   ```sh
   DOCS_SITE_ORIGIN=https://your.domain npx tsx scripts/gen-doc-banners.ts   # commit the result
   ```

## Secrets (dotenvx + 1Password)

Deploy / edge secrets live in encrypted `docs/site/.env` (committed). The private key is
`docs/site/.env.keys` (gitignored). **1Password** holds the backup + optional CF token under
item `Hyperlink docs deploy` (vault `Personal` by default). `doctl` auth stays in doctl
(`doctl --context hyperlink`).

```sh
cd docs/site
pnpm install

# one-time: unlock 1Password app → Settings → Developer → Integrate with 1Password CLI
pnpm run op:bootstrap
# optional: CLOUDFLARE_API_TOKEN='…' pnpm run op:bootstrap

# set CF token into encrypted .env (from 1Password or paste once locally)
pnpm exec dotenvx set CLOUDFLARE_API_TOKEN "$(op read 'op://Personal/Hyperlink docs deploy/CLOUDFLARE_API_TOKEN')"
git add .env && git commit -m "chore(docs-site): encrypt Cloudflare API token"

pnpm run cf:ensure && pnpm run cf:status
pnpm run deploy:do -- hyperlink-docs
```

New machine: `pnpm run op:restore-keys` (writes `.env.keys` from 1Password), then `pnpm install`.

## Every deploy

```sh
cd docs/site
pnpm run deploy:do -- hyperlink-docs
# dotenvx → full build → check-ssg → DOCR push → create-deployment --wait → CF purge → live-routes-smoke
```

The script fails closed: truncated API SSG (missing `api-data/index.json` / module HTML), ciphertext
in HTML, a non-ACTIVE App Platform cutover, or a live 404 on `/api/hyperlink-ts/WorkPool` (and other
canaries) all abort the deploy. Do **not** bypass with bare `waku build` + docker push.

Gates (also runnable alone):

| Gate | Command | When |
|------|---------|------|
| SSG integrity | `pnpm run docs:check-ssg` | `postbuild` + deploy |
| Live routes | `pnpm run docs:smoke:routes -- https://hyperlink.cool` | end of deploy |
| Browser / search | `pnpm run docs:smoke` / `docs:smoke:search` | `docs:verify` |

## Cloudflare — edge-cache SSR'd dependency API pages

Effect / `@effect/platform-node` / `@effect/sql-sqlite-node` API pages are SSR (full SSG
overflows Waku). Those responses are heavy and used to OOM a 1GB origin under crawl. Edge-cache
them on the free Cloudflare plan (no Workers):

```sh
cd docs/site
pnpm run cf:ensure   # once (idempotent upsert)
pnpm run cf:status   # expect cf-cache-status: HIT on the 2nd probe
```

Rules (both `override_origin` — DO often emits `Cache-Control: private`):

| Rule | Match | Edge TTL |
|------|--------|----------|
| dep API SSR | `/api/effect*`, `/api/platform-node*`, `/api/sql-sqlite-node*` | 1 day |
| static corpus | `/assets/*`, `/search/*`, favicon/og/robots/llms/sitemap/healthz | 1 year (assets) |

Purge on every image deploy (`pnpm run deploy:do` / `pnpm run cf:purge`).

**DOCS_SITE_ORIGIN:** must decrypt to a real `https://…` URL at build time. Bare `waku build`
without dotenvx once baked `encrypted:…` into every canonical/og tag — `deploy-do.sh` now refuses
non-http(s) origins, and `siteOrigin()` falls back to `https://hyperlink.cool`.

**robots.txt:** origin serves `docs/site/public/robots.txt` (Allow + Sitemap).

Origin also stamps `Cache-Control: public, s-maxage=86400, …` via
`src/middleware/cacheHeaders.ts` for those paths — documentation of intent; the Cache Rule is
what actually forces eligibility when DO wraps responses as `private`.

## Local smoke of the exact image

```sh
cd docs && docker build -f site/Dockerfile -t hyperlink-ts-docs:test .
docker run --rm -p 8081:8080 hyperlink-ts-docs:test
# static:  curl localhost:8081/api/hyperlink-ts/Polling
# SSR:     curl localhost:8081/api/effect/Effect/retry   (hover popups present)
# assets:  curl localhost:8081/search/api.json  /llms.txt  /sitemap.xml
```

Gotcha that bit us on the first try: the image packages whatever `dist/` exists — **always build
immediately before `docker build`** (the script enforces the order).
