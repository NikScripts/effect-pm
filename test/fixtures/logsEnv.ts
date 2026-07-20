/**
 * Shared logs stack for tests — capture + node durable journal via {@link Resource.store}.
 *
 * @internal test fixture only
 */

import * as Resource from "../../src/Resource";
import * as Store from "../../src/Store";
import { testBillingNodeKey } from "./logKeys";
import * as Node from "../../src/Node";

/** `Store.Service` with node journal — bakes in Logs.layer + durable tail. */
export const testLogsEnv = (nodeKey: string = testBillingNodeKey) => {
  class EnvNode extends Node.Tag<EnvNode>(nodeKey) {}
  class EnvStore extends Store.Service<EnvStore>(`@test/LogsEnv/${nodeKey}`)(
    EnvNode.logs,
  ) {}
  return EnvStore.layerMemory;
};
