import { Duration, Effect } from "effect";
import {
  CommandAuthReplayStoreError,
  ReplayedCommand,
} from "./errors";
import type {
  CommandAuthReplayStore,
  CommandAuthReplayStoreReserveInput,
} from "../../CommandAuth";

export interface MemoryReplayStoreOptions {
  readonly window?: Parameters<typeof Duration.fromInputUnsafe>[0];
  readonly maxEntries?: number;
}

const replayKey = (
  input: Pick<CommandAuthReplayStoreReserveInput, "keyId" | "envelopeId">,
): string => `${input.keyId}\u0000${input.envelopeId}`;

export const makeMemoryReplayStore = (
  options: MemoryReplayStoreOptions = {},
): CommandAuthReplayStore => {
  const accepted = new Map<string, number>();
  const maxEntries = options.maxEntries ?? 10_000;

  return {
    reserve: (input) =>
      Effect.sync(() => {
        for (const [key, expiresAt] of accepted) {
          if (expiresAt <= input.sentAt || accepted.size >= maxEntries) {
            accepted.delete(key);
          }
        }

        const key = replayKey(input);
        const existing = accepted.get(key);
        if (existing !== undefined && existing > input.sentAt) {
          return new ReplayedCommand({
            keyId: input.keyId,
            envelopeId: input.envelopeId,
            reason: `Command envelope '${input.envelopeId}' for key '${input.keyId}' was already accepted`,
          });
        }

        accepted.set(key, input.expiresAt);
        return undefined;
      }).pipe(
        Effect.flatMap((error) =>
          error === undefined ? Effect.void : Effect.fail(error)
        ),
        Effect.mapError((error) =>
          error instanceof ReplayedCommand
            ? error
            : new CommandAuthReplayStoreError({
                reason: String(error),
              })
        ),
      ),
  };
};
