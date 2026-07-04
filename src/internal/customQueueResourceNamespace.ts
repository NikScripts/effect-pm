/**
 * @module internal/customQueueResourceNamespace
 *
 * Assembled **`CustomQueueResource`** namespace — contract `Tag`/`layer`/`serve` tree-shake
 * separately from the engine `make` helper.
 */
import { CustomQueueResource as engine } from "../CustomQueueResource";

export {
  Tag,
  configure,
  layer,
  serve,
  serveRemote,
} from "../CustomQueueContract";

export const make = engine.make;
export const rateLimiterLayer = engine.rateLimiterLayer;
