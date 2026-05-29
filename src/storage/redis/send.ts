/**
 * Redis command transport for {@link RuntimeStorage} adapters.
 *
 * @module storage/redis/send
 * @public
 */

import { Effect } from "effect";
import type { RuntimeStorageOperationalError } from "../../RuntimeStorage";

/**
 * Minimal Redis command surface used by the runtime storage adapter.
 *
 * @remarks
 * Matches the `send(command, ...args)` shape used by Effect persistence Redis
 * and common Node clients. Replies are normalized by the adapter.
 *
 * @public
 */
export interface RuntimeStorageRedisSend {
  readonly send: (
    command: string,
    ...args: ReadonlyArray<string>
  ) => Effect.Effect<unknown, RuntimeStorageOperationalError>;
}

type InMemoryRedisState = {
  readonly strings: Map<string, string>;
  readonly sets: Map<string, Set<string>>;
};

const normalizeCommand = (command: string): string => command.toUpperCase();

const getSet = (state: InMemoryRedisState, key: string): Set<string> => {
  const existing = state.sets.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const created = new Set<string>();
  state.sets.set(key, created);
  return created;
};

/**
 * In-process Redis `send` for tests and local development without a server.
 *
 * @public
 */
export const makeInMemoryRedisSend = (): RuntimeStorageRedisSend & {
  readonly state: InMemoryRedisState;
} => {
  const state: InMemoryRedisState = {
    strings: new Map(),
    sets: new Map(),
  };

  const send: RuntimeStorageRedisSend["send"] = (command, ...args) =>
    Effect.sync(() => {
      switch (normalizeCommand(command)) {
        case "GET": {
          const key = args[0];
          if (key === undefined) {
            return null;
          }
          return state.strings.get(key) ?? null;
        }
        case "SET": {
          const key = args[0];
          const value = args[1];
          if (key === undefined || value === undefined) {
            return null;
          }
          const nx = args[2]?.toUpperCase() === "NX";
          if (nx && state.strings.has(key)) {
            return null;
          }
          state.strings.set(key, value);
          return "OK";
        }
        case "DEL": {
          let removed = 0;
          for (const key of args) {
            if (state.strings.delete(key)) {
              removed++;
            }
            if (state.sets.delete(key)) {
              removed++;
            }
          }
          return removed;
        }
        case "EXISTS": {
          const key = args[0];
          if (key === undefined) {
            return 0;
          }
          return state.strings.has(key) || state.sets.has(key) ? 1 : 0;
        }
        case "SADD": {
          const key = args[0];
          if (key === undefined) {
            return 0;
          }
          const set = getSet(state, key);
          let added = 0;
          for (const member of args.slice(1)) {
            if (!set.has(member)) {
              set.add(member);
              added++;
            }
          }
          return added;
        }
        case "SREM": {
          const key = args[0];
          if (key === undefined) {
            return 0;
          }
          const set = state.sets.get(key);
          if (set === undefined) {
            return 0;
          }
          let removed = 0;
          for (const member of args.slice(1)) {
            if (set.delete(member)) {
              removed++;
            }
          }
          return removed;
        }
        case "SMEMBERS": {
          const key = args[0];
          if (key === undefined) {
            return [];
          }
          const set = state.sets.get(key);
          return set === undefined ? [] : [...set];
        }
        default:
          throw new Error(`InMemoryRedisSend: unsupported command ${command}`);
      }
    });

  return { send, state };
};
