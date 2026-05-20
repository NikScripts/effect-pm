/**
 * @module examples/forms/process-store/process-store-prisma-structural-client
 *
 * Prisma ProcessStore placeholder. Run:
 * `npx tsx examples/forms/process-store/process-store-prisma-structural-client.ts`
 */

import { Effect } from "effect";
import { runNodeProgramOrExit } from "../../shared/demo-harness";
import {
  PrismaProcessStore,
  PrismaProcessStoreUnavailableError,
  type PrismaProcessStoreClient,
} from "../../../src/storage/prisma";

const makePlaceholderClient = (): PrismaProcessStoreClient => ({
  effectPmEvent: {
    create: () => Promise.reject(new Error("unavailable placeholder")),
    createMany: () => Promise.reject(new Error("unavailable placeholder")),
    findMany: () => Promise.reject(new Error("unavailable placeholder")),
  },
});

const program = Effect.sync(() => {
  try {
    PrismaProcessStore.make(makePlaceholderClient());
  } catch (error) {
    if (error instanceof PrismaProcessStoreUnavailableError) {
      return error.reason;
    }
    throw error;
  }
  return "unexpected prisma adapter availability";
}).pipe(
  Effect.tap((message) => Effect.logInfo(message)),
);

runNodeProgramOrExit(
  program,
  "form:process-store-prisma-structural-client finished",
);
