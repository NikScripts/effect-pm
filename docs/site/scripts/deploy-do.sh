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
BASE="registry.digitalocean.com/${REGISTRY}/effect-pm-docs"
(cd .. && docker build -f site/Dockerfile -t "${BASE}:${SHA}" -t "${BASE}:latest" .)

echo "==> push (sha-tagged for rollback + latest for the app spec)"
docker push "${BASE}:${SHA}"
docker push "${BASE}:latest"

echo "==> done — deploy: doctl apps update <app-id> --spec deploy/do-app.yaml"
echo "    rollback: retag a previous sha as latest and update again"
echo "    (banners: DOCS_SITE_ORIGIN=${DOCS_SITE_ORIGIN} npx tsx scripts/gen-doc-banners.ts)"
