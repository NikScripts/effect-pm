# Mission: node handoff (zero-downtime updates, cross-version migration)

Owner directive, 2026-07-22. This is the next major goal for the library. This doc states the
mission and its boundaries; the design itself is NOT done and must go through the normal
decisions-doc bake with the owner before any implementation.

## The goal

**Handoff**: a served Hyperlink moves from one node to another without its callers noticing.

Two headline capabilities, in the owner's framing:

1. **Updates without downtime.** Use handoff to update a node: stand up the replacement, hand the
   node's Hyperlinks over, retire the original. Callers keep calling the whole time.
2. **Migration across versions.** Handoff must work **between nodes running different versions of
   the library**. A fleet is never all on one version during a rollout, so version skew is the
   normal case, not the edge case.

## Why this is now natural to attempt

- Placement is already dynamic: peers model, Lookup two-stage Tag/Lookup, `onConflict` threading
  (multi-protocol-nodes work, merged).
- Transports are injected and typed (protocol dependency + loud-failures work, merged).
- Contracts are schema-first everywhere: every value that crosses a boundary already has a codec,
  which is the raw material for cross-version compatibility.

## Known hard problems (bring these to the design discussion, do not solve them silently)

- **Cutover semantics**: what happens to in-flight calls and open streams at the moment of
  handoff (drain? dual-serve? redirect?).
- **Stateful Hyperlinks**: queues and stores carry state; a handoff either transfers it, shares
  it, or declares those kinds non-transferable at first. Scope decision for the owner.
- **Version negotiation**: how two nodes agree on wire shape when their library versions differ;
  what "compatible" means for a contract (schema evolution rules), and what happens on a
  mismatch (typed, loud failure per the loud-failures doctrine, never silent).
- **Discovery during the swap**: Lookup liveness vs. a node that is intentionally draining.

## House constraints that apply

- Design first: decisions doc, owner approval item by item, no code before the go
  (docs/standards/working-agreement.md).
- "What would Effect do" is the standing tiebreaker for API shape.
- The rename ships around this work: the primitive is `Hyperlink`, kinds are being renamed
  (see docs/handoffs/rename-hyperlink-handoff.md and the rebrand memory). Do not build new
  surface on the old names.

## Working setup

- Worktree: `~/Coding/Hyperlink/worktrees/delta` on branch `feat/node-handoff` (cut from
  integration @ 717c3263c). The worktree name is deliberately agent-agnostic; the tree outlives
  any one agent.
- Sync ritual, force-push ban, and green-before-commit are all in
  docs/standards/working-agreement.md.
