# Telemetry definition metadata recipe

## Goal

Make each telemetry definition the single source of truth for:

- PascalCase row `type` strings (`Namespace.Tag.Event`);
- type unions for all wires and per-tag event wires;
- runtime wire arrays for query predicates;
- generated static / instance emitter trees;
- later decoder/index helpers.

## Non-goals

- Do not add `Telemetry.define(...)`; keep the Effect-style builder DSL.
- Do not add `Telemetry.match(...)`, `Telemetry.index(...)`, `Telemetry.project(...)`,
  or `Telemetry.codec(...)` in this slice.
- Do not migrate `QueueResourceStore` until metadata derivation is stable.

## Mise en place findings

- Current telemetry sections carry `emitTree`, `emitPaths`, and `wireIds`.
- `wireIds` is `string[]`, so literal event path types are lost.
- The existing `TelemetryPart` constraint widens concrete event tuples when
  helper metadata is threaded naively through `processStoreTelemetry(...)`.
- Prior attempts to add `Telemetry.Type.Event` / `Telemetry.events(...)` caused
  event leaves such as `Execution.Completed` to collapse to `unknown`.
- `RunResourceStore` still has local duplicated constants/unions because there
  is no stable facet-derived wire metadata helper yet.

## Locked ingredients

- Keep explicit builder style:

  ```ts
  const RunResourceTelemetry = ProcessStore.telemetry(RunResourceScope)(
    Telemetry.namespace("RunResource"),
    Telemetry.tag("Run")(
      Telemetry.event("Started", RunStarted),
      Telemetry.event("Completed", RunCompleted),
      Telemetry.event("Failed", RunFailed),
    ),
  )
  ```

- No `Telemetry.define(...)`.
- Identical payload schemas are shared across events.
- Row `type` is PascalCase and generated from the telemetry tree.
- No duplicate row `type`, `processType`, or `processId` in event schemas.

## Open recipe steps

### Step 1 — Metadata shape that does not erase event tuples

What this decides:
How `ProcessStore.telemetry(...)` should store literal namespace/tag/event
metadata while preserving current typed static emitters.

Recommended ingredients:
- Add a second type parameter to `ProcessStoreTelemetrySection` for metadata.
- Build metadata from `Telemetry.namespace(...)` and `Telemetry.tag(...)`
  parts, but do not constrain the variadic parts so tightly that event tuples
  widen to `TelemetryEventDef<string, unknown>`.
- Keep runtime metadata as an array of simple objects.

Picture:

```ts
type TelemetryWireMeta = {
  readonly namespace: string
  readonly tagPath: readonly string[]
  readonly event: string
  readonly wire: string
}

type TelemetryMetaFromParts<Parts> =
  // derived from concrete parts tuple:
  // [
  //   Telemetry.namespace("RunResource"),
  //   Telemetry.tag("Run")(
  //     Telemetry.event("Started", RunStarted),
  //   )
  // ]
  // ->
  // { namespace: "RunResource"; tagPath: ["Run"]; event: "Started"; wire: "RunResource.Run.Started" }
```

Alternatives:
1. Derive types from the emitter tree (`{ Run: { Started: ... } }`) — loses
   namespace and cannot derive full wire without extra metadata.
2. Store only runtime `wireIds: string[]` — easy, but cannot produce literal
   type helpers.
3. Create a second object DSL (`Telemetry.define`) — rejected; two authoring
   styles confuse agents and users.

Decision steps:
1. Should metadata be an array of `{ namespace, tagPath, event, wire }`? —
   **Recommended answer:** yes, because it is simple, serializable, and matches
   the existing builder model.
2. Should metadata be an extra generic on `ProcessStoreTelemetrySection` rather
   than replacing `EmitApi`? — **Recommended answer:** yes, because emitter
   typing and metadata typing are related but separate.
3. Should the runtime API expose only read helpers (`events`) first? —
   **Recommended answer:** yes; defer match/index/project until their APIs are
   baked.

Ingredients:
Use `ProcessStoreTelemetrySection<EmitApi, Meta>` and derive `Meta` from the
same concrete builder parts that already derive `EmitApi`.

Acceptance check:

```ts
type RunWire = Telemetry.Type.Wire<typeof RunResourceTelemetry>
// "RunResource.Run.Started" | "RunResource.Run.Completed" | ...

type RunEvents = Telemetry.Type.Event<typeof RunResourceTelemetry, "Run">
// "RunResource.Run.Started" | "RunResource.Run.Completed" | "RunResource.Run.Failed"

Telemetry.events(RunResourceTelemetry, "Run")
// ["RunResource.Run.Started", "RunResource.Run.Completed", "RunResource.Run.Failed"]

ProcessExecutionStore.Execution.Completed
// still Effect<void>, not unknown
```

## Cleanup status

Open. Delete this recipe once metadata helpers are implemented or moved into
`docs/plans/17-facet-telemetry-factory.md`.
