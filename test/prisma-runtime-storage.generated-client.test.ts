import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import * as NodeFs from "node:fs/promises";
import * as NodePath from "node:path";
import { promisify } from "node:util";
import { prismaSchema } from "../src/prisma/schema";

const execFilePromise = promisify(execFile);

const workspaceRoot = process.cwd();
const prismaBin = NodePath.join(workspaceRoot, "node_modules", ".bin", "prisma");
const tsgoBin = NodePath.join(workspaceRoot, "node_modules", ".bin", "tsgo");
const tsxBin = NodePath.join(workspaceRoot, "node_modules", ".bin", "tsx");

const run = (
  file: string,
  args: ReadonlyArray<string>,
  cwd: string,
): Promise<void> =>
  execFilePromise(file, [...args], {
    cwd,
    env: {
      ...process.env,
      PRISMA_HIDE_UPDATE_MESSAGE: "1",
      PRISMA_GENERATE_SKIP_AUTOINSTALL: "1",
    },
  }).then(
    () => undefined,
    (error: unknown) => {
      if (typeof error === "object" && error !== null) {
        const stdout = "stdout" in error && typeof error.stdout === "string" ? error.stdout : "";
        const stderr = "stderr" in error && typeof error.stderr === "string" ? error.stderr : "";
        throw new Error(`${String(error)}\n${stdout}${stderr}`);
      }
      throw error;
    },
  );

const writeProject = async (dir: string): Promise<void> => {
  await NodeFs.mkdir(NodePath.join(dir, "prisma"), { recursive: true });
  await NodeFs.writeFile(
    NodePath.join(dir, "prisma", "schema.prisma"),
    `generator client {
  provider = "prisma-client"
  output   = "./generated/client"
}

datasource db {
  provider = "sqlite"
}

${prismaSchema}
`,
  );
  await NodeFs.writeFile(
    NodePath.join(dir, "prisma.config.ts"),
    `import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: "file:./dev.db",
  },
});
`,
  );
};

const writeSmokeScript = async (dir: string): Promise<string> => {
  const scriptPath = NodePath.join(dir, "smoke.ts");
  const storageImport = JSON.stringify(
    NodePath.join(workspaceRoot, "src", "storage", "prisma.ts"),
  );
  const runtimeImport = JSON.stringify(
    NodePath.join(workspaceRoot, "src", "RuntimeStorage.ts"),
  );
  const queryImport = JSON.stringify(NodePath.join(workspaceRoot, "src", "Query.ts"));
  const clientTypeImport = JSON.stringify(NodePath.join(workspaceRoot, "src", "prisma", "types.ts"));
  const adapterImport = JSON.stringify("@prisma/adapter-better-sqlite3");
  await NodeFs.writeFile(
    scriptPath,
    `import { DateTime, Effect } from "effect";
import { PrismaBetterSqlite3 } from ${adapterImport};
import { PrismaClient } from "./prisma/generated/client/client.ts";
import { PrismaRuntimeStorage } from ${storageImport};
import { RuntimeStorageDuplicateRecordError, RuntimeStorageReadonlyRecordError } from ${runtimeImport};
import { Key, ProcessId, Readonly } from ${queryImport};
import type { PrismaRuntimeStorageClient } from ${clientTypeImport};

const assert = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const record = (id: string, overrides = {}) => ({
  id,
  type: "queue.entry.enqueued",
  occurredAt: DateTime.makeUnsafe("2026-01-01T00:00:00.000Z"),
  createdAt: DateTime.makeUnsafe("2026-01-01T00:00:01.000Z"),
  runId: "run-generated-client",
  processType: "queue-resource",
  processId: "queue-generated-client",
  ...overrides,
});

const adapter = new PrismaBetterSqlite3({ url: "file:./dev.db" });
const prisma = new PrismaClient({ adapter });
const structuralClient: PrismaRuntimeStorageClient = prisma;
const storage = PrismaRuntimeStorage.make(structuralClient);

const program = Effect.gen(function* () {
  yield* storage.create(record("a", {
    occurredAt: DateTime.makeUnsafe("2026-01-01T00:00:00.000Z"),
    key: "shared",
    payload: { value: 1 },
    indexNames: ["key"],
  }));
  yield* storage.create(record("b", {
    occurredAt: DateTime.makeUnsafe("2026-01-01T00:01:00.000Z"),
    key: "shared",
  }));
  yield* storage.create(record("locked", { readonly: true }));

  const ordered = yield* storage.read({ predicate: Key.equals("shared") });
  assert(ordered.map((row) => row.id).join(",") === "b,a", "default ordering mismatch");
  assert(JSON.stringify(ordered.find((row) => row.id === "a")?.payload) === JSON.stringify({ value: 1 }), "payload mismatch");
  assert(JSON.stringify(ordered.find((row) => row.id === "a")?.indexNames) === JSON.stringify(["key"]), "indexNames mismatch");

  const duplicate = yield* Effect.flip(storage.create(record("a")));
  assert(duplicate instanceof RuntimeStorageDuplicateRecordError, "duplicate error mismatch");

  const readonlyUpsert = yield* Effect.flip(storage.upsert(record("locked")));
  assert(readonlyUpsert instanceof RuntimeStorageReadonlyRecordError, "readonly upsert mismatch");

  const update = yield* storage.update(
    { predicate: ProcessId.equals("queue-generated-client") },
    { payload: { updated: true } },
  );
  assert(update.matched === 3 && update.updated === 2, "update counts mismatch");

  const firstDelete = yield* storage.delete({
    predicate: ProcessId.equals("queue-generated-client"),
  });
  assert(firstDelete.deleted === 2, "delete count mismatch");

  const secondDelete = yield* storage.delete({
    predicate: Readonly.equals(true),
  });
  assert(secondDelete.deleted === 1, "readonly delete opt-in mismatch");
});

void (async () => {
  try {
    await Effect.runPromise(program);
    await prisma.$disconnect();
    console.log("generated-client-ok");
  } catch (error) {
    await prisma.$disconnect();
    throw error;
  }
})();
`,
  );
  return scriptPath;
};

const writeTsconfig = async (dir: string): Promise<string> => {
  const tsconfigPath = NodePath.join(dir, "tsconfig.json");
  await NodeFs.writeFile(
    tsconfigPath,
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          skipLibCheck: true,
          noEmit: true,
          allowImportingTsExtensions: true,
          types: ["node"],
        },
        include: ["smoke.ts"],
      },
      null,
      2,
    ),
  );
  return tsconfigPath;
};

describe("PrismaRuntimeStorage generated client integration", () => {
  it("runs against a real generated Prisma SQLite client", async () => {
    const dir = NodePath.join(workspaceRoot, `.prisma-generated-${randomUUID()}`);
    try {
      await writeProject(dir);
      await run(prismaBin, ["db", "push"], dir);
      await run(prismaBin, ["generate"], dir);
      const scriptPath = await writeSmokeScript(dir);
      const tsconfigPath = await writeTsconfig(dir);
      await run(tsgoBin, ["--noEmit", "-p", tsconfigPath], dir);
      const result = await execFilePromise(tsxBin, [scriptPath], { cwd: dir });
      expect(result.stdout).toContain("generated-client-ok");
    } finally {
      await NodeFs.rm(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
