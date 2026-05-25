/**
 * Placeholder for the Prisma-backed ProcessStore implementation.
 *
 * @remarks
 * The old Prisma adapter targeted the legacy append-only `EffectPmEvent` table.
 * The storage boundary has moved to normalized `RuntimeRecord`s, so Prisma needs
 * a full `RuntimeStorage` rewrite instead of a compatibility shim.
 *
 * @module ProcessStore/Prisma
 */

import { Context, Data, Effect, Layer } from "effect";
import { RuntimeStorage } from "../RuntimeStorage";
import type { PrismaProcessStoreClient } from "./types";

/**
 * Raised when the legacy Prisma ProcessStore adapter is used before the
 * RuntimeStorage-backed rewrite lands.
 *
 * @public
 */
export class PrismaProcessStoreUnavailableError extends Data.TaggedError(
  "PrismaProcessStoreUnavailableError",
)<{
  readonly reason: string;
}> {}

const unavailable = (): PrismaProcessStoreUnavailableError =>
  new PrismaProcessStoreUnavailableError({
    reason:
      "The legacy Prisma ProcessStore adapter has been removed. Rebuild Prisma as a RuntimeStorage adapter over RuntimeRecord.",
  });

/**
 * Effect Context service exposing a structural Prisma client.
 *
 * @public
 */
export class PrismaClientService extends Context.Service<
  PrismaClientService,
  PrismaProcessStoreClient
>()("@nikscripts/effect-pm/prisma/PrismaProcessStore/PrismaClientService") {}

/**
 * Build a layer providing {@link PrismaClientService} from a concrete client.
 *
 * @public
 */
export const prismaClientLayer = (config: {
  readonly client: PrismaProcessStoreClient;
}): Layer.Layer<PrismaClientService> =>
  Layer.succeed(PrismaClientService, config.client);

/**
 * Legacy direct constructor.
 *
 * @throws {@link PrismaProcessStoreUnavailableError}
 *
 * @public
 */
export const make = (
  _client: PrismaProcessStoreClient,
): never => {
  throw unavailable();
};

/**
 * Legacy Prisma ProcessStore layer.
 *
 * @remarks
 * This intentionally fails at layer acquisition so callers do not accidentally
 * persist runtime records to the old event-table adapter.
 *
 * @public
 */
export const layer = (_config: {
  readonly client: PrismaProcessStoreClient;
}): Layer.Layer<RuntimeStorage> =>
  Layer.effect(RuntimeStorage, Effect.die(unavailable()));

/**
 * Legacy Prisma ProcessStore layer that consumes {@link PrismaClientService}.
 *
 * @public
 */
export const layerFromContext: Layer.Layer<
  RuntimeStorage,
  never,
  PrismaClientService
> = Layer.effect(
  RuntimeStorage,
  Effect.flatMap(PrismaClientService, () => Effect.die(unavailable())),
);
