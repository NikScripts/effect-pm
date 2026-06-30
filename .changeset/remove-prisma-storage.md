---
"@nikscripts/effect-pm": minor
---

**Removed the Prisma storage backend (BREAKING).** The `@nikscripts/effect-pm/storage/prisma` and `@nikscripts/effect-pm/prisma` subpaths, `PrismaRuntimeStorage`, the structural Prisma client types, and the `effect-pm add prisma` / `prisma:print-schema` CLI helpers are gone, along with the `@prisma/client` optional peer dependency. It was an unused, maintenance-heavy backend (codegen + a generated-client integration test) duplicating what the **sqlite** and **redis** backends already cover. Use `@nikscripts/effect-pm/storage/sqlite` or `@nikscripts/effect-pm/storage/redis` for durable runtime storage. (Recoverable from git history if ever needed.)
