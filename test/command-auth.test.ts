import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { DateTime, Duration, Effect, FileSystem, Path } from "effect";
import {
  CommandAuth,
  ExpiredKey,
  ReplayedCommand,
  SignatureVerificationFailed,
  UnknownKeyId,
  type CommandAuthSigningInput,
} from "../src";

const sentAt = DateTime.toEpochMillis(DateTime.makeUnsafe("2026-06-01T00:00:00.000Z"));

const signingInput: CommandAuthSigningInput = {
  method: "POST",
  path: "/control",
  envelope: {
    id: "control-20260601-1",
    sentAt,
    metadata: {
      actor: "nik",
      reason: "manual catch-up",
    },
    request: {
      _tag: "RunProcessImmediately",
      processId: "@app/Billing/SyncInvoices",
    },
  },
};

const expiresAt = "2099-12-31T23:59:59.999Z";

describe("CommandAuth", () => {
  it.effect("encodes the canonical command payload deterministically", () =>
    Effect.gen(function* () {
      const text = yield* CommandAuth.canonicalPayloadText(signingInput);

      expect(text).toBe(
        "{\"envelope\":{\"id\":\"control-20260601-1\",\"metadata\":{\"actor\":\"nik\",\"reason\":\"manual catch-up\"},\"request\":{\"_tag\":\"RunProcessImmediately\",\"processId\":\"@app/Billing/SyncInvoices\"},\"sentAt\":1780272000000},\"method\":\"POST\",\"path\":\"/control\",\"version\":\"effect-pm-command-auth-v1\"}",
      );
    }),
  );

  it.effect("round trips a generated Ed25519 command signature", () =>
    Effect.gen(function* () {
      const keys = yield* CommandAuth.generateEd25519KeyPair({
        name: "nik-laptop",
        expiresAt,
        keyId: "cmd_test",
      });
      const signer = CommandAuth.ed25519Signer(keys.privateKey);
      const verifier = CommandAuth.ed25519Verifier({
        keys: [keys.publicKey],
        replay: CommandAuth.Replay.memory({ window: Duration.minutes(5) }),
      });

      const header = yield* signer.sign(signingInput);

      yield* verifier.verify({ header, input: signingInput, now: sentAt });
      const parsed = yield* CommandAuth.parseSignatureHeader(
        CommandAuth.formatSignatureHeader(header),
      );
      expect(header.keyId).toBe("cmd_test");
      expect(header.algorithm).toBe("Ed25519");
      expect(parsed).toEqual(header);
    }),
  );

  it.effect("rejects replayed envelope ids with a typed error", () =>
    Effect.gen(function* () {
      const keys = yield* CommandAuth.generateEd25519KeyPair({
        name: "nik-laptop",
        expiresAt,
      });
      const signer = CommandAuth.ed25519Signer(keys.privateKey);
      const verifier = CommandAuth.ed25519Verifier({
        keys: [keys.publicKey],
        replay: CommandAuth.Replay.memory({ window: Duration.minutes(5) }),
      });
      const header = yield* signer.sign(signingInput);

      yield* verifier.verify({ header, input: signingInput, now: sentAt });
      const error = yield* verifier
        .verify({ header, input: signingInput, now: sentAt })
        .pipe(Effect.flip);

      expect(error).toBeInstanceOf(ReplayedCommand);
      expect(error._tag).toBe("ReplayedCommand");
    }),
  );

  it.effect("honors the replay window configured on the memory replay store", () =>
    Effect.gen(function* () {
      const keys = yield* CommandAuth.generateEd25519KeyPair({
        name: "nik-laptop",
        expiresAt,
      });
      const signer = CommandAuth.ed25519Signer(keys.privateKey);
      const verifier = CommandAuth.ed25519Verifier({
        keys: [keys.publicKey],
        replay: CommandAuth.Replay.memory({ window: Duration.millis(1) }),
      });
      const header = yield* signer.sign(signingInput);

      const error = yield* verifier
        .verify({ header, input: signingInput, now: sentAt + 10 })
        .pipe(Effect.flip);

      expect(error).toBeInstanceOf(ExpiredKey);
      expect(error._tag).toBe("ExpiredKey");
    }),
  );

  it.effect("rejects unknown key ids before signature verification", () =>
    Effect.gen(function* () {
      const signerKeys = yield* CommandAuth.generateEd25519KeyPair({
        name: "nik-laptop",
        expiresAt,
        keyId: "cmd_signer",
      });
      const verifierKeys = yield* CommandAuth.generateEd25519KeyPair({
        name: "other-laptop",
        expiresAt,
        keyId: "cmd_verifier",
      });
      const signer = CommandAuth.ed25519Signer(signerKeys.privateKey);
      const verifier = CommandAuth.ed25519Verifier({
        keys: [verifierKeys.publicKey],
      });
      const header = yield* signer.sign(signingInput);

      const error = yield* verifier
        .verify({ header, input: signingInput, now: sentAt })
        .pipe(Effect.flip);

      expect(error).toBeInstanceOf(UnknownKeyId);
      expect(error._tag).toBe("UnknownKeyId");
    }),
  );

  it.effect("rejects signatures for a different payload", () =>
    Effect.gen(function* () {
      const keys = yield* CommandAuth.generateEd25519KeyPair({
        name: "nik-laptop",
        expiresAt,
      });
      const signer = CommandAuth.ed25519Signer(keys.privateKey);
      const verifier = CommandAuth.ed25519Verifier({
        keys: [keys.publicKey],
      });
      const header = yield* signer.sign(signingInput);
      const tamperedInput: CommandAuthSigningInput = {
        ...signingInput,
        envelope: {
          ...signingInput.envelope,
          request: {
            _tag: "RunProcessImmediately",
            processId: "@app/Billing/Other",
          },
        },
      };

      const error = yield* verifier
        .verify({ header, input: tamperedInput, now: sentAt })
        .pipe(Effect.flip);

      expect(error).toBeInstanceOf(SignatureVerificationFailed);
      expect(error._tag).toBe("SignatureVerificationFailed");
    }),
  );

  it.effect("decodes public key records from JSON", () =>
    Effect.gen(function* () {
      const keys = yield* CommandAuth.generateEd25519KeyPair({
        name: "nik-laptop",
        expiresAt,
      });
      const json = `[{"keyId":"${keys.publicKey.keyId}","name":"nik-laptop","algorithm":"Ed25519","publicKeyPem":"${keys.publicKey.publicKeyPem.replace(/\n/g, "\\n")}","expiresAt":"${expiresAt}"}]`;

      const decoded = yield* CommandAuth.decodePublicKeyRecordsJson(json);

      expect(decoded).toEqual([keys.publicKey]);
    }),
  );

  it.live("loads a private key record from a PEM file", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const dir = yield* fs.makeTempDirectoryScoped({ prefix: "effect-pm-private-key-" });
        const filepath = path.join(dir, "private.pem");
        const keys = yield* CommandAuth.generateEd25519KeyPair({
          name: "nik-laptop",
          expiresAt,
          keyId: "cmd_private_file",
        });
        yield* fs.writeFileString(filepath, keys.privateKey.privateKeyPem);

        const loaded = yield* CommandAuth.loadPrivateKeyRecord({
          keyId: keys.privateKey.keyId,
          name: keys.privateKey.name,
          expiresAt: keys.privateKey.expiresAt,
          privateKeyFile: filepath,
        });

        expect(loaded).toEqual(keys.privateKey);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.live("loads and merges public key records from files and directories", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const dir = yield* fs.makeTempDirectoryScoped({ prefix: "effect-pm-keys-" });
        const file = path.join(dir, "keyring.json");
        const keyDir = path.join(dir, "keyring");
        yield* fs.makeDirectory(keyDir);
        const left = yield* CommandAuth.generateEd25519KeyPair({
          name: "left",
          expiresAt,
          keyId: "cmd_left",
        });
        const right = yield* CommandAuth.generateEd25519KeyPair({
          name: "right",
          expiresAt,
          keyId: "cmd_right",
        });
        yield* fs.writeFileString(file, `${CommandAuth.publicKeyRecordsJson([left.publicKey])}\n`);
        yield* fs.writeFileString(
          path.join(keyDir, "right.json"),
          `${CommandAuth.publicKeyRecordJson(right.publicKey)}\n`,
        );

        const loaded = yield* CommandAuth.loadPublicKeyRecords({
          file,
          directory: keyDir,
        });

        expect(loaded).toEqual([left.publicKey, right.publicKey]);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );
});
