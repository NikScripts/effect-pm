#!/usr/bin/env bash
# One-time: stash docs-site dotenvx private key (+ optional CF token) in 1Password,
# and verify CLI can read them back.
#
# Prerequisites (interactive — do these in the 1Password app first):
#   1. Unlock 1Password
#   2. Settings → Developer → enable "Integrate with 1Password CLI"
#   3. Approve any CLI authorization prompt when this script first calls `op`
#
# Usage (from docs/site):
#   ./scripts/op-bootstrap-docs-secrets.sh
#   CLOUDFLARE_API_TOKEN='…' ./scripts/op-bootstrap-docs-secrets.sh   # also store CF token
#
# Env:
#   OP_VAULT   default: Personal
#   OP_ITEM    default: Hyperlink docs deploy
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VAULT="${OP_VAULT:-Personal}"
ITEM="${OP_ITEM:-Hyperlink docs deploy}"
KEYS_FILE="${ROOT}/.env.keys"

if [ ! -f "$KEYS_FILE" ]; then
  echo "missing ${KEYS_FILE} — run dotenvx encrypt first (or restore keys)" >&2
  exit 1
fi

PRIVATE_KEY="$(
  # dotenvx writes DOTENV_PRIVATE_KEY=hex (sometimes quoted)
  awk -F= '/^DOTENV_PRIVATE_KEY=/{sub(/^DOTENV_PRIVATE_KEY=/,""); gsub(/^"/,""); gsub(/"$/,""); print; exit}' "$KEYS_FILE"
)"
if [ -z "$PRIVATE_KEY" ]; then
  echo "could not parse DOTENV_PRIVATE_KEY from ${KEYS_FILE}" >&2
  exit 1
fi

# `op` blocks indefinitely when the desktop app hasn't authorized CLI yet — never
# wait on a bare `op` call. Race a background `op` against a 3s killer.
op_ok() {
  local pid killer
  op whoami >/dev/null 2>&1 &
  pid=$!
  ( sleep 3; kill "$pid" >/dev/null 2>&1 ) &
  killer=$!
  if wait "$pid" >/dev/null 2>&1; then
    kill "$killer" >/dev/null 2>&1 || true
    wait "$killer" >/dev/null 2>&1 || true
    return 0
  fi
  kill "$killer" >/dev/null 2>&1 || true
  wait "$killer" >/dev/null 2>&1 || true
  return 1
}

echo "==> waiting for 1Password CLI (unlock app + enable Developer → CLI integration)"
echo "    tmux attach -t onepassword-setup   # if you need to watch"
for i in $(seq 1 120); do
  if op_ok; then
    echo "==> CLI ready (attempt ${i})"
    break
  fi
  if [ "$i" -eq 120 ]; then
    echo "timed out waiting for op whoami (~6 min)" >&2
    echo "Enable: 1Password → Settings → Developer → Integrate with 1Password CLI" >&2
    exit 1
  fi
  # progress every ~30s
  if [ $((i % 10)) -eq 0 ]; then
    echo "    still waiting… (${i}/120) unlock 1Password + enable CLI integration"
  fi
  sleep 3
done
op whoami
echo "==> vaults:"
op vault list

# Create or update item
if op item get "$ITEM" --vault "$VAULT" >/dev/null 2>&1; then
  echo "==> updating existing item: ${VAULT}/${ITEM}"
  op item edit "$ITEM" --vault "$VAULT" \
    "DOTENV_PRIVATE_KEY[password]=${PRIVATE_KEY}" \
    >/dev/null
else
  echo "==> creating item: ${VAULT}/${ITEM}"
  op item create \
    --category=Password \
    --title="$ITEM" \
    --vault="$VAULT" \
    "DOTENV_PRIVATE_KEY[password]=${PRIVATE_KEY}" \
    "notesPlain=Hyperlink docs site (docs/site) dotenvx private key. Restore with: pnpm run op:restore-keys" \
    >/dev/null
fi

if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "==> storing CLOUDFLARE_API_TOKEN on item"
  op item edit "$ITEM" --vault "$VAULT" \
    "CLOUDFLARE_API_TOKEN[password]=${CLOUDFLARE_API_TOKEN}" \
    >/dev/null
fi

echo "==> verify read-back (key length only)"
GOT_LEN="$(op read "op://${VAULT}/${ITEM}/DOTENV_PRIVATE_KEY" | wc -c | tr -d ' ')"
echo "    DOTENV_PRIVATE_KEY chars: ${GOT_LEN}"

if op item get "$ITEM" --vault "$VAULT" --fields label=CLOUDFLARE_API_TOKEN >/dev/null 2>&1; then
  echo "    CLOUDFLARE_API_TOKEN: present"
else
  echo "    CLOUDFLARE_API_TOKEN: not set (re-run with CLOUDFLARE_API_TOKEN=… or set in 1Password UI)"
fi

echo "==> done"
echo "    Reference: op://${VAULT}/${ITEM}/DOTENV_PRIVATE_KEY"
echo "    Restore keys: pnpm run op:restore-keys"
echo "    Next: pnpm exec dotenvx set CLOUDFLARE_API_TOKEN \"\$(op read 'op://${VAULT}/${ITEM}/CLOUDFLARE_API_TOKEN')\""
echo "          pnpm run cf:ensure && pnpm run cf:status"
