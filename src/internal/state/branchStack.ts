/**
 * Tier 2 — fiber-local active branch stack (two-tier state model).
 *
 * The shared base envelope (Tier 1, `StateRootRef`) holds only root author fields
 * + extend siblings — **no branch keys**. Active `withLeaf` branches (`Run`,
 * `Entry`, …) live here, **keyed by fiber**, so parallel runs are isolated (each
 * fiber sees only its own active path). The effective `current` read by
 * `yield* Scope` / `State.Root` / materialize is `merge(base, fiberStack)`.
 *
 * @module internal/state/branchStack
 * @internal
 */
import { Effect, Ref } from "effect";

/** One active branch segment: where it sits (`path`) and its author values. */
export interface BranchFrame {
  readonly path: ReadonlyArray<string>;
  readonly values: Record<string, unknown>;
}

const pathKey = (path: ReadonlyArray<string>): string => path.join(".");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const insertAtPath = (
  node: Record<string, unknown>,
  path: ReadonlyArray<string>,
  values: Record<string, unknown>,
): Record<string, unknown> => {
  const [head, ...rest] = path;
  if (head === undefined) {
    return { ...node, ...values };
  }
  if (rest.length === 0) {
    return { ...node, [head]: values };
  }
  const child = isRecord(node[head]) ? node[head] : {};
  return { ...node, [head]: insertAtPath(child, rest, values) };
};

// One active-branch stack per fiber. Empty stacks are pruned so the map does not
// retain finished fibers.
const stacksRef = Effect.runSync(
  Ref.make(new Map<number, ReadonlyArray<BranchFrame>>()),
);

const updateStack = (
  fiberId: number,
  f: (stack: ReadonlyArray<BranchFrame>) => ReadonlyArray<BranchFrame>,
): Effect.Effect<void> =>
  Ref.update(stacksRef, (m) => {
    const next = f(m.get(fiberId) ?? []);
    const map = new Map(m);
    if (next.length === 0) {
      map.delete(fiberId);
    } else {
      map.set(fiberId, next);
    }
    return map;
  });

/** The current fiber's active branch stack (outermost → innermost). */
export const getActiveStack: Effect.Effect<ReadonlyArray<BranchFrame>> =
  Effect.flatMap(Effect.fiberId, (fiberId) =>
    Effect.map(Ref.get(stacksRef), (m) => m.get(fiberId) ?? []),
  );

/** Install (or replace) the branch segment at `path` for the current fiber. */
export const installFrame = (
  path: ReadonlyArray<string>,
  values: Record<string, unknown>,
): Effect.Effect<void> =>
  Effect.flatMap(Effect.fiberId, (fiberId) =>
    updateStack(fiberId, (stack) => [
      ...stack.filter((frame) => pathKey(frame.path) !== pathKey(path)),
      { path, values },
    ]),
  );

/** Shallow-merge `partial` into the branch segment at `path` (no-op if absent). */
export const patchFrame = (
  path: ReadonlyArray<string>,
  partial: Record<string, unknown>,
): Effect.Effect<void> =>
  Effect.flatMap(Effect.fiberId, (fiberId) =>
    updateStack(fiberId, (stack) =>
      stack.map((frame) =>
        pathKey(frame.path) === pathKey(path)
          ? { path, values: { ...frame.values, ...partial } }
          : frame,
      ),
    ),
  );

/** Remove the branch segment at `path` for the current fiber. */
export const clearFrame = (path: ReadonlyArray<string>): Effect.Effect<void> =>
  Effect.flatMap(Effect.fiberId, (fiberId) =>
    updateStack(fiberId, (stack) =>
      stack.filter((frame) => pathKey(frame.path) !== pathKey(path)),
    ),
  );

/** Overlay a fiber's active branches onto the shared base — the effective view. */
export const mergeBranches = (
  base: Record<string, unknown>,
  stack: ReadonlyArray<BranchFrame>,
): Record<string, unknown> =>
  stack.reduce((acc, frame) => insertAtPath(acc, frame.path, frame.values), base);
