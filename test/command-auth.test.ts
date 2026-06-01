import { describe, expect, it } from "@effect/vitest";
import { DateTime, Duration, Effect } from "effect";
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
});
