#!/usr/bin/env bash
#
# tmux session for the dashboard examples. Creates a *detached* session called
# "effect-example" with:
#
#   servers  two panes — mini-server (:7778) and queue-server (:7777), running
#   tui      the Ink dashboard command, pre-typed — press Enter to launch
#   web      the web dashboard (vite) command, pre-typed — press Enter to launch
#
# The servers feed both UIs, so they start automatically; you open the TUI or the web
# UI yourself from their own window (Ctrl-b n / Ctrl-b <number> to switch).
#
# This script NEVER touches your current tmux client: if you run it from inside tmux it
# just creates the detached session and prints how to switch to it — it will not move,
# attach, or kill the client/session you're already in. It also never kills processes.
#
#   pnpm run example:session
#
set -euo pipefail

SESSION="effect-example"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

command -v tmux >/dev/null 2>&1 || { echo "tmux is not installed (brew install tmux)" >&2; exit 1; }

# How to reach the session, without ever hijacking the current client.
reach() {
  if [ -n "${TMUX:-}" ]; then
    echo "You're already inside tmux — switch to it with:  tmux switch-client -t $SESSION"
    echo "  (or pick it from the session list:  Ctrl-b s )"
  else
    echo "Attach with:  tmux attach -t $SESSION   (detach again with Ctrl-b d)"
  fi
}

# already running → leave it (and its servers) completely alone
if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "Session '$SESSION' is already running."
  reach
  exit 0
fi

# Note (don't act): if a previous session was killed, its servers may still hold the
# ports (tsx doesn't reliably forward SIGHUP to node). We do NOT kill anything here —
# if a server reports EADDRINUSE, free the port yourself, e.g.:
#   lsof -ti tcp:7777 | xargs kill     # queue-server
#   lsof -ti tcp:7778 | xargs kill     # mini-server

# window 1: the two servers, side by side
tmux new-session -d -s "$SESSION" -n servers -c "$ROOT"
tmux send-keys -t "$SESSION:servers" "pnpm run example:apps-dashboard-mini-server" C-m
tmux split-window -t "$SESSION:servers" -c "$ROOT"
tmux send-keys -t "$SESSION:servers" "pnpm run example:apps-dashboard-queue-server" C-m
tmux select-layout -t "$SESSION:servers" even-vertical

# window 2: the TUI — command ready, you press Enter once the servers are up
tmux new-window -t "$SESSION" -n tui -c "$ROOT"
tmux send-keys -t "$SESSION:tui" "pnpm run example:dashboard"

# window 3: the web UI — same, command ready to launch
tmux new-window -t "$SESSION" -n web -c "$ROOT"
tmux send-keys -t "$SESSION:web" "pnpm run example:apps-dashboard"

# land on the TUI window *within the detached session* (does not affect your client)
tmux select-window -t "$SESSION:tui"

echo "Created detached tmux session '$SESSION' (windows: servers · tui · web)."
reach
