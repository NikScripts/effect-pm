/**
 * Dream-redeploy tip **v1** — copied onto the active worker path before `up(A)`.
 * argv: `<label> <httpPort> <sockA> <sockB>`
 * assume token from `HYPERLINK_ASSUME_TOKEN`.
 *
 * Backend only — listens on its labeled Unix; edge (orchestrator) owns public Http.
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect } from "effect";
import * as Hyperlink from "../../src/Hyperlink";
import * as Node from "../../src/Node";
import * as NodePolicy from "../../src/NodePolicy";
import * as WorkPool from "../../src/WorkPool";
import { Jobs, Probe, makeDreamNodes } from "./dream-redeploy-shared";

const labelArg = process.argv[2];
const portArg = process.argv[3];
const sockA = process.argv[4];
const sockB = process.argv[5];
const port = portArg !== undefined ? Number(portArg) : Number.NaN;
const label = labelArg === "A" || labelArg === "B" ? labelArg : undefined;

const program =
  label === undefined ||
  !Number.isInteger(port) ||
  port <= 0 ||
  sockA === undefined ||
  sockA.length === 0 ||
  sockB === undefined ||
  sockB.length === 0
    ? Effect.die(
        "dream-redeploy-worker.v1: need <A|B> <httpPort> <sockA> <sockB>",
      )
    : Effect.gen(function* () {
        const token = yield* Node.assumeTokenConfig;
        const { WorkerPrivate } = makeDreamNodes(port, sockA, sockB);
        // Listen labeled Unix only — advertise stays Primary (Http), so this
        // dial is not Directory-published (edge owns the stable primary row).
        const backend = Node.withPolicy(
          WorkerPrivate,
          NodePolicy.as(label),
          NodePolicy.listen([label]),
        );

        const live = Node.unix(
          backend,
          [
            WorkPool.serve(Jobs, { effect: () => Effect.void }).pipe(
              Hyperlink.deferStart,
            ),
            Hyperlink.serve(Probe, {
              tip: Effect.succeed("v1"),
            }),
          ],
          {
            unlink: true,
            assumeToken: token,
          },
        );
        return yield* Node.launch(backend, live);
      }).pipe(Effect.provide(NodeServices.layer));

NodeRuntime.runMain(program);
