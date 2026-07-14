/**
 * @module examples/forms/dynamic-config/dynamic-config-hot-swap
 *
 * Hot-swappable config: define, read, swap on the field, read the whole bag,
 * swap by key, freeze. Run: `pnpm run example:form:dynamic-config-hot-swap`
 */

import { Config, Effect, Redacted } from "effect";
import * as DynamicConfig from "../../../src/DynamicConfig";
import { runNodeProgramWithLayer } from "../../shared/demo-harness";

// Define config the normal way; wrap the one field that may rotate at runtime.
// Defaults let the demo run with no env vars set.
const cfg = DynamicConfig.make({
  baseUrl: Config.string("API_BASE_URL").pipe(
    Config.withDefault("https://api.example.com"),
  ),
  apiKey: DynamicConfig.swappable(
    Config.redacted("API_KEY").pipe(
      Config.withDefault(Redacted.make("k-initial")),
    ),
  ),
});

const program = Effect.gen(function* () {
  // Reads are native Config — just yield the field (`R = never`).
  yield* Effect.logInfo(`baseUrl          : ${yield* cfg.baseUrl}`);
  yield* Effect.logInfo(
    `apiKey (initial) : ${Redacted.value(yield* cfg.apiKey)}`,
  );

  // Swap on the field. Every reader of API_KEY now sees the new value.
  yield* cfg.apiKey.set("k-rotated");
  yield* Effect.logInfo(
    `apiKey (swapped) : ${Redacted.value(yield* cfg.apiKey)}`,
  );

  // Even a raw `Config` reader of the same key sees it — they share the provider.
  const rawKey = yield* Config.redacted("API_KEY");
  yield* Effect.logInfo(`raw reader sees  : ${Redacted.value(rawKey)}`);

  // Read the whole config as one object, like `Config.all`.
  const whole = yield* DynamicConfig.all(cfg);
  yield* Effect.logInfo(
    `all              : baseUrl=${whole.baseUrl} apiKey=${Redacted.value(whole.apiKey)}`,
  );

  // Remote/RPC path: swap by key, guarded by the per-runtime allowlist.
  yield* DynamicConfig.setByKey("API_KEY", "k-by-key");
  yield* Effect.logInfo(
    `apiKey (by key)  : ${Redacted.value(yield* cfg.apiKey)}`,
  );

  // A frozen view still reads the live value, but `safe.apiKey.set(...)` would
  // not compile — handed to code that should only read.
  const safe = DynamicConfig.freeze(cfg);
  yield* Effect.logInfo(
    `frozen view reads: ${Redacted.value(yield* safe.apiKey)}`,
  );
});

runNodeProgramWithLayer(
  program,
  // scoped: layer(cfg) allowlists cfg's swappable keys for the setByKey path
  DynamicConfig.layer(cfg),
  "form:dynamic-config-hot-swap finished",
);
