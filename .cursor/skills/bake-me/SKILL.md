---
name: bake-me
description: "Guide the user through advanced design decisions as a recipe: each question is a step with code examples, ingredients, rationale, alternatives, and acceptance checks. Use when the user wants a more visual and efficient version of grill-me, asks to bake a plan, or wants a design refined before implementation."
---

# Bake Me

Use this skill when the user wants to refine a plan, API, architecture, migration,
or implementation strategy with high signal and less back-and-forth than
`grill-me`.

The style is a recipe: show the dish, ingredients, steps, alternatives, and
how we know it is baked. Each question is a recipe step. The ingredients are the
recommended answers for that step.

The chat is the user-facing surface. Always put the full recipe card, decision
steps, examples, alternatives, and acceptance checks in the chat. Use Markdown
code blocks for code, command, JSON, HTTP, and file-layout pictures. The recipe
file is the agent memory ledger and should mirror the chat; never rely on the
user opening the recipe file to see the substance of the bake session.

## Core behavior

1. Ask one decision area at a time, but include every pointed subquestion needed
   to decide that area quickly. Do not reduce a rich design branch to a single
   yes/no question unless it is truly the only question.
2. Every decision area must include:
   - the recipe step,
   - a concise explanation of what the step decides,
   - recommended ingredients,
   - code examples or pseudo-code "pictures",
   - why the recommendation is good,
   - viable alternatives with tradeoffs,
   - a compact decision step set,
   - an acceptance check.
3. If repository facts can answer part of the decision, inspect the codebase
   before asking.
4. Prefer fewer, richer questions over many tiny questions.
5. Keep each step scoped to one decision branch, but load that branch with the
   related questions, examples, and acceptance checks needed to make the decision
   in one pass.
6. Wait for the user's answer before moving to the next recipe step.
7. When the user selects an option, restate the decision as a locked ingredient
   before continuing.

## Recipe flow

### 1. Mise en place

Before the first question, gather relevant context:

- existing APIs, types, docs, tests, examples, and naming conventions;
- current broken states or migration constraints;
- prior user preferences from the conversation.

Then summarize only the facts that materially affect the next decision.

### 2. Recipe file

Create a committed Markdown recipe file for every baked design thread.

Default location:

- `docs/recipes/<short-topic>.md` when the decision concerns repo behavior,
  public API, architecture, migration, or testing.
- `.cursor/recipes/<short-topic>.md` only for agent-local workflow decisions
  that should not be user-facing docs.

The recipe file is the working decision artifact. It should include:

- goal and non-goals;
- mise en place findings;
- locked ingredients;
- open recipe steps;
- code pictures;
- alternatives and rejected substitutions;
- acceptance checks;
- cleanup status.

Commit recipe file updates as decisions are locked. When the recipe is fully
implemented, moved into durable docs, or no longer needed, remove the recipe file
in a cleanup commit and point to the replacement docs / code / tests in the
commit message or final summary.

Do not leave stale recipe files behind after the plan has shipped.

### 3. One step per decision

Use this format for every step:

````md
Recipe step: `<step name>`

What this decides:
`<one or two sentences>`

Recommended ingredients:
- `<ingredient>` — `<why it belongs>`

Picture:
```ts
// Code or pseudo-code showing the recommendation.
```

Alternatives:
1. `<alternative>` — `<tradeoff>`
2. `<alternative>` — `<tradeoff>`

Decision steps:
1. `<pointed question>`
2. `<pointed question>`

Ingredients:
`<the recommended answer set and why>`

Acceptance check:
`<how we will know this decision worked>`
````

### 4. Decision ledger

Maintain a terse ledger as decisions are locked:

```md
Locked ingredients:
- `State.Scope` root scopes provide root leaf only.
- `withLeaf` child scopes provide child leaf only.
```

Show the ledger only when useful, usually after a user answers or before a
downstream decision depends on it.

Mirror the ledger into the recipe file whenever a decision is locked.

### 5. Efficiency rules

- Use code examples instead of abstract prose when possible.
- Collapse obvious low-risk subdecisions into the recommended ingredients.
- Ask the user only about judgment calls, not facts the codebase can answer.
- When the recommendation is clearly dominant, say so and ask for confirmation.
- When alternatives are materially different, make the tradeoff explicit.

## Branches to bake

Cover these branches when relevant:

- Goal and non-goals.
- Public API and naming.
- Type model and invariants.
- Runtime data flow and lifecycle.
- Error handling and recovery.
- Observability and logging.
- Migration and compatibility.
- Testing and acceptance evidence.
- Docs, examples, and changeset needs.

## Examples

### API naming step

````md
Recipe step: Child scope constructor naming

What this decides:
How authors create a child scope whose runtime layer provides only the child
leaf and derives the full state from parent DI.

Recommended ingredients:
- `withLeaf` — reads as an action and leaves `MyScope.Leaf` available for the
  leaf schema.

Picture:
```ts
class EntryScope extends WorkerScope.withLeaf<EntryScope>()("Entry", {
  entryId: Schema.String,
})("@pm/EntryScope") {}

EntryScope.Leaf
EntryScope.State
EntryScope.Schema.Leaf.entryId
EntryScope.Schema.State.Worker.Entry.entryId
```

Alternatives:
1. `ParentScope.Leaf` — shorter, but conflicts with `MyScope.Leaf` as a schema.
2. `withState` — technically accurate, but suggests callers provide full state.

Question:
Should child scopes use `withLeaf`?

Recommended answer:
Yes, because it preserves `Leaf` as a noun/schema and makes provision semantics
obvious.

Acceptance check:
Tests show child `layer(...)` accepts only the child leaf and assembles full
nested state from parent scope services.
````

## When not to use

Do not use this skill for:

- simple implementation tasks with no meaningful design branch;
- status updates;
- direct code review unless the user asks to bake a design alternative.
