/**
 * Smoke test confirming that the Prisma `RuntimeStorage` adapter fails fast.
 *
 * The adapter exists only as a placeholder until the legacy event-table
 * implementation is rewritten on top of {@link RuntimeRecord}; it intentionally
 * dies at layer acquisition so apps cannot accidentally persist to the old
 * shape.
 */

import { describe, expect, it } from "@effect/vitest";
import { Cause, Effect, Exit } from "effect";
import { RuntimeStorage } from "../src/RuntimeStorage";
import {
  layer as prismaLayer,
  PrismaProcessStoreUnavailableError,
  make as prismaMake,
} from "../src/prisma/PrismaProcessStore";
import type { PrismaProcessStoreClient } from "../src/prisma/types";

const stubClient: PrismaProcessStoreClient = {} as PrismaProcessStoreClient;

describe("Prisma adapter — fail-fast safety net", () => {
  it.effect("layer dies with PrismaProcessStoreUnavailableError", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        RuntimeStorage.pipe(
          Effect.provide(prismaLayer({ client: stubClient })),
        ),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        // The layer is built with `Effect.die`, so the error surfaces as a
        // defect on the cause. `Cause.pretty` is the version-stable way to
        // surface that defect for an assertion.
        const text = Cause.pretty(exit.cause);
        expect(text).toContain("PrismaProcessStoreUnavailableError");
      }
    }),
  );

  it("legacy `make` throws PrismaProcessStoreUnavailableError synchronously", () => {
    expect(() => prismaMake(stubClient)).toThrow(
      PrismaProcessStoreUnavailableError,
    );
  });
});
