import { fileURLToPath } from "node:url";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Clock, Duration, Effect, Stream } from "effect";
import { ChildProcess } from "effect/unstable/process";
import { describe, expect, it } from "vitest";

/**
 * Regression: Lookup + address-less Worker in one process must accept RPC from
 * another process (`Layer.fresh` on SocketServer / ServedResources).
 *
 * Runs the forms demo script (`demo` role).
 */
describe("address-less ipc cross-process", () => {
  it(
    "serve process + lookupClient call process round-trip",
    () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const script = fileURLToPath(
            new URL(
              "../examples/forms/resource/addressless-ipc-lookup.ts",
              import.meta.url,
            ),
          );
          const now = yield* Clock.currentTimeMillis;
          const lookupSock = `/tmp/effect-pm-al-xproc-${String(now)}.sock`;
          const execPath = yield* Effect.sync(() => process.execPath);

          const handle = yield* ChildProcess.make(
            execPath,
            ["--import", "tsx", script, "demo"],
            {
              env: { LOOKUP_SOCK: lookupSock },
              extendEnv: true,
            },
          );

          let out = "";
          yield* handle.all.pipe(
            Stream.decodeText(),
            Stream.tap((chunk) =>
              Effect.sync(() => {
                out += chunk;
              }),
            ),
            Stream.runDrain,
          );
          const code = yield* handle.exitCode;
          expect(Number(code)).toBe(0);
          expect(out).toContain("jobs.jobs → 42");
          expect(out).toContain("demo: ok");
        }).pipe(
          Effect.scoped,
          Effect.provide(NodeServices.layer),
          Effect.timeout(Duration.seconds(60)),
        ),
      ),
    60_000,
  );
});
