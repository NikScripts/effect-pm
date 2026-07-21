# Deploying the docs site (DigitalOcean App Platform + Cloudflare)

The site is a Node service (Waku `start`): effect-pm pages are pre-rendered static; effect dep
API pages SSR on demand reading `api-data/` + `api-hovers/` from disk. **The artifact deploys;
DO never builds** — a fresh builder has no hover cache (that's a 1.5 h gen-hovers run per deploy).

## One-time setup

1. DOCR registry + app:
   ```sh
   doctl registry create <registry-name>
   doctl apps create --spec docs/site/deploy/do-app.yaml
   ```
2. Cloudflare in front (free tier): DNS-proxy the app's hostname. Cache rules — long TTL for
   `/search/*`, `/assets/*`, `/llms*.txt`, `/sitemap.xml`; edge brotli covers the corpus the
   origin serves uncompressed.
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

## Local smoke of the exact image

```sh
cd docs && docker build -f site/Dockerfile -t effect-pm-docs:test .
docker run --rm -p 8081:8080 effect-pm-docs:test
# static:  curl localhost:8081/api/effect-pm/Polling
# SSR:     curl localhost:8081/api/effect/Effect/retry   (hover popups present)
# assets:  curl localhost:8081/search/api.json  /llms.txt  /sitemap.xml
```

Gotcha that bit us on the first try: the image packages whatever `dist/` exists — **always build
immediately before `docker build`** (the script enforces the order).
