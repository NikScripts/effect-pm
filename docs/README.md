# Documentation index

Start here when browsing the repo in GitHub or an editor.

| Document | Audience | Contents |
|----------|----------|----------|
| [PACKAGE-GUIDE.md](./PACKAGE-GUIDE.md) | Humans + tools | Narrative architecture, dependency rules, links. |
| [AGENTS.md](./AGENTS.md) | AI assistants | Repo map, invariants, safe-change checklist. |
| [PROCESS-API.md](./PROCESS-API.md) | Everyone | Spec-style tables for `Process`, `Polling`, `ProcessSchedule`. |
| [RESOURCE-API.md](./RESOURCE-API.md) | Everyone | Current `QueueResource`, `RunResource`, `HttpClientRunGate`, and `HttpApiResource` APIs. |
| [guides/toolkit-by-example.md](./guides/toolkit-by-example.md) | Everyone | Every resource / group / host / UI pattern by example. |
| [guides/history-and-persistence.md](./guides/history-and-persistence.md) | Everyone | History, the durable queue, and the dashboard data layer. |
| [STORAGE.md](./STORAGE.md) | Integrators | Persistence model (the SSOT). |
| [EFFECT-V4-FEATURE-SCOUT.md](./EFFECT-V4-FEATURE-SCOUT.md) | Contributors | Over-complete feature scout: Effect v4 capabilities + codebase use-cases. |
| [guides/README.md](./guides/README.md) | Integrators | How-to guides. |
| [plans/README.md](./plans/README.md) | Contributors | **Future-only** roadmap: priority table + topic files (no shipped API truth here). |

**Examples**: [`../examples/README.md`](../examples/README.md).

**Package entry TSDoc**: [`../src/index.ts`](../src/index.ts) (`@packageDocumentation`).
