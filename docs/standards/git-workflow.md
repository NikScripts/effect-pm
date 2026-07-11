{#git-workflow title="Git workflow" order=180 appliesTo=process}
# Git workflow

How work moves through branches: what a branch is named, how often you commit, and where changes are
allowed to land directly.

{#branch-naming .must appliesTo=process}
## Branches are named `<action>/<description>`

Every branch is `<action>/<description>`. The **action** is the change type — `feat`, `fix`, `docs`,
`refactor`, `chore`, `integration` — and the **description** is a short kebab-case summary of the
work. Nothing else: no bare names, no personal prefixes.

``` text
✅ docs/standards-corpus      feat/queue-durability      fix/soft-break-spacing
❌ standards                  my-branch                  wip
```

{#commit-and-push-continuously .must appliesTo=process}
## Commit and push continuously

Commit at every sensible checkpoint and push in the same breath — a local commit is not done until
it is on the remote. Small, frequent, always-pushed commits; never let unpushed work pile up, and
never wait to be asked. Each finished unit (a chapter, a fix, a passing step) is a commit, pushed.

{#work-on-a-branch .must appliesTo=process}
## Work on a working branch; integration advances by merge

Cut a `<action>/<description>` working branch from your integration branch, do your regular commits
there, and **merge** into the integration branch at checkpoints. An integration branch is advanced
by merges, never by direct commits — committing straight onto it skips the working-branch step and
the review it affords.

{#no-direct-shared-writes .must appliesTo=process}
## Never touch a shared branch without a per-action go

Committing, pushing, merging, or opening a PR against `main`, a release branch, or any shared or
user-owned branch requires **explicit, per-action approval**. "Prepare to merge" is not "merge";
approval for one action does not carry to the next. Your own working branch is yours to push freely
— the gate is only on shared history.

{#changesets-and-releases .must appliesTo=process}
## Changesets and releases are deliberate

A change to public API, behaviour, or package metadata ships **one** coherent changeset — and
creating it needs approval, like any shared write. Beta releases are **manual**: never run
`changeset version`; the release is assembled by hand (changeset entry, prerelease bump, changelog).
Pushing is not publishing.
