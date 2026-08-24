#!/usr/bin/env bash
# Build-and-ship for DigitalOcean App Platform. Run from docs/site.
#
#   DOCS_SITE_ORIGIN=https://your.domain ./scripts/deploy-do.sh <docr-registry-name>
#
# Steps: full site build (regens api-data/search/llms/sitemap with absolute URLs, verifies
# links) → SSG integrity gate → docker image → push to DOCR → App Platform deployment →
# wait ACTIVE → CF purge → live route smoke (must be 200). Failures abort before/after ship
# so truncated SSG / API 404s are never "noticed by a human" first.
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
APP_ID="${DO_DOCS_APP_ID:-ed0a18b6-946a-4219-a427-af456d181755}"

echo "==> building site @ ${SHA} (origin: ${DOCS_SITE_ORIGIN})"
pnpm build
# postbuild already runs check-ssg; call again so a future `waku build` shortcut still gates.
echo "==> SSG integrity"
node scripts/check-ssg.mjs

echo "==> docker build + push"
BASE="registry.digitalocean.com/${REGISTRY}/hyperlink-docs"
(cd .. && docker buildx build --platform linux/amd64 --push -f site/Dockerfile -t "${BASE}:${SHA}" -t "${BASE}:latest" .)

if ! command -v doctl >/dev/null 2>&1; then
  echo "refusing to finish deploy: doctl not on PATH (need create-deployment + live smoke)" >&2
  exit 1
fi

echo "==> create-deployment --wait (app ${APP_ID})"
# --wait blocks until ACTIVE (or fails the command); no silent "pushed image, forgot to cut over".
doctl --context hyperlink apps create-deployment "${APP_ID}" --force-rebuild=false --wait
phase="$(doctl --context hyperlink apps list-deployments "${APP_ID}" -o json | node -e '
  const j = JSON.parse(require("fs").readFileSync(0, "utf8"));
  process.stdout.write(String(j[0]?.phase ?? ""));
')"
if [ "${phase}" != "ACTIVE" ]; then
  echo "refusing to continue: latest deployment phase is ${phase:-<empty>} (want ACTIVE)" >&2
  exit 1
fi


# Edge-cached dep API HTML must not outlive the new image.
if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "==> purging Cloudflare dep-API edge cache"
  ./scripts/cf-edge-cache.sh purge
else
  echo "==> skip CF purge (pnpm run cf:purge, or set CLOUDFLARE_API_TOKEN)"
fi

echo "==> live route smoke (${DOCS_SITE_ORIGIN})"
# Brief settle so the new replica is the one answering through Cloudflare.
sleep 5
node scripts/live-routes-smoke.mjs "${DOCS_SITE_ORIGIN}"

echo "==> deploy OK @ ${SHA} (App Platform ACTIVE; live routes green)"
echo "    rollback: retag a previous sha as latest and create-deployment --wait again"
