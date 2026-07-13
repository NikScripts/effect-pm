/**
 * Shared logs stack for tests — runtime capture + durable memory store.
 *
 * @internal test fixture only
 */

import { Layer } from "effect";
import * as Logs from "../../src/Logs";
import * as ProcessStorage from "../../src/ProcessStorage";
import { testBillingNodeKey } from "./logKeys";

/** `Logs.layer` + `persistLayer(node)` + in-memory `LogStore`. */
export const testLogsEnv = (nodeKey: string = testBillingNodeKey) =>
  Logs.persistLayer(nodeKey).pipe(
    Layer.provideMerge(Layer.mergeAll(Logs.layer, ProcessStorage.layer)),
  );
