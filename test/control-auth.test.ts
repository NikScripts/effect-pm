import { ProcessStorage } from "../src/ProcessStorage";
import { describe, expect, it } from "@effect/vitest";
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import {
  Effect,
  Layer,
  Ref,
} from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import {
  CommandAuth,
  ControlService,
  makeControlProtocolRequestEnvelope,
  makeControlTransportHttpClient,
  Process,
  ProcessGroup,
  ProcessManager,
} from "../src";

const authPort = 32157;
const baseUrl = `http://127.0.0.1:${String(authPort)}`;
const healthPort = authPort + 1;
const healthBaseUrl = `http://127.0.0.1:${String(healthPort)}`;

const makeKeys = () =>
  CommandAuth.generateEd25519KeyPair({
    name: "test-operator",
    expiresAt: "2099-12-31T23:59:59.999Z",
    keyId: "cmd_control_auth_test",
  });

describe("Control command authentication", () => {
  it.live("rejects unsigned control before process routing and accepts signed controls", () =>
    Effect.gen(function* () {
      const runs = yield* Ref.make(0);
      const keys = yield* makeKeys();

      class SyncProcess extends Process.Service<SyncProcess>()(
        "@test/AuthSyncProcess",
        {
          effect: Ref.update(runs, (count) => count + 1),
        },
      ) {}

      class BillingGroup extends ProcessGroup.Service<BillingGroup>()(
        "@test/AuthBillingGroup",
        [SyncProcess] as const,
      ) {}

      yield* Effect.gen(function* () {
        const group = yield* BillingGroup;
        yield* ControlService.make({
          port: authPort,
          group,
          auth: CommandAuth.ed25519Verifier({
            keys: [keys.publicKey],
          }),
        });

        const unsigned = ProcessManager.connect(BillingGroup, {
          baseUrl,
        });
        const signed = ProcessManager.connect(BillingGroup, {
          baseUrl,
          auth: CommandAuth.ed25519Signer(keys.privateKey),
        });

        const unsignedError = yield* unsigned
          .process(SyncProcess.id)
          .runImmediately
          .pipe(Effect.flip);
        expect(unsignedError.status).toBe(401);
        expect(yield* Ref.get(runs)).toBe(0);

        yield* signed.process(SyncProcess.id).runImmediately;
        expect(yield* Ref.get(runs)).toBe(1);
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            BillingGroup.layer.pipe(
              Layer.provide(Layer.mergeAll(SyncProcess.layer, ProcessStorage.layer)),
            ),
            ProcessStorage.layer,
            NodeHttpClient.layerUndici,
          ),
        ),
      );
    }),
  );

  it.live("uses signed GetHealth and rejects replayed envelopes", () =>
    Effect.gen(function* () {
      const keys = yield* makeKeys();

      class SyncProcess extends Process.Service<SyncProcess>()(
        "@test/AuthHealthProcess",
        {
          effect: Effect.void,
        },
      ) {}

      class BillingGroup extends ProcessGroup.Service<BillingGroup>()(
        "@test/AuthHealthGroup",
        [SyncProcess] as const,
      ) {}

      yield* Effect.gen(function* () {
        const group = yield* BillingGroup;
        yield* ControlService.make({
          port: healthPort,
          group,
          auth: CommandAuth.ed25519Verifier({
            keys: [keys.publicKey],
          }),
        });

        const signedTransport = makeControlTransportHttpClient({
          baseUrl: healthBaseUrl,
          auth: CommandAuth.ed25519Signer(keys.privateKey),
        });
        const envelope = yield* makeControlProtocolRequestEnvelope({
          _tag: "GetHealth",
        });

        const health = yield* signedTransport.request(envelope);
        const replay = yield* signedTransport.request(envelope);
        const unsignedHealth = yield* HttpClient.execute(
          HttpClientRequest.get(`${healthBaseUrl}/health`),
        );

        expect(health.response).toMatchObject({
          _tag: "Control",
          status: 200,
          body: {
            success: true,
            data: { status: "ok" },
          },
        });
        expect(replay.response).toMatchObject({
          _tag: "Control",
          status: 401,
        });
        expect(unsignedHealth.status).toBe(404);
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            BillingGroup.layer.pipe(
              Layer.provide(Layer.mergeAll(SyncProcess.layer, ProcessStorage.layer)),
            ),
            ProcessStorage.layer,
            NodeHttpClient.layerUndici,
          ),
        ),
      );
    }),
  );
});
