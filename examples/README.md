# ProcessGroup Examples

This directory contains reference implementations and examples for extending ProcessGroup functionality. These files are **not included in the published package** but serve as documentation and starting points for your own implementations.

## 🚀 Running the Examples

### Start the Demo Application

```bash
npm run example
```

This starts the ProcessGroup demo with:
- Two queues (DemoQueue, DemoTwoQueue)
- One cron that adds items to queues every 10 seconds
- HTTP control service on port 3001

### Use the CLI (in another terminal)

While the example is running, use the CLI to control it:

```bash
# List all processes and queues
npm run cli ls

# Get detailed status
npm run cli status queue-adder

# List queue details
npm run cli queues

# Control processes
npm run cli start queue-adder
npm run cli stop queue-adder
npm run cli restart queue-adder
npm run cli now queue-adder    # Run immediately

# Get help
npm run cli -- --help
```

## 📁 Examples

### Persistent analytics with Prisma

The Prisma-backed `ProcessStore` ships in the package itself — no example file
needed. Set it up in your project with:

```bash
npx effect-pm add prisma
npx prisma generate
npx prisma migrate dev --name add_effect_pm_event
```

Then provide it to your program:

```typescript
import { PrismaClient } from "@prisma/client";
import { PrismaProcessStore } from "@nikscripts/effect-pm/prisma";

const prisma = new PrismaClient();

program.pipe(
  Effect.provide(PrismaProcessStore.layer({ client: prisma })),
  Effect.runPromise,
);
```

See the main [README](../README.md#processstore-analytics--lifecycle) for
full Prisma details, including the `layerFromContext` variant for
Effect-style DI and the `--dry-run` / `--separate-file` flags.

## 🎯 Why Examples?

The core package has minimal dependencies beyond Effect to remain lightweight. These examples show you how to integrate with popular tools like Prisma while keeping the package flexible for your specific needs.

## 📚 More Resources

- [Main README](../README.md) - Package documentation
- [ProcessGroup API](../src/ProcessGroup.ts) - Core API reference
- [Effect Documentation](https://effect.website/) - Effect framework docs

