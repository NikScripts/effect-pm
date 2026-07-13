/**
 * Shared logs stack for tests — runtime capture + durable memory store.
 *
 * @internal test fixture only
 */

import { Layer } from "effect";
import * as Logs from "../../src/Logs";
import { LogStore } from "../../src/store/log";
import { testBillingNodeKey } from "./logKeys";

/** `Logs.layer` + `persistLayer(node)` + in-memory `LogStore`. */
export const testLogsEnv = (nodeKey: string = testBillingNodeKey) =>
  Logs.persistLayer(nodeKey).pipe(
    Layer.provideMerge(Layer.mergeAll(Logs.layer, LogStore.layerMemory)),
  );
