# Documentation index

Start here when browsing the repo in GitHub or an editor.

| Document | Audience | Contents |
|----------|----------|----------|
| [PACKAGE-GUIDE.md](./PACKAGE-GUIDE.md) | Humans + tools | Narrative architecture, dependency rules, links. |
| [AGENTS.md](./AGENTS.md) | AI assistants | Repo map, invariants, safe-change checklist. |
| [PROCESS-API.md](./PROCESS-API.md) | Everyone | Spec-style tables for `Process`, `Polling`, `ProcessSchedule`, `ProcessGroup`. |
| [RESOURCE-API.md](./RESOURCE-API.md) | Everyone | Current `QueueResource`, `RunResource`, `HttpClientRunGate`, and `HttpApiResource` APIs. |
| [EFFECT-V4-FEATURE-SCOUT.md](./EFFECT-V4-FEATURE-SCOUT.md) | Contributors | Over-complete feature scout: Effect v4 capabilities + codebase use-cases. |
| [SCHEDULE-AND-PROCESSGROUP.md](./SCHEDULE-AND-PROCESSGROUP.md) | Integrators | Schedule vs **`ProcessGroup.start`**, disarm vs stop, API-driven gates; links to example. |
| [guides/README.md](./guides/README.md) | Integrators | How-to guides incl. **[dashboard-integration.md](./guides/dashboard-integration.md)** (HTTP API for UI). |
| [plans/README.md](./plans/README.md) | Contributors | Numbered futures and dependency context (**[CURRENT-ROADMAP](./plans/CURRENT-ROADMAP.md)** for suggested order — not shipped API truth). |

**Examples**: [`../examples/README.md`](../examples/README.md).

**Package entry TSDoc**: [`../src/index.ts`](../src/index.ts) (`@packageDocumentation`).
