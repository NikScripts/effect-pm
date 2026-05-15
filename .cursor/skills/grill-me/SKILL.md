---
name: grill-me
description: Interview the user relentlessly about a plan or design until reaching shared understanding, resolving each branch of the decision tree. Use when user wants to stress-test a plan, get grilled on their design, or mentions "grill me".
---

# Grill Me

Use this skill when the user wants to stress-test a plan, architecture, product
decision, implementation strategy, migration, or design. Your job is to
interview the user relentlessly until you and the user reach shared
understanding.

## Core behavior

1. Ask exactly one question at a time.
2. For every question, include your recommended answer.
3. If a question can be answered by inspecting the codebase, inspect the
   codebase instead of asking the user.
4. Walk the design tree branch by branch. Resolve dependencies between
   decisions before moving to downstream decisions.
5. Keep pressing until assumptions, tradeoffs, constraints, failure modes, and
   acceptance criteria are explicit.
6. Do not skip a branch just because the likely answer seems obvious. Either
   verify it from the codebase or ask.

## Interview loop

For each step:

1. State the current decision branch in one concise sentence.
2. Ask one pointed question.
3. Provide a recommended answer under `Recommended answer:`.
4. Wait for the user's answer before asking the next question.

If the user answers ambiguously, ask a clarifying follow-up before continuing.
If the answer changes an upstream decision, revisit affected downstream
branches before proceeding.

## Codebase exploration rule

Before asking about repository-specific facts, search or read the codebase to
answer them directly. Examples:

- Existing API shape, package boundaries, or naming conventions.
- Current data model, persistence, feature flags, or config.
- Existing tests, fixtures, examples, docs, or migration patterns.
- Existing user flows and edge cases represented in code.

After exploring, summarize what you found briefly and ask only for the remaining
decision that requires user judgment.

## Branches to resolve

Cover these branches when relevant:

- Goal and non-goals.
- Users, use cases, and success criteria.
- Current system behavior and constraints.
- Data model and lifecycle.
- API or UI contract.
- State transitions and edge cases.
- Error handling, retries, cancellation, and recovery.
- Security, privacy, and permissions.
- Performance, scalability, and operational impact.
- Migration, rollout, compatibility, and rollback.
- Observability, logging, metrics, and debugging.
- Testing strategy and acceptance evidence.
- Documentation, release notes, and changeset needs.

## Output format

Use this format for each turn:

Current branch: `<branch>`

Question: `<one question>`

Recommended answer: `<your recommendation>`
