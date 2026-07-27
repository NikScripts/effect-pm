#!/usr/bin/env bash
# Build-and-ship for DigitalOcean App Platform. Run from docs/site.
#
#   DOCS_SITE_ORIGIN=https://your.domain ./scripts/deploy-do.sh <docr-registry-name>
#
# Steps: full site build (regens api-data/search/llms/sitemap with absolute URLs, verifies
# links) → docker image (context docs/, artifact only) → push to DOCR → App Platform picks up
# :latest on the next `doctl apps update` (or auto-deploy if enabled on the app).
set -euo pipefail

# `pnpm run deploy:do -- <registry>` can forward a literal `--` through dotenvx; skip all of them.
while [ "${1:-}" = "--" ]; do shift; done
REGISTRY="${1:?usage: deploy-do.sh <docr-registry-name>}"
case "${REGISTRY}" in
  "" | -* | *[!a-zA-Z0-9._-]*)
    echo "refusing to deploy: invalid DOCR registry name (got: ${REGISTRY:-<empty>})" >&2
    echo "  tip: pnpm run deploy:do -- <registry>   e.g. hyperlink-docs" >&2
    exit 1
    ;;
esac
: "${DOCS_SITE_ORIGIN:?set DOCS_SITE_ORIGIN so sitemap/llms links go absolute}"

# Guard against baking dotenvx ciphertext (or any non-URL) into canonical/og tags.
case "${DOCS_SITE_ORIGIN}" in
  https://* | http://*) ;;
  *)
    echo "refusing to deploy: DOCS_SITE_ORIGIN must be an http(s) URL (got: ${DOCS_SITE_ORIGIN})" >&2
    echo "  tip: use \`pnpm run deploy:do\` so dotenvx decrypts docs/site/.env" >&2
    exit 1
    ;;
esac

# a deploy is a statement about a COMMIT — refuse a dirty tree
if [ -n "$(git status --porcelain)" ]; then
  echo "refusing to deploy: working tree is dirty" >&2
  exit 1
fi
SHA="$(git rev-parse --short HEAD)"

echo "==> building site @ ${SHA} (origin: ${DOCS_SITE_ORIGIN})"
pnpm build

# Guard: a waku-only rebuild without api-data/index.json yields ~90 HTML files and ships
# 404s for every /api/<pkg> and /api/<pkg>/<module> URL (symbols can still SSR). A healthy
# hyperlink-ts prerender is hundreds of pages; refuse to push a truncated artifact.
if [ ! -f api-data/index.json ]; then
  echo "refusing to deploy: api-data/index.json missing after build" >&2
  exit 1
fi
API_HTML=$(find dist/public/api -name '*.html' 2>/dev/null | wc -l | tr -d ' ')
if [ "${API_HTML}" -lt 200 ]; then
  echo "refusing to deploy: only ${API_HTML} api HTML page(s) under dist/public/api (need ≥200)" >&2
  echo "  tip: ensure gen-api wrote api-data/index.json, then re-run a full \`pnpm build\`" >&2
  exit 1
fi
for must in \
  dist/public/api/hyperlink-ts/index.html \
  dist/public/api/hyperlink-ts/WorkPool/index.html
do
  if [ ! -f "${must}" ]; then
    echo "refusing to deploy: missing ${must}" >&2
    exit 1
  fi
done
echo "==> api SSG ok (${API_HTML} html pages; WorkPool module present)"

echo "==> docker build"
BASE="registry.digitalocean.com/${REGISTRY}/hyperlink-docs"
(cd .. && docker buildx build --platform linux/amd64 --push -f site/Dockerfile -t "${BASE}:${SHA}" -t "${BASE}:latest" .)

APP_ID="${DO_DOCS_APP_ID:-<app-id>}"
echo "==> done — deploy: doctl --context hyperlink apps update ${APP_ID} --spec deploy/do-app.yaml"
echo "    rollback: retag a previous sha as latest and update again"
echo "    (banners: DOCS_SITE_ORIGIN=${DOCS_SITE_ORIGIN} npx tsx scripts/gen-doc-banners.ts)"

# Edge-cached dep API HTML must not outlive the new image.
# Prefer: pnpm run deploy:do -- <registry>  (dotenvx injects CLOUDFLARE_API_TOKEN)
if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "==> purging Cloudflare dep-API edge cache"
  ./scripts/cf-edge-cache.sh purge
else
  echo "==> skip CF purge (pnpm run cf:purge, or set CLOUDFLARE_API_TOKEN)"
fi
