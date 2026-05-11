# 12 — RunResource + HttpApiResource v2: Effect-idiomatic rewrite

**Status:** Plan (next after QueueResource v2)

**Breaking:** Yes. Same approach as plan 11.

---

## 1. Current state (problems)

### RunResource

- **Homegrown throttler** using `Date.now()` + `Ref` — violates `globalDateInEffect`
- **`_brand: Name` hack** for nominal typing — unnecessary with proper generics
- **Function overloads** (unit vs arg) — complex, hard to read
- **`const tag = Context.Service<...>(name)`** — `serviceNotAsClass` (acceptable)
- **`makeRunResourceWrap` exported** — leaking internal for `HttpApiResource` coupling
- **No Clock usage, no logging, no Effect.fn**
- **`strictBooleanExpressions`** violations (`limits.throttle !== undefined` patterns)

### HttpApiResource

- **Same `_brand` hack** and `serviceNotAsClass` pattern
- **Coupled to RunResource internals** via `makeRunResourceWrap` import
- **No logging, no documentation on config fields**

### HttpClientRunGate

- **Already clean** — small, focused, well-typed. Minimal changes needed.

---

## 2. Design (Effect-idiomatic)

### 2.1 Core concept

`RunResource` is a **concurrency gate** — wrap any effect with bounded concurrency and optional rate limiting. No queues, no priorities, no workers. Just a semaphore + optional throttle.

### 2.2 Public API

```typescript
export const RunResource = {
  /** Scoped Effect that produces a gated callable. */
  make: (config) => Effect<RunResource.Gate<T, A, E>, never, Scope>,

  /** Build a Layer from tag + config. */
  layer: (tag, config) => Layer<...>,

  /** Class factory: tag + baked-in .layer. */
  Service: <Self, ...>() => (name, config) => tag & { layer },

  /** Pure identity tag. */
  Tag: <Self, ...>() => (name) => Context.Service<...>,
}
```

### 2.3 Service shape

The service value is a **callable** — `yield*` the tag, get a function:

```typescript
export declare namespace RunResource {
  /** A gated callable: wraps an effect with concurrency + throttle. */
  interface Gate<in out T = void, out A = void, out E = never> {
    (input: T): Effect<A, E>
  }

  /** Generic runner: wraps any effect with the gate. */
  interface Runner {
    <A, E, R>(effect: Effect<A, E, R>): Effect<A, E, R>
  }

  interface Config<T, A, E> {
    readonly name?: string
    /** The effect to gate. Either a value (unit) or a function (with arg). */
    readonly effect: Effect<A, E> | ((input: T) => Effect<A, E>)
    /** Concurrency limit. @default 1 */
    readonly concurrency?: number
    /** Rate limiter (same pattern as QueueResource). */
    readonly limit?: Effect<RateLimiter, never, any>
  }

  interface RunnerConfig {
    readonly name?: string
    readonly concurrency?: number
    readonly limit?: Effect<RateLimiter, never, any>
  }
}
```

### 2.4 Usage

```typescript
// Configured effect (unit — no input):
const FetchPrices = RunResource.Service<typeof FetchPrices, void, PriceData, FetchError>()(
  "@app/FetchPrices",
  { effect: fetchPriceData(), concurrency: 3 },
)

const prices = yield* FetchPrices  // returns () => Effect<PriceData, FetchError>
const data = yield* prices()

// Configured effect (with input):
const SendSms = RunResource.Service<typeof SendSms, PhoneNumber, SmsResult, SmsError>()(
  "@app/SendSms",
  { effect: (phone) => smsClient.send(phone), concurrency: 5 },
)

const send = yield* SendSms
yield* send("+1234567890")

// Generic runner (wraps any effect):
const ApiGate = RunResource.makeRunner({
  name: "@app/ApiGate",
  concurrency: 10,
})

const runner = yield* ApiGate
yield* runner(someArbitraryEffect)
```

---

## 3. HttpApiResource — simplified

### 3.1 Core concept

`HttpApiResource` wraps `HttpApiClient.make` with an optional concurrency gate on the transport layer. It's `RunResource` specialized for HTTP APIs.

### 3.2 Public API

```typescript
export const HttpApiResource = {
  /** Build a typed HttpApi client with optional gating. */
  make: (api, config) => tag & { layer },

  /** Wrap an existing client-building effect with a transport gate. */
  layerEffect: (tag, effect, config?) => Layer<...>,

  /** Accept: application/json helper. */
  acceptJson,
}
```

### 3.3 Changes from current

- Remove `_brand` hack — use proper `Context.Service` generic
- Replace `makeRunResourceWrap` import with a shared internal utility (not exported)
- Replace `Date.now()` throttler with Clock-based approach
- Add proper TSDoc on all config fields
- Add structured logging

---

## 4. Shared internal: `makeGate`

Both `RunResource` and `HttpApiResource` need the same "semaphore + optional throttle" logic. Extract into a shared internal:

```typescript
/** @internal */
const makeGate = (config: {
  readonly concurrency?: number
  readonly limit?: Effect<RateLimiter, never, any>
}): Effect<Runner, never, Scope> =>
  Effect.gen(function*() {
    const concurrency = config.concurrency ?? 1
    const sem = yield* Semaphore.make(concurrency)
    const rateLimiter = config.limit !== undefined ? yield* config.limit : undefined

    return <A, E, R>(effect: Effect<A, E, R>): Effect<A, E, R> =>
      sem.withPermits(1)(
        Effect.gen(function*() {
          if (rateLimiter !== undefined) {
            yield* rateLimiter.consume({ ... })
          }
          return yield* effect
        })
      )
  })
```

This replaces `makeRunResourceWrap` and is NOT exported (internal only).

---

## 5. HttpClientRunGate — minimal changes

Already clean. Only changes:
- Update import path if `RunResource.Runner` type name changes
- Add TSDoc

---

## 6. File scope

### Rewrite from scratch

| File | Contents |
|------|----------|
| `src/RunResource.ts` | New API, shared gate logic, Service/Tag/layer/make |
| `test/run-resource.test.ts` | Updated tests |

### Moderate changes

| File | Change |
|------|--------|
| `src/HttpApiResource.ts` | Remove `makeRunResourceWrap` import, use internal gate, add docs |
| `test/http-api-resource.test.ts` | Update if API surface changes |

### Minimal changes

| File | Change |
|------|--------|
| `src/HttpClientRunGate.ts` | Type import update, add TSDoc |
| `src/index.ts` | Update RunResource exports |
| `src/Resource.ts` | Update umbrella |

### Not touched

`QueueResource`, `Process`, `ProcessGroup`, `ProcessStore`, `ControlService`, etc.

---

## 7. Migration guide

| Before | After |
|--------|-------|
| `RunResource.make({ name, effect, limits })` | `RunResource.Service<Self, T, A, E>()(name, { effect, concurrency, limit })` |
| `RunResource.makeRunner({ name, limits })` | `RunResource.makeRunner({ name, concurrency, limit })` |
| `limits: { concurrency: 5, throttle: { limit: 100, duration: ... } }` | `concurrency: 5, limit: RateLimiter.make(100, "1 minute")` |
| `yield* Gate` returns callable | Same — `yield* Gate` returns callable |
| `Gate.layer` | Same — `Gate.layer` |

---

## 8. Effect LSP compliance

Same rules as QueueResource v2:
- `strictBooleanExpressions` — explicit `!== undefined`
- `globalDateInEffect` — use `Clock.currentTimeMillis`
- `serviceNotAsClass` — acceptable in factory (same as QueueResource)
- All other rules clean

---

## 9. Implementation phases

### Phase 1: RunResource rewrite
1. New types (`Gate`, `Runner`, `Config`, `RunnerConfig`)
2. Shared `makeGate` internal (semaphore + optional RateLimiter)
3. `RunResource.make` / `.layer` / `.Service` / `.Tag`
4. `RunResource.makeRunner`
5. Tests

### Phase 2: HttpApiResource cleanup
1. Remove `makeRunResourceWrap` dependency
2. Use shared `makeGate` (or inline since it's just semaphore + runner)
3. Remove `_brand` hack
4. Add TSDoc
5. Tests

### Phase 3: Exports + umbrella
1. Update `src/index.ts`
2. Update `src/Resource.ts`
3. Update `src/HttpClientRunGate.ts` if needed
