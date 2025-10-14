# ProcessManager Examples

This directory contains reference implementations and examples for extending ProcessManager functionality. These files are **not included in the published package** but serve as documentation and starting points for your own implementations.

## 🚀 Running the Examples

### Start the Demo Application

```bash
npm run example
```

This starts the ProcessManager demo with:
- Two resource pools (DemoQueue, DemoTwoQueue)
- One cron that adds items to pools every 10 seconds
- HTTP control service on port 3001

### Use the CLI (in another terminal)

While the example is running, use the CLI to control it:

```bash
# List all processes and pools
npm run cli ls

# Get detailed status
npm run cli status queue-adder

# List pool details
npm run cli pools

# Control processes
npm run cli start queue-adder
npm run cli stop queue-adder
npm run cli restart queue-adder
npm run cli now queue-adder    # Run immediately

# Get help
npm run cli -- --help
```

## 📁 Examples

### `prisma-storage.ts`
**Persistent CronStorage with Prisma**

A complete implementation showing how to create a database-backed CronStorage layer using Prisma. Use this as a template for production applications that need to persist execution history across restarts.

**What you'll need:**
- `@prisma/client` installed
- Prisma configured with the CronExecution model
- Database migrated

**Usage:**
```typescript
import { CronStoragePrismaLayer } from "./examples/prisma-storage";

program.pipe(
  Effect.provide(CronStoragePrismaLayer),
  Effect.runPromise
);
```

## 🎯 Why Examples?

The core package has minimal dependencies beyond Effect to remain lightweight. These examples show you how to integrate with popular tools like Prisma while keeping the package flexible for your specific needs.

## 📚 More Resources

- [Main README](../README.md) - Package documentation
- [ProcessManager API](../src/process-manager.ts) - Core API reference
- [Effect Documentation](https://effect.website/) - Effect framework docs

