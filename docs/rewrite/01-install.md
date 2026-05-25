# Install

effect-pm (`@nikscripts/effect-pm`) is a library on top of [Effect](https://effect.website/) for **managed processes** (repeating work with a schedule and polling cadence) and **queue resources**. This page covers what you need installed before you define your first process.

## Requirements

Your environment should match:

| Requirement | Version |
| --- | --- |
| Node.js | `>= 20.19.0` |
| Effect | `^4.0.0-beta.65` (keep `effect` and effect-pm on the same beta line) |

`@prisma/client` is an optional peer dependency reserved for the upcoming Prisma
`RuntimeStorage` adapter rewrite. The old Prisma event-table `ProcessStore`
adapter is intentionally unavailable.

## Install the package

Add effect-pm and Effect to your application:

```bash
pnpm add @nikscripts/effect-pm effect
```

The same packages work with `npm install` or `yarn add`.

## TypeScript

effect-pm targets **strict** TypeScript. A typical `tsconfig` includes `"strict": true` and Node ESM settings (`"module": "NodeNext"`, `"moduleResolution": "NodeNext"`).

Import from the package entry (or a subpath when you want a smaller surface):

```typescript
import { Process, Polling, ProcessSchedule } from "@nikscripts/effect-pm";
```

Subpaths such as `@nikscripts/effect-pm/Process` exist for focused imports; the root entry re-exports the public API.

## Effect language service

If you already use Effect in production, enable [**@effect/language-service**](https://www.npmjs.com/package/@effect/language-service) in `tsconfig.json` the same way the [Effect docs](https://effect.website/) describe. It is recommended but not required to follow this guide.

## Optional: `ProcessStorage`

Processes can append **execution** and **lifecycle** events when storage facets are in the environment. Without them, processes still run; history is simply not persisted.

```typescript
import { ProcessStorage } from "@nikscripts/effect-pm";

// Provide at your application root, for example:
ProcessStorage.layer
```

SQLite storage is covered in later pages. Prisma storage will return as a
RuntimeStorage adapter.

## Optional: Prisma

Prisma support is paused while storage moves from analytics events to
`RuntimeRecord`s. Use the `RuntimeStorage` contract when implementing the new
SQL adapter.

## Next step

Continue to [Process](./02-process.md) to learn what a managed process is, how to define one with `Process.make`, and how to run it.
