# Migration Guide: v0.3.0 → v0.4.0

This guide covers the changes in v0.4.0. **Partial breaking change** - most code will continue to work, but `refill` functions need updates.

## Overview

v0.4.0 introduces a consistent pattern where ResourcePool callbacks receive the pool instance as a parameter. This provides full control over pool lifecycle and enables more powerful workflows.

## Breaking vs Non-Breaking Changes

### ✅ Non-Breaking: `onError`, `onSuccess`, and `cache`
These changes are **backward compatible**. Your existing code will continue to work without modification because TypeScript allows functions with fewer parameters to match function types that expect more parameters (just like `array.map((item) => ...)` works even though `.map()` also provides `index` and `array`).

### ❌ Breaking: `refill`
This change **requires code updates** because the parameter type changed completely (from `methods` object to `pool` instance).

## Breaking Changes

### 1. `refill` Function - Now Receives Pool Instance Instead of Methods Object ⚠️ BREAKING

**Before (v0.3.0):**
```typescript
const TaskPool = ResourcePool.make({
  name: "task-pool",
  effect: processItem,
  refill: (methods: {
    next: (item: Task | readonly Task[]) => Effect.Effect<void>;
    add: (item: Task | readonly Task[]) => Effect.Effect<void>;
    deffered: (item: Task | readonly Task[]) => Effect.Effect<void>;
  }) => 
    Effect.gen(function* () {
      const cached = yield* loadFromDatabase();
      yield* methods.add(cached);
    }),
});
```

**After (v0.4.0):**
```typescript
const TaskPool = ResourcePool.make({
  name: "task-pool",
  effect: processItem,
  refill: (pool: ResourcePool<Task, void>) => 
    Effect.gen(function* () {
      const size = yield* pool.size();
      if (size < 100) {
        const cached = yield* loadFromDatabase();
        yield* pool.add(cached);
      }
    }),
});
```

**Migration:**
- Change parameter from `methods` object to `pool` instance
- Replace `methods.add()` with `pool.add()`
- Replace `methods.next()` with `pool.next()`
- Replace `methods.deffered()` with `pool.deffered()`

**Benefits:**
- Cleaner API - direct access to pool methods
- Full pool access - can check size, status, etc. before refilling
- Consistent pattern with other callbacks
- More powerful - can use any pool method, not just add operations

---

## Non-Breaking Changes (Optional Migration)

### 2. `onError` Callback - Now Receives Pool Instance (Optional)

**Before (v0.3.0) - Still Works:**
```typescript
const TaskPool = ResourcePool.make({
  name: "task-pool",
  effect: processItem,
  onError: (error: Error, item: Task) => 
    Effect.logError(`Failed: ${error.message}`),
});
```

**After (v0.4.0) - Optional Enhancement:**
```typescript
const TaskPool = ResourcePool.make({
  name: "task-pool",
  effect: processItem,
  onError: (error: Error, item: Task, pool: ResourcePool<Task, void>) => 
    Effect.gen(function* () {
      yield* Effect.logError(`Failed: ${error.message}`);
      // Pool instance available for lifecycle control
      if (error.message.includes("FATAL")) {
        yield* pool.shutdown();
      }
    }),
});
```

**Migration:** Optional - old code still works! Add `pool` as third parameter if you want pool control.

**Benefits:**
- Can control pool lifecycle (shutdown, pause) on critical errors
- Can add items to pool for retry logic
- Can check pool state before taking action

---

### 3. `onSuccess` Callback - Now Receives Pool Instance (Optional)

**Before (v0.3.0) - Still Works:**
```typescript
const TaskPool = ResourcePool.make({
  name: "task-pool",
  effect: processItem,
  onSuccess: (result: Result, item: Task) => 
    Effect.logInfo(`Processed: ${result.id}`),
});
```

**After (v0.4.0) - Optional Enhancement:**
```typescript
const TaskPool = ResourcePool.make({
  name: "task-pool",
  effect: processItem,
  onSuccess: (result: Result, item: Task, pool: ResourcePool<Task, Result>) => 
    Effect.gen(function* () {
      yield* Effect.logInfo(`Processed: ${result.id}`);
      // Pool instance available for adding follow-up tasks
      if (result.requiresFollowUp) {
        yield* pool.add([followUpTask]);
      }
    }),
});
```

**Migration:** Optional - old code still works! Add `pool` as third parameter if you want pool control.

**Benefits:**
- Can enqueue follow-up tasks after successful processing
- Can create processing pipelines and workflows
- Can control pool lifecycle from success callbacks

---

## Complete Example Migration

**Before (v0.3.0):**
```typescript
const EmailPool = ResourcePool.make({
  name: "email-pool",
  effect: (email: Email) => sendEmail(email),
  cache: (emails) => saveToDatabase(emails),
  onSuccess: (result, email) => 
    Effect.logInfo(`Sent: ${email.id}`),
  onError: (error, email) => 
    Effect.logError(`Failed: ${email.id}`),
  refill: ({ add }) => 
    Effect.gen(function* () {
      const pending = yield* loadPendingEmails();
      yield* add(pending);
    }),
});
```

**After (v0.4.0):**
```typescript
const EmailPool = ResourcePool.make({
  name: "email-pool",
  effect: (email: Email) => sendEmail(email),
  cache: (emails, pool) => 
    Effect.gen(function* () {
      // Pool instance available for checking state
      yield* saveToDatabase(emails);
    }),
  onSuccess: (result, email, pool) => 
    Effect.gen(function* () {
      yield* Effect.logInfo(`Sent: ${email.id}`);
      // Can add follow-up tasks if needed
    }),
  onError: (error, email, pool) => 
    Effect.gen(function* () {
      yield* Effect.logError(`Failed: ${email.id}`);
      // Can control pool lifecycle on critical errors
      if (error.message.includes("RATE_LIMIT")) {
        yield* pool.pause();
      }
    }),
  refill: (pool) => 
    Effect.gen(function* () {
      const pending = yield* loadPendingEmails();
      yield* pool.add(pending);
    }),
});
```

---

## Migration Checklist

### Required (Breaking Changes)
- [ ] Update all `refill` functions to accept `pool` instead of `methods` object
- [ ] Replace `methods.add()` with `pool.add()` in refill functions
- [ ] Replace `methods.next()` with `pool.next()` in refill functions (if used)
- [ ] Replace `methods.deffered()` with `pool.deffered()` in refill functions (if used)

### Optional (Non-Breaking Enhancements)
- [ ] Update `onError` callbacks to accept `pool` as third parameter (if you want pool control)
- [ ] Update `onSuccess` callbacks to accept `pool` as third parameter (if you want pool control)
- [ ] Update `cache` functions to accept `pool` as second parameter (if you want pool state access)
- [ ] Test all callbacks to ensure they work correctly

---

## Why These Changes?

1. **Consistency**: All callbacks now follow the same pattern (receive pool instance)
2. **Power**: Full pool control available everywhere it's needed
3. **Flexibility**: Can create complex workflows, pipelines, and error handling
4. **Cleaner API**: `refill` is simpler - direct pool access instead of methods object

---

## Questions?

If you encounter issues during migration, please:
1. Check that all callback signatures match the new API
2. Ensure TypeScript types are updated
3. Review the examples in `examples/example.ts`
4. Open an issue on GitHub if you need help

