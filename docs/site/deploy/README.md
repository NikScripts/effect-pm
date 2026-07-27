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

## Every deploy

```sh
cd docs/site
DOCS_SITE_ORIGIN=https://your.domain ./scripts/deploy-do.sh <registry-name>
doctl apps update <app-id> --spec deploy/do-app.yaml
```

The script: full `pnpm build` (regens api-data / search / llms / sitemap with absolute URLs,
link-check gates the build) → docker image from `docs/` context → push `:latest` to DOCR.
When `CLOUDFLARE_API_TOKEN` is set it also purges the dep-API edge cache (see below).

## Cloudflare — edge-cache SSR'd dependency API pages

Effect / `@effect/platform-node` / `@effect/sql-sqlite-node` API pages are SSR (full SSG
overflows Waku). Those responses are heavy and used to OOM a 1GB origin under crawl. Edge-cache
them on the free Cloudflare plan (no Workers):

```sh
# Token needs: Zone.Zone Read + Zone.Cache Rules Edit + Zone.Cache Purge
export CLOUDFLARE_API_TOKEN=...
cd docs/site
./scripts/cf-edge-cache.sh ensure   # once (idempotent upsert)
./scripts/cf-edge-cache.sh status   # expect cf-cache-status: HIT on the 2nd probe
```

Rule match: `/api/effect*`, `/api/platform-node*`, `/api/sql-sqlite-node*` on
`hyperlink.cool` / `www`. Edge TTL 1 day with `override_origin` (DO often emits
`Cache-Control: private`). Purge on every image deploy (`deploy-do.sh` calls `purge` when the
token is set; or run `./scripts/cf-edge-cache.sh purge` by hand).

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
