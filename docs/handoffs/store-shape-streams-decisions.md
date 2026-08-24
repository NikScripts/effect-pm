# Store — nested shapes + shape-scoped change streams (decisions)

Status: approved, building. Scope of THIS work: (1) nested shape tree in the store contract,
(2) default per-shape effects surfaced on the tree, (3) `Store.changes` overloads incl. the
shape selector. Deferred: the object-of-effects / `with*` redesign (separate discussion);
append-from-stream (low priority — sketch at the end).

## 1. Nested shape tree

Today shapes are flat: `StoreShapes = Readonly<Record<string, StoreShapeInput>>`,
`StoreShapeInput = Schema.Schema | StoreShapeDef`. Nested makes the value recursive.

```ts
// a shape input may now ALSO be a sub-tree of shape inputs
export type StoreShapeInput =
  | Schema.Schema<unknown>
  | StoreShapeDef
  | StoreShapeTree;                                  // NEW
export interface StoreShapeTree extends Readonly<Record<string, StoreShapeInput>> {}
```

`ShapeHandles<Shapes>` becomes recursive — a leaf yields `{ append, read }` (the default
per-shape effects, unchanged), a sub-tree yields a nested object of handles:

```ts
export type ShapeHandles<Shapes extends StoreShapes> = {
  readonly [K in keyof Shapes & string]:
    Shapes[K] extends StoreShapeTree ? ShapeHandles<Shapes[K]>          // recurse
    : Shapes[K] extends StoreShapeInputLeaf ? ShapeNamespaceMembers<RowOf<Shapes[K]>, ReadOf<Shapes[K]>>
    : never;
};
```

Runtime: `makeShapeHandles` recurses; each leaf keeps its own `ShapeBinding`. Spec keys are the
**dotted path** (`sensors.temperature`, `sensors.temperature/read`) so the journal + bindings stay
a flat map internally while the API is a tree. `classifyCustomMethod` keeps working — a custom
method aliasing `shapes.sensors.temperature.append` is still an `APPEND_ALIAS` (identity match),
now against a nested handle. No new `CustomMethodEntry` variant needed.

## 2. Default per-shape effects (already exist — just exposed on the tree)

Every leaf already carries `append`/`read` via `ShapeNamespaceMembers`. Nesting changes nothing here
except that they now live at `shapes.sensors.temperature.append` instead of only `shapes.temperature`.

## 3. `Store.changes` — three overloads, the desired types

```ts
// (a) coarse firehose — bare scope, dynamic/string-keyed. Unchanged, kept as the escape hatch.
export function changes(
  scope: string | StoreScopeTag,
): Effect.Effect<Stream.Stream<StoreChangeEvent, StoreJournalDecodeError>, StoreScopeNotRegistered, Storage | Scope.Scope>;

// (b) typed-all — a store class, no selector → union of every shape's rows, discriminated.
export function changes<S extends StoreClassWithShapes>(
  store: S,
): Effect.Effect<Stream.Stream<AllShapeRows<S>, StoreJournalDecodeError>, never, Storage | Scope.Scope>;

// (c) shape-selected — the priority. Selector navigates the shape tree; result is THAT shape's rows.
export function changes<S extends StoreClassWithShapes, Row>(
  store: S,
  select: (shapes: ShapeRefs<S>) => ShapeRef<Row>,
): Effect.Effect<Stream.Stream<SchemaDecoded<Row>, StoreJournalDecodeError>, never, Storage | Scope.Scope>;
```

- `ShapeRefs<S>` is the shape tree as **selectable refs** — leaves are `ShapeRef<Row>` carrying the
  row schema at the type level, so `(shapes) => shapes.sensors.temperature` infers `Row`.
- The **desired type** of `changes(store, (s) => s.temperature)` is
  `Effect<Stream<TemperatureRow, StoreJournalDecodeError>, never, Storage | Scope>` — decoded rows of
  that one shape, not the coarse `StoreChangeEvent`. (a) stays coarse on purpose.
- Runtime: (b)/(c) resolve the store scope, take `bridge.changes(scopeKey)`, then `Stream.filter` by
  the selected shape's dotted key and `Stream.mapEffect` decode against that shape's row schema.

## 4. Append-from-stream (low priority — the simple one)

A `Stream<Row> → append` pump, one liner over the existing shape append:

```ts
// runs the stream into the shape's append; fire-and-forget drain in a scope
export const appendFrom = <Row>(
  shape: ShapeRef<Row>,
  source: Stream.Stream<SchemaDecoded<Row>>,
): Effect.Effect<void, never, Storage | Scope.Scope> =>
  Stream.runForEach(source, (row) => /* resolve + shape.append(row) */);
```

## Build order

1. Nested types + `makeShapeHandles`/spec recursion (contractDef) — **prereq**.
2. `ShapeRefs`/`ShapeRef` selectable-tree types.
3. `Store.changes` overloads (b)+(c) on top of the existing bridge changes stream.
4. `.test-d.ts` pinning the desired types for (a)/(b)/(c); no `as` casts in the new code.
5. `appendFrom` (after).
