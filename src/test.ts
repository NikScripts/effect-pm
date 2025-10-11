import { Effect, Context, Layer } from "effect"

// 1. Define the service
class DatabaseService extends Context.Tag("DatabaseService")<
  DatabaseService,
  {
    query: (sql: string) => Effect.Effect<unknown>
    connect: () => Effect.Effect<void>
  }
>() {
  // 2. Provide the default implementation directly in the tag
  static Live = Layer.succeed(this, {
    query: (sql: string) =>
      Effect.log(`Default: Executing query: ${sql}`).pipe(
        Effect.map(() => ({ rows: [] }))
      ),
    connect: () => Effect.log("Default: Connected to database"),
  })
  
  // 3. Make it the default layer
  static Default = this.Live
}

// 4. Set the default at the module/app level
const MainLayer = Layer.mergeAll(
  DatabaseService.Default,
  // other default services...
)

// 5. Use without providing a layer - default is used
const program = Effect.gen(function* () {
  const db = yield* DatabaseService
  yield* db.connect()
  return yield* db.query("SELECT * FROM users")
})

// This works automatically with the default
Effect.runPromise(program.pipe(Effect.provide(MainLayer)))

// 6. Override when needed
const CustomDatabaseService = Layer.succeed(DatabaseService, {
  query: (sql: string) =>
    Effect.log(`Custom: Executing query: ${sql}`).pipe(
      Effect.map(() => ({ rows: [{ id: 1 }] }))
    ),
  connect: () => Effect.log("Custom: Connected to PostgreSQL"),
})

// Override the default
Effect.runPromise(
  program.pipe(Effect.provide(CustomDatabaseService))
)