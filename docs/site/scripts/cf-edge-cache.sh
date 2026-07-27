#!/usr/bin/env bash
# Upsert Cloudflare Cache Rules for SSR'd dependency API pages + optional purge.
#
# Free plan: Cache Rules are included (no Workers). Origin DO often sends
# `Cache-Control: private`; we override at the edge.
#
#   export CLOUDFLARE_API_TOKEN=...   # Zone.Cache Rules Edit + Zone.Cache Purge + Zone.Zone Read
#   export CLOUDFLARE_ZONE_ID=...     # optional — looked up from hyperlink.cool when unset
#
#   ./scripts/cf-edge-cache.sh ensure   # create/update the Cache Rule
#   ./scripts/cf-edge-cache.sh purge    # purge dep-API prefixes after a docs deploy
#   ./scripts/cf-edge-cache.sh status   # show matching rules + a HIT/MISS probe
#
set -euo pipefail

API="https://api.cloudflare.com/client/v4"
ZONE_NAME="${CLOUDFLARE_ZONE_NAME:-hyperlink.cool}"
RULE_DESCRIPTION="${CF_CACHE_RULE_DESCRIPTION:-hyperlink-docs dep API SSR edge cache}"
# 1 day edge TTL; purge-on-deploy keeps content fresh.
EDGE_TTL_SECONDS="${CF_EDGE_TTL_SECONDS:-86400}"

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

rule_expression() {
  printf '%s' '(http.host eq "hyperlink.cool" or http.host eq "www.hyperlink.cool") and (starts_with(http.request.uri.path, "/api/effect") or starts_with(http.request.uri.path, "/api/platform-node") or starts_with(http.request.uri.path, "/api/sql-sqlite-node"))'
}

rule_payload() {
  EXPR="$(rule_expression)" DESC="$RULE_DESCRIPTION" TTL="$EDGE_TTL_SECONDS" python3 -c '
import json, os
print(json.dumps({
  "description": os.environ["DESC"],
  "expression": os.environ["EXPR"],
  "action": "set_cache_settings",
  "action_parameters": {
    "cache": True,
    "edge_ttl": {"mode": "override_origin", "default": int(os.environ["TTL"])},
    "browser_ttl": {"mode": "override_origin", "default": 300},
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

ensure_rule() {
  local zone_id body ruleset_id existing_id payload
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
  existing_id="$(
    DESC="$RULE_DESCRIPTION" python3 -c '
import json, sys, os
desc = os.environ["DESC"]
for r in json.load(sys.stdin)["result"].get("rules") or []:
  if r.get("description") == desc:
    print(r["id"])
    break
' <<<"$body"
  )"

  payload="$(rule_payload)"

  if [ -n "$existing_id" ]; then
    echo "==> updating Cache Rule ${existing_id}"
    body="$(cf PATCH "/zones/${zone_id}/rulesets/${ruleset_id}/rules/${existing_id}" --data "$payload")"
  else
    echo "==> creating Cache Rule"
    body="$(cf POST "/zones/${zone_id}/rulesets/${ruleset_id}/rules" --data "$payload")"
  fi
  json_ok "$body"
  echo "==> ensured: ${RULE_DESCRIPTION} (edge TTL ${EDGE_TTL_SECONDS}s, override_origin)"
}

purge_prefixes() {
  local zone_id body
  zone_id="$(resolve_zone)"
  echo "==> purging dep API prefixes on ${ZONE_NAME}"
  body="$(cf POST "/zones/${zone_id}/purge_cache" --data "$(python3 -c '
import json
print(json.dumps({
  "prefixes": [
    "hyperlink.cool/api/effect",
    "hyperlink.cool/api/platform-node",
    "hyperlink.cool/api/sql-sqlite-node",
    "www.hyperlink.cool/api/effect",
    "www.hyperlink.cool/api/platform-node",
    "www.hyperlink.cool/api/sql-sqlite-node",
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
    DESC="$RULE_DESCRIPTION" python3 -c '
import json, sys, os
desc = os.environ["DESC"]
rules = json.load(sys.stdin)["result"].get("rules") or []
print("%d cache-settings rule(s):" % len(rules))
for r in rules:
  mark = " *" if r.get("description") == desc else ""
  print("  - %s enabled=%s%s" % (r.get("description"), r.get("enabled"), mark))
  if r.get("description") == desc:
    print("    expr: %s" % r.get("expression"))
' <<<"$body"
  else
    echo "no http_request_cache_settings ruleset yet (run: ensure)"
  fi
  echo "==> probe https://${ZONE_NAME}/api/effect/Effect/retry"
  # grep not rg — login shells on this host may lack ripgrep on PATH
  curl -sS -D- -o /dev/null --max-time 45 "https://${ZONE_NAME}/api/effect/Effect/retry" \
    | grep -iE '^(HTTP/|cf-cache-status:|cache-control:|age:)' || true
  echo "==> second probe (expect HIT after first populate)"
  curl -sS -D- -o /dev/null --max-time 45 "https://${ZONE_NAME}/api/effect/Effect/retry" \
    | grep -iE '^(HTTP/|cf-cache-status:|cache-control:|age:)' || true
}

CMD="${1:-}"
case "$CMD" in
  ensure) ensure_rule ;;
  purge) purge_prefixes ;;
  status) status ;;
  *)
    echo "usage: $0 ensure|purge|status" >&2
    exit 2
    ;;
esac
