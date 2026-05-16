/**
 * @module examples/forms/process-store/process-store-prisma-structural-client
 *
 * ProcessStore Prisma adapter with a structural client placeholder.
 * Run: `npx tsx examples/forms/process-store/process-store-prisma-structural-client.ts`
 */

import { Clock, Effect } from "effect";
import { ProcessStore } from "../../../src/ProcessStore";
import { provideLayer } from "../../../src/provideLayer";
import {
  PrismaProcessStore,
  type EffectPmEventCreateInput,
  type EffectPmEventRow,
  type PrismaProcessStoreClient,
} from "../../../src/storage/prisma";

type FindManyArgs = Parameters<
  PrismaProcessStoreClient["effectPmEvent"]["findMany"]
>[0];

const valueEquals = (
  filter: string | { readonly equals?: string; readonly in?: ReadonlyArray<string> } | undefined,
  value: string,
): boolean => {
  if (filter === undefined) return true;
  if (typeof filter === "string") return value === filter;
  if (filter.equals !== undefined) return value === filter.equals;
  if (filter.in !== undefined) return filter.in.includes(value);
  return true;
};

const dateMatches = (
  filter: NonNullable<NonNullable<FindManyArgs>["where"]>["occurredAt"],
  value: Date,
): boolean => {
  if (filter === undefined) return true;
  if (filter.gt !== undefined && !(value > filter.gt)) return false;
  if (filter.gte !== undefined && !(value >= filter.gte)) return false;
  if (filter.lt !== undefined && !(value < filter.lt)) return false;
  if (filter.lte !== undefined && !(value <= filter.lte)) return false;
  return true;
};

const makePlaceholderClient = (): PrismaProcessStoreClient => {
  const rows: EffectPmEventRow[] = [];
  const insert = (input: EffectPmEventCreateInput): EffectPmEventRow => {
    const row: EffectPmEventRow = {
      id: input.id,
      type: input.type,
      occurredAt: input.occurredAt,
      entityType: input.entityType,
      entityId: input.entityId,
      attributes: input.attributes ?? null,
      payload: input.payload,
      createdAt: new Date(0),
    };
    rows.push(row);
    return row;
  };

  return {
    effectPmEvent: {
      create: ({ data }) => Promise.resolve(insert(data)),
      createMany: ({ data }) => {
        for (const input of data) {
          insert(input);
        }
        return Promise.resolve({ count: data.length });
      },
      findMany: (args) => {
        const where = args?.where;
        const out = rows.filter((row) =>
          valueEquals(where?.type, row.type) &&
          valueEquals(where?.entityType, row.entityType) &&
          valueEquals(where?.entityId, row.entityId) &&
          dateMatches(where?.occurredAt, row.occurredAt)
        );
        out.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
        return Promise.resolve(
          args?.take === undefined ? out : out.slice(0, args.take),
        );
      },
    },
  };
};

const program = Effect.gen(function* () {
  const store = yield* ProcessStore;
  const occurredAt = yield* Clock.currentTimeMillis;

  yield* store.append({
    id: "prisma-placeholder-started",
    type: "process.lifecycle.changed",
    occurredAt,
    entityType: "process",
    entityId: "examples/PrismaPlaceholderProcess",
    lifecycle: { tag: "Started" },
  });

  const events = yield* store.events({
    entityType: "process",
    entityId: "examples/PrismaPlaceholderProcess",
    types: ["process.lifecycle.changed"],
  });

  yield* Effect.log(
    `prisma placeholder events: ${events.map((event) => event.id).join(", ")}`,
  );
}).pipe(
  provideLayer(PrismaProcessStore.layer({ client: makePlaceholderClient() })),
);

void Effect.runPromise(program);
