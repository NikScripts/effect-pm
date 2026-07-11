# Owner decisions log

**Supervisor SSOT for architecture/scope steers from owner chat.** Agents append on the same push as the work that implements the decision.

Format: see [`supervisor-protocol.md`](./supervisor-protocol.md) § Owner decisions.

---

## 2026-07-11 — Queue wire erase + Process live `events` (retroactive — from PR #19/#20 handoff)

*Logged by supervisor from Agent 2 session-4 handoff + owner relay. Agent should have written this before PRs opened.*

- **Owner said:** Fix Queue `events` stream typing (agent was copying Queue pattern for Process); align Process failure visibility with Queue's live stream model.
- **Chose:** Phase 1 — type the **RPC wire** (`queueSpec` / `buildProcessSpec` pass tag `success`/`error`); add Process **`events`** PubSub stream; failures on **`events` + store**, not void lifecycle RPC `error`.
- **Rejected:** Per-tag `processSpec` rebuild for `start`/`stop`/`runImmediately` RPC error channel (Session 2 stretch).
- **Supervisor impact:** Merge **#19 → #20**; changeset required; **#17** (Session 3 consumer docs) must rebase — same files; store **Phase 2** (tier-1 erase) is follow-up, not in these PRs.
