/**
 * @module examples/forms/process-store/process-store-prisma-structural-client
 *
 * Prisma RuntimeStorage structural-client example. Run:
 * `npx tsx examples/forms/process-store/process-store-prisma-structural-client.ts`
 */

import { Effect } from "effect";
import { runNodeProgramOrExit } from "../../shared/demo-harness";
import {
  PrismaRuntimeStorage,
  type PrismaRuntimeStorageClient,
} from "../../../src/storage/prisma";

const makeStructuralClient = (): PrismaRuntimeStorageClient => ({
  effectPmRuntimeRecord: {
    create: () => Promise.reject(new Error("example client is not connected")),
    findMany: () => Promise.reject(new Error("example client is not connected")),
    count: () => Promise.reject(new Error("example client is not connected")),
    upsert: () => Promise.reject(new Error("example client is not connected")),
    update: () => Promise.reject(new Error("example client is not connected")),
    delete: () => Promise.reject(new Error("example client is not connected")),
    updateMany: () => Promise.reject(new Error("example client is not connected")),
    deleteMany: () => Promise.reject(new Error("example client is not connected")),
  },
  $transaction: () => Promise.reject(new Error("example client is not connected")),
});

const program = Effect.sync(() => {
  PrismaRuntimeStorage.make(makeStructuralClient());
  return "PrismaRuntimeStorage accepts a structural generated-client shape";
}).pipe(
  Effect.tap((message) => Effect.logInfo(message)),
);

runNodeProgramOrExit(
  program,
  "form:process-store-prisma-structural-client finished",
);
