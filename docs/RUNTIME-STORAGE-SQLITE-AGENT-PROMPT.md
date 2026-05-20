# Prompt for SQLite RuntimeStorage agent

Use this prompt for the next agent.

```text
You are working in the @nikscripts/effect-pm repository.

Start by pulling this branch:

  git fetch origin cursor/grill-queue-v2-plan-b6d7
  git checkout -b cursor/runtime-storage-sqlite-b6d7 origin/cursor/grill-queue-v2-plan-b6d7

Base branch for PRs remains feature/runtime-foundation.

Goal:

Implement the first durable RuntimeStorage adapter: SQLite. Do NOT work on Prisma yet except to leave its placeholder alone. Prisma will be handled by a later agent after SQLite proves the RuntimeStorage contract.

Important context:

- RuntimeStorage is ready for adapter work.
- Read docs/RUNTIME-STORAGE-ADAPTER-GUIDE.md first.
- The adapter contract is RuntimeStorageService in src/RuntimeStorage.ts.
- ProcessStore now consumes RuntimeStorage through ProcessStore.layerRuntimeStorage.
- The reusable conformance test helper is test/runtime-storage.conformance.ts.
- The old Prisma event-table ProcessStore adapter has intentionally been gutted. Do not revive it.

Implementation requirements:

1. Add a SQLite RuntimeStorage adapter, probably under src/storage/sqlite.ts or src/sqlite/* if a small module is cleaner.
2. Export it through package.json and tsup.config.ts, likely as:
   @nikscripts/effect-pm/storage/sqlite
3. Provide a public namespace or service similar in spirit to:
   SQLiteRuntimeStorage.make(...)
   SQLiteRuntimeStorage.layer(...)
4. The adapter must implement RuntimeStorageService:
   - create
   - read
   - upsert
   - update
   - delete
5. Persist every RuntimeRecord field:
   - id
   - type
   - occurredAt
   - createdAt
   - runId
   - processType
   - processId
   - subjectType
   - subjectId
   - key
   - indexA through indexH
   - indexNames
   - payload
   - attributes
   - readonly
6. Match RuntimeStorage.memory semantics exactly:
   - read defaults to occurredAt descending,
   - duplicate create fails with RuntimeStorageDuplicateRecordError,
   - upsert fails if an existing record is readonly,
   - update counts matched rows but skips readonly rows,
   - delete skips readonly rows unless the query explicitly includes Readonly.equals(true),
   - support predicates, ordering, limit, and offset from Query.ts.
7. Use structured SQLite APIs or a small query builder where practical; do not use unsafe casts or ad hoc string building for values.
8. If you need a SQLite dependency, add the latest appropriate Effect SQLite package with pnpm. Inspect repos/effect/ first for current API patterns.

Testing requirements:

1. Add a SQLite-specific test file.
2. Import and run:

   describeRuntimeStorageContract("SQLiteRuntimeStorage contract", makeStorage)

   from test/runtime-storage.conformance.ts.

3. makeStorage must create a fresh isolated SQLite database per test.
4. Add at least one SQLite-specific test that proves data persists across two service instances pointed at the same database file.
5. Run:

   pnpm run typecheck
   pnpm vitest run test/runtime-storage.test.ts <your sqlite test file>
   pnpm test
   pnpm run lint
   pnpm run build

Documentation / release notes:

1. Update docs/RUNTIME-STORAGE-ADAPTER-GUIDE.md if implementation details differ from the guide.
2. Update docs/PACKAGE-GUIDE.md and docs/CODEBASE-INVENTORY.md with the new SQLite subpath.
3. Add or update a changeset because this adds a public adapter.

Non-goals:

- Do not implement Prisma.
- Do not restore PrismaProcessStore as an event-table ProcessStore adapter.
- Do not add module-specific queue/process methods to RuntimeStorage.
- Do not change QueueResource or ProcessStore semantics unless needed to integrate the adapter.

When done, commit and push the branch, then create/update a draft PR targeting feature/runtime-foundation.
```
