/**
 * Shared store read derivations for resource analytics contracts.
 *
 * Pure helpers over a shape's `read` — used by queue and run-resource tier-3
 * contracts so domain-specific specs stay thin.
 *
 * @module internal/store/analytics
 * @internal
 */

import { Effect, Option } from "effect";

/** Post-filter the rows returned by a shape read. @internal */
export const filterRead = <Row>(
  read: (payload?: unknown) => Effect.Effect<ReadonlyArray<Row>>,
  predicate: (row: Row) => boolean,
): ((payload?: unknown) => Effect.Effect<ReadonlyArray<Row>>) =>
  (payload?: unknown) => Effect.map(read(payload), (rows) => rows.filter(predicate));

/** Keep rows whose `key` equals `value` (client-side; journal push-down is future work). @internal */
export const readWhere = <Row, K extends keyof Row>(
  read: (payload?: unknown) => Effect.Effect<ReadonlyArray<Row>>,
  key: K,
  value: Row[K],
): Effect.Effect<ReadonlyArray<Row>> =>
  filterRead(read, (row) => row[key] === value)();

/** Last `n` rows from a full read. @internal */
export const recent = <Row>(
  read: () => Effect.Effect<ReadonlyArray<Row>>,
  n: number,
): Effect.Effect<ReadonlyArray<Row>> =>
  Effect.map(read(), (rows) => (n <= 0 ? [] : rows.slice(Math.max(0, rows.length - n))));

/** Last row matching `predicate`, if any. @internal */
export const lastMatch = <Row>(
  read: () => Effect.Effect<ReadonlyArray<Row>>,
  predicate: (row: Row) => boolean,
): Effect.Effect<Option.Option<Row>> =>
  Effect.map(read(), (rows) => {
    const matches = rows.filter(predicate);
    return matches.length === 0
      ? Option.none()
      : Option.some(matches[matches.length - 1]!);
  });

/** `failed / (completed + failed)`; `0` when the denominator is `0`. @internal */
export const failureRate = <Row>(
  read: () => Effect.Effect<ReadonlyArray<Row>>,
  isCompleted: (row: Row) => boolean,
  isFailed: (row: Row) => boolean,
): Effect.Effect<number> =>
  Effect.map(read(), (rows) => {
    let completed = 0;
    let failed = 0;
    for (const row of rows) {
      if (isCompleted(row)) completed += 1;
      else if (isFailed(row)) failed += 1;
    }
    const total = completed + failed;
    return total === 0 ? 0 : failed / total;
  });
