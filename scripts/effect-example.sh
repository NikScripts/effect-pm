#!/usr/bin/env bash
#
# tmux session for the dashboard examples. Opens (or re-attaches to) a session called
# "effect-example" with:
#
#   servers  two panes — mini-server (:7778) and queue-server (:7777), running
#   tui      the Ink dashboard command, pre-typed — press Enter to launch
#   web      the web dashboard (vite) command, pre-typed — press Enter to launch
#
# The servers feed both UIs, so they start automatically; you open the TUI or the web
# UI yourself from their own window (Ctrl-b n / Ctrl-b <number> to switch). Re-running
# this just re-attaches — it never double-starts the servers.
#
#   pnpm run example:session
#
set -euo pipefail

SESSION="effect-example"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

command -v tmux >/dev/null 2>&1 || { echo "tmux is not installed (brew install tmux)" >&2; exit 1; }

attach() {
  if [ -n "${TMUX:-}" ]; then
    tmux switch-client -t "$SESSION"
  else
    tmux attach -t "$SESSION"
  fi
}

# already running → just re-attach, leave the servers alone
if tmux has-session -t "$SESSION" 2>/dev/null; then
  attach
  exit 0
fi

# Fresh session: clear any servers left over from a previously-killed session so the
# ports are free. (tsx doesn't reliably forward SIGHUP to its node child, so a killed
# session can orphan a server — this guarantees a clean start regardless.)
pkill -f "examples/web-dashboard/mini-server.ts" 2>/dev/null || true
pkill -f "examples/web-dashboard/queue-server.ts" 2>/dev/null || true

# `exec` so each command replaces its pane shell — then killing the window/session
# delivers the signal straight to the process tree instead of orphaning tsx/node.

# window 1: the two servers, side by side
tmux new-session -d -s "$SESSION" -n servers -c "$ROOT"
tmux send-keys -t "$SESSION:servers" "exec pnpm run example:mini-server" C-m
tmux split-window -t "$SESSION:servers" -c "$ROOT"
tmux send-keys -t "$SESSION:servers" "exec pnpm run example:queue-server" C-m
tmux select-layout -t "$SESSION:servers" even-vertical

# window 2: the TUI — command ready, you press Enter once the servers are up
tmux new-window -t "$SESSION" -n tui -c "$ROOT"
tmux send-keys -t "$SESSION:tui" "exec pnpm run example:dashboard"

# window 3: the web UI — same, command ready to launch
tmux new-window -t "$SESSION" -n web -c "$ROOT"
tmux send-keys -t "$SESSION:web" "exec pnpm run example:web-dashboard"

# land on the TUI window
tmux select-window -t "$SESSION:tui"
attach
