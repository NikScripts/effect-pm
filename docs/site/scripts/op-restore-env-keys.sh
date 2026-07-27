#!/usr/bin/env bash
# Restore docs/site/.env.keys from 1Password (new machine / wiped keys).
#
#   pnpm run op:restore-keys
#   OP_VAULT=Personal OP_ITEM='Hyperlink docs deploy' ./scripts/op-restore-env-keys.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VAULT="${OP_VAULT:-Personal}"
ITEM="${OP_ITEM:-Hyperlink docs deploy}"
OUT="${ROOT}/.env.keys"

op whoami >/dev/null

KEY="$(op read "op://${VAULT}/${ITEM}/DOTENV_PRIVATE_KEY")"
if [ -z "$KEY" ]; then
  echo "empty key from op://${VAULT}/${ITEM}/DOTENV_PRIVATE_KEY" >&2
  exit 1
fi

cat >"$OUT" <<EOF
#/------------------!DOTENV_PRIVATE_KEYS!-------------------/
#/ private decryption keys. DO NOT commit to source control /
#/     [how it works](https://dotenvx.com/encryption)       /
#/----------------------------------------------------------/
DOTENV_PRIVATE_KEY="${KEY}"
EOF
chmod 600 "$OUT"
echo "==> wrote ${OUT}"
pnpm exec dotenvx run -- printenv DOCS_SITE_ORIGIN
