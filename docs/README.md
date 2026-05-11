# Documentation index

Start here when browsing the repo in GitHub or an editor.

| Document | Audience | Contents |
|----------|----------|----------|
| [PACKAGE-GUIDE.md](./PACKAGE-GUIDE.md) | Humans + tools | Narrative architecture, dependency rules, links. |
| [AGENTS.md](./AGENTS.md) | AI assistants | Repo map, invariants, safe-change checklist. |
| [PROCESS-API.md](./PROCESS-API.md) | Everyone | Spec-style tables for `Process`, `Polling`, `ProcessSchedule`, `ProcessGroup`. |
| [EFFECT-V4-FEATURE-SCOUT.md](./EFFECT-V4-FEATURE-SCOUT.md) | Contributors | Over-complete feature scout: Effect v4 capabilities + codebase use-cases. |
| [SCHEDULE-AND-PROCESSGROUP.md](./SCHEDULE-AND-PROCESSGROUP.md) | Integrators | Schedule vs **`startProcess`**, disarm vs stop, API-driven gates; links to example. |
| [plans/README.md](./plans/README.md) | Contributors | Canonical architecture specs (read **09** for runtime, **10** for schedule reconcile/removal design). |
| [MIGRATION_0.6-beta.2-to-0.7-beta.0.md](./MIGRATION_0.6-beta.2-to-0.7-beta.0.md) | Upgraders | npm publish / beta migration notes. |

**Examples** (runnable, not on npm tarball): [`../examples/README.md`](../examples/README.md).

**Package entry TSDoc**: [`../src/index.ts`](../src/index.ts) (`@packageDocumentation`).
