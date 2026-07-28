#!/usr/bin/env bash
# Upsert Cloudflare Cache Rules for the docs site + optional purge.
#
# Free plan: Cache Rules are included (no Workers). Origin DO often sends
# `Cache-Control: private`; we override at the edge with override_origin.
#
# Rules:
#   1) dep API SSR pages (/api/effect*|platform-node*|sql-sqlite-node*)
#   2) fingerprinted assets + search/llms/favicon/og/robots (/assets*, /search*, …)
#
#   export CLOUDFLARE_API_TOKEN=...   # Zone.Cache Rules Edit + Zone.Cache Purge + Zone.Zone Read
#   export CLOUDFLARE_ZONE_ID=...     # optional — looked up from hyperlink.cool when unset
#
#   ./scripts/cf-edge-cache.sh ensure   # create/update Cache Rules
#   ./scripts/cf-edge-cache.sh purge    # purge after a docs deploy
#   ./scripts/cf-edge-cache.sh status   # show rules + HIT/MISS probes
#
set -euo pipefail

API="https://api.cloudflare.com/client/v4"
ZONE_NAME="${CLOUDFLARE_ZONE_NAME:-hyperlink.cool}"
HOST_EXPR='(http.host eq "hyperlink.cool" or http.host eq "www.hyperlink.cool")'

DEP_RULE_DESC="${CF_CACHE_RULE_DESCRIPTION:-hyperlink-docs dep API SSR edge cache}"
STATIC_RULE_DESC="${CF_STATIC_CACHE_RULE_DESCRIPTION:-hyperlink-docs static assets + search corpus}"
# 1 day for HTML/API/search; year for hashed /assets/* (browser_ttl still capped below).
EDGE_TTL_SECONDS="${CF_EDGE_TTL_SECONDS:-86400}"
ASSET_EDGE_TTL_SECONDS="${CF_ASSET_EDGE_TTL_SECONDS:-31536000}"

: "${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN (Cache Rules Edit + Cache Purge + Zone Read)}"

cf() {
  local method="$1" path="$2"
  shift 2
  curl -sS -X "$method" "${API}${path}" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json" \
    "$@"
}

json_ok() {
  python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get("success") else 1)' <<<"$1" \
    || { echo "$1" >&2; echo "cloudflare API error" >&2; exit 1; }
}

json_success() {
  python3 -c 'import json,sys; d=json.load(sys.stdin); raise SystemExit(0 if d.get("success") else 1)' <<<"$1" 2>/dev/null
}

resolve_zone() {
  if [ -n "${CLOUDFLARE_ZONE_ID:-}" ]; then
    echo "$CLOUDFLARE_ZONE_ID"
    return
  fi
  local body
  body="$(cf GET "/zones?name=${ZONE_NAME}&status=active")"
  json_ok "$body"
  python3 -c '
import json,sys
r=json.load(sys.stdin)["result"]
if not r:
  raise SystemExit("zone not found")
print(r[0]["id"])
' <<<"$body"
}

rule_payload() {
  local desc="$1" expr="$2" edge_ttl="$3" browser_ttl="$4"
  DESC="$desc" EXPR="$expr" EDGE="$edge_ttl" BROWSER="$browser_ttl" python3 -c '
import json, os
print(json.dumps({
  "description": os.environ["DESC"],
  "expression": os.environ["EXPR"],
  "action": "set_cache_settings",
  "action_parameters": {
    "cache": True,
    "edge_ttl": {"mode": "override_origin", "default": int(os.environ["EDGE"])},
    "browser_ttl": {"mode": "override_origin", "default": int(os.environ["BROWSER"])},
    "serve_stale": {"disable_stale_while_updating": False},
  },
  "enabled": True,
}))
'
}

get_entrypoint() {
  local zone_id="$1"
  cf GET "/zones/${zone_id}/rulesets/phases/http_request_cache_settings/entrypoint"
}

ensure_one_rule() {
  local zone_id="$1" ruleset_id="$2" desc="$3" expr="$4" edge_ttl="$5" browser_ttl="$6"
  local body existing_id payload
  body="$(get_entrypoint "$zone_id")"
  json_ok "$body"
  existing_id="$(
    DESC="$desc" python3 -c '
import json, sys, os
desc = os.environ["DESC"]
for r in json.load(sys.stdin)["result"].get("rules") or []:
  if r.get("description") == desc:
    print(r["id"])
    break
' <<<"$body"
  )"
  payload="$(rule_payload "$desc" "$expr" "$edge_ttl" "$browser_ttl")"
  if [ -n "$existing_id" ]; then
    echo "==> updating Cache Rule ${existing_id} (${desc})"
    body="$(cf PATCH "/zones/${zone_id}/rulesets/${ruleset_id}/rules/${existing_id}" --data "$payload")"
  else
    echo "==> creating Cache Rule (${desc})"
    body="$(cf POST "/zones/${zone_id}/rulesets/${ruleset_id}/rules" --data "$payload")"
  fi
  json_ok "$body"
  echo "==> ensured: ${desc} (edge TTL ${edge_ttl}s, browser ${browser_ttl}s, override_origin)"
}

ensure_rules() {
  local zone_id body ruleset_id
  zone_id="$(resolve_zone)"
  echo "==> zone ${ZONE_NAME} (${zone_id})"

  body="$(get_entrypoint "$zone_id")"
  if ! json_success "$body"; then
    echo "==> creating http_request_cache_settings ruleset"
    body="$(cf POST "/zones/${zone_id}/rulesets" --data "$(python3 -c '
import json
print(json.dumps({
  "name": "Cache Rules",
  "kind": "zone",
  "phase": "http_request_cache_settings",
  "rules": [],
}))
')")"
    json_ok "$body"
    body="$(get_entrypoint "$zone_id")"
    json_ok "$body"
  fi

  ruleset_id="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["result"]["id"])' <<<"$body")"

  ensure_one_rule "$zone_id" "$ruleset_id" "$DEP_RULE_DESC" \
    "${HOST_EXPR} and (starts_with(http.request.uri.path, \"/api/effect\") or starts_with(http.request.uri.path, \"/api/platform-node\") or starts_with(http.request.uri.path, \"/api/sql-sqlite-node\"))" \
    "$EDGE_TTL_SECONDS" 300

  # Fingerprinted /assets/* + deploy-static corpus. Long edge TTL; browsers get 1 day on
  # non-hashed paths via browser_ttl (hashed assets still revalidate via new filenames).
  ensure_one_rule "$zone_id" "$ruleset_id" "$STATIC_RULE_DESC" \
    "${HOST_EXPR} and (starts_with(http.request.uri.path, \"/assets/\") or starts_with(http.request.uri.path, \"/search/\") or http.request.uri.path in {\"/favicon.svg\" \"/og.svg\" \"/robots.txt\" \"/llms.txt\" \"/llms-full.txt\" \"/sitemap.xml\" \"/healthz\"})" \
    "$ASSET_EDGE_TTL_SECONDS" 86400
}

purge_prefixes() {
  local zone_id body
  zone_id="$(resolve_zone)"
  echo "==> purging edge prefixes on ${ZONE_NAME}"
  body="$(cf POST "/zones/${zone_id}/purge_cache" --data "$(python3 -c '
import json
print(json.dumps({
  "prefixes": [
    "hyperlink.cool/api/effect",
    "hyperlink.cool/api/platform-node",
    "hyperlink.cool/api/sql-sqlite-node",
    "hyperlink.cool/assets",
    "hyperlink.cool/search",
    "www.hyperlink.cool/api/effect",
    "www.hyperlink.cool/api/platform-node",
    "www.hyperlink.cool/api/sql-sqlite-node",
    "www.hyperlink.cool/assets",
    "www.hyperlink.cool/search",
  ]
}))
')")"
  if json_success "$body"; then
    echo "==> prefix purge ok"
    return
  fi
  echo "==> prefix purge unavailable on this plan; purging entire zone (safe — static assets re-HIT quickly)"
  echo "$body" >&2
  body="$(cf POST "/zones/${zone_id}/purge_cache" --data '{"purge_everything":true}')"
  json_ok "$body"
  echo "==> zone purge ok"
}

status() {
  local zone_id body
  zone_id="$(resolve_zone)"
  body="$(get_entrypoint "$zone_id")"
  if json_success "$body"; then
    python3 -c '
import json, sys
rules = json.load(sys.stdin)["result"].get("rules") or []
print("%d cache-settings rule(s):" % len(rules))
for r in rules:
  print("  - %s enabled=%s" % (r.get("description"), r.get("enabled")))
  print("    expr: %s" % r.get("expression"))
' <<<"$body"
  else
    echo "no http_request_cache_settings ruleset yet (run: ensure)"
  fi
  for path in "/api/effect/Effect/retry" "/assets/" "/favicon.svg"; do
    # /assets/ alone 404s — probe is filled below after we resolve a real asset URL
    :
  done
  echo "==> probe dep API"
  curl -sS -D- -o /dev/null --max-time 45 "https://${ZONE_NAME}/api/effect/Effect/retry" \
    | grep -iE '^(HTTP/|cf-cache-status:|cache-control:|age:)' || true
  curl -sS -D- -o /dev/null --max-time 45 "https://${ZONE_NAME}/api/effect/Effect/retry" \
    | grep -iE '^(HTTP/|cf-cache-status:|cache-control:|age:)' || true
  ASSET="$(curl -sS --max-time 20 "https://${ZONE_NAME}/" | sed -n 's/.*href="\(\/assets\/_layout-[^"]*\.css\)".*/\1/p' | head -1)"
  if [ -n "$ASSET" ]; then
    echo "==> probe asset ${ASSET}"
    curl -sS -D- -o /dev/null --max-time 45 "https://${ZONE_NAME}${ASSET}" \
      | grep -iE '^(HTTP/|cf-cache-status:|cache-control:|age:)' || true
    curl -sS -D- -o /dev/null --max-time 45 "https://${ZONE_NAME}${ASSET}" \
      | grep -iE '^(HTTP/|cf-cache-status:|cache-control:|age:)' || true
  fi
}

CMD="${1:-}"
case "$CMD" in
  ensure) ensure_rules ;;
  purge) purge_prefixes ;;
  status) status ;;
  *)
    echo "usage: $0 ensure|purge|status" >&2
    exit 2
    ;;
esac
