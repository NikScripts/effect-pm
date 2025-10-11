---
"@nikscripts/effect-pm": minor
---

---

## "@nikscripts/effect-pm": minor

**BREAKING CHANGES:** Simplify API and require explicit CronStorage

**Removed:**

- `ProcessManagerService` - No longer needed, use `makeProcessManager` directly
- `ProcessManagerLive` - CronStorage must now be provided explicitly

**Changed:**

- `CronStorage` is now a required dependency that must be explicitly provided
- Renamed `ProcessManager<R>` type to `ProcessManagerInterface<R>` (export fix)

**Migration Guide:**

Before (0.1.x):

```typescript
import {
  ProcessManagerService,
  ProcessManagerLive,
} from "@nikscripts/effect-pm";

program.pipe(Effect.provide(ProcessManagerLive), Effect.provide(QueueLive));
```

After (0.2.0):

```typescript
import { makeProcessManager, CronStorage } from "@nikscripts/effect-pm";

program.pipe(
  Effect.provide(QueueLive),
  Effect.provide(CronStorage.Default) // or your custom storage
);
```

**Benefits:**

- Cleaner API - less ceremony, more explicit dependencies
- Better control over CronStorage implementation
- Follows Effect patterns more closely (like Logger)
