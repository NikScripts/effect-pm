#!/usr/bin/env bash
# Build-and-ship for DigitalOcean App Platform. Run from docs/site.
#
#   DOCS_SITE_ORIGIN=https://your.domain ./scripts/deploy-do.sh <docr-registry-name>
#
# Steps: full site build (regens api-data/search/llms/sitemap with absolute URLs, verifies
# links) → docker image (context docs/, artifact only) → push to DOCR → App Platform picks up
# :latest on the next `doctl apps update` (or auto-deploy if enabled on the app).
set -euo pipefail

REGISTRY="${1:?usage: deploy-do.sh <docr-registry-name>}"
: "${DOCS_SITE_ORIGIN:?set DOCS_SITE_ORIGIN so sitemap/llms links go absolute}"

# a deploy is a statement about a COMMIT — refuse a dirty tree
if [ -n "$(git status --porcelain)" ]; then
  echo "refusing to deploy: working tree is dirty" >&2
  exit 1
fi
SHA="$(git rev-parse --short HEAD)"

echo "==> building site @ ${SHA} (origin: ${DOCS_SITE_ORIGIN})"
pnpm build

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
