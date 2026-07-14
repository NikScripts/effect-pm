import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Layer } from "effect";
import * as Logs from "../src/Logs";
import * as Resource from "../src/Resource";
import * as Store from "../src/Store";
import { LogStore } from "../src/store/log";

/**
 * Dual-compose policy: interim `Logs.persistLayer` + `Node.logs` for the same node key
 * are unsupported (two writers for one journal scope). Prefer registration followers only.
 */
class DualNode extends Resource.Node<DualNode>("test/dual-compose/node") {}

class NodeOnlyStore extends Store.Service<NodeOnlyStore>("@test/dual-compose/NodeOnly")(
  DualNode.logs,
) {}

describe("persistLayer vs Node.logs dual-compose", () => {
  it("Node.logs path alone durability works", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.logInfo("reg-only");
        yield* Effect.gen(function* () {
          while ((yield* Logs.byNode(DualNode)).length === 0) {
            yield* Effect.sleep(Duration.millis(20));
          }
        }).pipe(Effect.timeout(Duration.seconds(3)));
        const rows = yield* Logs.byNode(DualNode);
        expect(rows.some((row) => row.message === "reg-only")).toBe(true);
      }).pipe(Effect.provide(NodeOnlyStore.layerMemory), Effect.scoped),
    ));

  it("deprecated persistLayer path alone still works", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.logInfo("persist-only");
        yield* Effect.gen(function* () {
          while ((yield* Logs.byNode(DualNode)).length === 0) {
            yield* Effect.sleep(Duration.millis(20));
          }
        }).pipe(Effect.timeout(Duration.seconds(3)));
        const rows = yield* Logs.byNode(DualNode);
        expect(rows.some((row) => row.message === "persist-only")).toBe(true);
      }).pipe(
        Effect.provide(
          Logs.persistLayer(DualNode).pipe(
            Layer.provideMerge(Layer.mergeAll(Logs.layer, LogStore.layerMemory)),
          ),
        ),
        Effect.scoped,
      ),
    ));
});
