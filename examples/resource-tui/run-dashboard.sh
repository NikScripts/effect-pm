#!/usr/bin/env bash
#
# One window, three processes. Boots the queue-server (:7777) and mini-server (:7778)
# in the background, waits for both to listen, then runs the Ink dashboard in the
# foreground. Server logs are tucked away in a temp dir (printing them would bleed onto
# the TUI's alt-screen); both servers are killed when the dashboard exits — including
# Ctrl+C — so nothing is left running.
#
#   pnpm run example:dashboard-all
#
set -euo pipefail

# repo root = two levels up from this script, regardless of where it's invoked from
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

LOGDIR="$(mktemp -d "${TMPDIR:-/tmp}/effect-pm-dashboard.XXXXXX")"
PIDS=()

cleanup() {
  for pid in "${PIDS[@]:-}"; do
    [ -n "${pid:-}" ] && kill "$pid" 2>/dev/null || true
  done
  # kill the whole process group of each tsx (it forks node) to be sure nothing lingers
  for pid in "${PIDS[@]:-}"; do
    [ -n "${pid:-}" ] && pkill -P "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT INT TERM

wait_for_port() {
  local port="$1" name="$2" tries=0
  printf 'waiting for %s on :%s' "$name" "$port"
  until curl -s -o /dev/null "http://localhost:${port}/" 2>/dev/null; do
    tries=$((tries + 1))
    if [ "$tries" -gt 100 ]; then
      printf '\n%s did not come up — see %s\n' "$name" "$LOGDIR/${name}.log" >&2
      tail -20 "$LOGDIR/${name}.log" >&2 || true
      exit 1
    fi
    printf '.'
    sleep 0.2
  done
  printf ' ok\n'
}

echo "logs: $LOGDIR"

pnpm run example:queue-server >"$LOGDIR/queue-server.log" 2>&1 &
PIDS+=("$!")
pnpm run example:mini-server  >"$LOGDIR/mini-server.log"  2>&1 &
PIDS+=("$!")

wait_for_port 7777 queue-server
wait_for_port 7778 mini-server

# foreground: the dashboard owns the terminal until you quit (Ctrl+C), then cleanup runs.
pnpm run example:dashboard
