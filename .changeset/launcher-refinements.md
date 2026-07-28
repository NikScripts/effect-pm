---
"hyperlink-ts": patch
---

Launcher refinements (value-ordered): auto-read `readyTimeoutConfig` / `readyPollConfig` when omitted on the spec; `Launcher.command` for assume-token env/argv injection; Effect metrics `launcher_ready_duration_ms`, `launcher_ready_timeout_total`, `launcher_child_exited_total`, `launcher_handoff_total`.
