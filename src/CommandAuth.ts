// @effect-diagnostics nodeBuiltinImport:off — command authentication owns Node key generation and Ed25519 signing.
/**
 * **CommandAuth** — signed command authentication for control-plane messages.
 *
 * @remarks
 * Cut 1 provides the transport-independent core: key records, canonical payload
 * bytes, Ed25519 sign/verify helpers, header formatting, replay tracking, and
 * typed errors. HTTP and ProcessManager wiring are layered on top of this module.
 *
 * @module CommandAuth
 */

import {
  generateKeyPairSync,
  randomBytes,
  sign as cryptoSign,
  verify as cryptoVerify,
} from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import * as NodePath from "node:path";
import { Clock, Context, DateTime, Duration, Effect, Option, Schema } from "effect";
import type { ControlProtocolRequest, ControlProtocolRequestEnvelope } from "./ControlProtocol";
import { responseBodyJson } from "./internal/json";
import { encodeBase64Url, decodeBase64Url } from "./internal/commandAuth/base64url";
import {
  canonicalPayload,
  canonicalPayloadText,
} from "./internal/commandAuth/canonical";
import {
  formatSignatureHeader,
  parseSignatureHeader,
} from "./internal/commandAuth/headers";
import { makeMemoryReplayStore } from "./internal/commandAuth/replay";
import {
  CanonicalPayloadError,
  CommandAuthReplayStoreError,
  ExpiredKey,
  KeyMaterialError,
  MalformedSignatureHeader,
  MissingSignatureHeader,
  ReplayedCommand,
  SignatureVerificationFailed,
  UnknownKeyId,
} from "./internal/commandAuth/errors";

const defaultReplayWindow = Duration.minutes(5);
const commandAuthAlgorithm = "Ed25519";
const commandAuthHeaderVersion = "v1";

export const PublicKeyRecordSchema = Schema.Struct({
  keyId: Schema.String,
  name: Schema.String,
  algorithm: Schema.Literal("Ed25519"),
  publicKeyPem: Schema.String,
  expiresAt: Schema.String,
});

export type PublicKeyRecord = typeof PublicKeyRecordSchema.Type;

export const PrivateKeyRecordSchema = Schema.Struct({
  keyId: Schema.String,
  name: Schema.String,
  algorithm: Schema.Literal("Ed25519"),
  privateKeyPem: Schema.String,
  expiresAt: Schema.String,
});

export type PrivateKeyRecord = typeof PrivateKeyRecordSchema.Type;

export interface GeneratedEd25519KeyPair {
  readonly publicKey: PublicKeyRecord;
  readonly privateKey: PrivateKeyRecord;
}

export interface GenerateEd25519KeyPairOptions {
  readonly name: string;
  readonly expiresAt: string;
  readonly keyId?: string;
}

export interface LoadPublicKeyRecordsOptions {
  readonly inline?: string | ReadonlyArray<string>;
  readonly file?: string;
  readonly files?: ReadonlyArray<string>;
  readonly directory?: string;
  readonly directories?: ReadonlyArray<string>;
}

export type CanonicalCommandAuthRequest =
  | { readonly _tag: "GetHealth" }
  | { readonly _tag: "GetContract" }
  | { readonly _tag: "ReadGroupStatus" }
  | { readonly _tag: "ListProcesses" }
  | { readonly _tag: "ReadProcessStatus"; readonly processId: string }
  | { readonly _tag: "StartProcess"; readonly processId: string }
  | { readonly _tag: "StopProcess"; readonly processId: string }
  | { readonly _tag: "RestartProcess"; readonly processId: string }
  | { readonly _tag: "RunProcessImmediately"; readonly processId: string }
  | { readonly _tag: "ListQueues" }
  | { readonly _tag: "ReadQueueStatus"; readonly queueId: string }
  | { readonly _tag: "StartQueue"; readonly queueId: string }
  | { readonly _tag: "PauseQueue"; readonly queueId: string }
  | { readonly _tag: "ResumeQueue"; readonly queueId: string }
  | { readonly _tag: "ClearQueue"; readonly queueId: string };

export interface CommandAuthSigningInput {
  readonly method: "POST";
  readonly path: "/control";
  readonly envelope: ControlProtocolRequestEnvelope & {
    readonly request: ControlProtocolRequest;
  };
}

export interface CommandAuthSignatureHeader {
  readonly version: "v1";
  readonly algorithm: "Ed25519";
  readonly keyId: string;
  readonly signature: string;
}

export interface CommandAuthReplayStoreReserveInput {
  readonly keyId: string;
  readonly envelopeId: string;
  readonly sentAt: number;
  readonly expiresAt: number;
}

export interface CommandAuthReplayStore {
  readonly window?: Parameters<typeof Duration.fromInputUnsafe>[0];
  readonly reserve: (
    input: CommandAuthReplayStoreReserveInput,
  ) => Effect.Effect<void, ReplayedCommand | CommandAuthReplayStoreError>;
}

export interface CommandAuthSignerService {
  readonly sign: (
    input: CommandAuthSigningInput,
  ) => Effect.Effect<CommandAuthSignatureHeader, CommandAuthError>;
}

export interface CommandAuthVerifyInput {
  readonly header: string | CommandAuthSignatureHeader | undefined;
  readonly input: CommandAuthSigningInput;
  readonly now?: number;
}

export interface CommandAuthVerifierService {
  readonly verify: (
    input: CommandAuthVerifyInput,
  ) => Effect.Effect<void, CommandAuthError>;
}

export type CommandAuthError =
  | MissingSignatureHeader
  | MalformedSignatureHeader
  | UnknownKeyId
  | ExpiredKey
  | SignatureVerificationFailed
  | ReplayedCommand
  | CanonicalPayloadError
  | KeyMaterialError
  | CommandAuthReplayStoreError;

export class CommandAuthSigner extends Context.Service<
  CommandAuthSigner,
  CommandAuthSignerService
>()("@nikscripts/effect-pm/CommandAuth/CommandAuthSigner") {}

export declare namespace CommandAuthSigner {
  export type Type = CommandAuthSignerService;
}

export class CommandAuthVerifier extends Context.Service<
  CommandAuthVerifier,
  CommandAuthVerifierService
>()("@nikscripts/effect-pm/CommandAuth/CommandAuthVerifier") {}

export declare namespace CommandAuthVerifier {
  export type Type = CommandAuthVerifierService;
}

const makeKeyId = (): string => `cmd_${encodeBase64Url(randomBytes(16))}`;

const parseExpirationMillis = (
  keyId: string,
  expiresAt: string,
): Effect.Effect<number, KeyMaterialError> =>
  Option.match(DateTime.make(expiresAt), {
    onNone: () =>
      Effect.fail(
        new KeyMaterialError({
          reason: `Key '${keyId}' has invalid expiresAt '${expiresAt}'`,
        }),
      ),
    onSome: (dateTime) => Effect.succeed(DateTime.toEpochMillis(dateTime)),
  });

const assertNotExpired = (
  key: Pick<PublicKeyRecord, "keyId" | "expiresAt">,
  now: number,
): Effect.Effect<void, ExpiredKey | KeyMaterialError> =>
  parseExpirationMillis(key.keyId, key.expiresAt).pipe(
    Effect.flatMap((expiresAtMillis) =>
      now > expiresAtMillis
        ? Effect.fail(
            new ExpiredKey({
              keyId: key.keyId,
              expiresAt: key.expiresAt,
              reason: `Key '${key.keyId}' expired at ${key.expiresAt}`,
            }),
          )
        : Effect.void
    ),
  );

const assertWithinSkew = (
  keyId: string,
  sentAt: number,
  now: number,
  windowMillis: number,
): Effect.Effect<void, ExpiredKey> =>
  Math.abs(now - sentAt) > windowMillis
    ? Effect.fail(
        new ExpiredKey({
          keyId,
          expiresAt: DateTime.formatIso(DateTime.makeUnsafe(sentAt + windowMillis)),
          reason: `Command envelope timestamp is outside the accepted replay window`,
        }),
      )
    : Effect.void;

export const generateEd25519KeyPair = (
  options: GenerateEd25519KeyPairOptions,
): Effect.Effect<GeneratedEd25519KeyPair, KeyMaterialError> =>
  Effect.try({
    try: () => {
      const keyId = options.keyId ?? makeKeyId();
      const { publicKey, privateKey } = generateKeyPairSync("ed25519");
      const publicKeyPem = publicKey.export({
        type: "spki",
        format: "pem",
      });
      const privateKeyPem = privateKey.export({
        type: "pkcs8",
        format: "pem",
      });
      if (typeof publicKeyPem !== "string" || typeof privateKeyPem !== "string") {
        throw new Error("Generated Ed25519 keys were not PEM strings");
      }
      return {
        publicKey: {
          keyId,
          name: options.name,
          algorithm: commandAuthAlgorithm,
          publicKeyPem,
          expiresAt: options.expiresAt,
        },
        privateKey: {
          keyId,
          name: options.name,
          algorithm: commandAuthAlgorithm,
          privateKeyPem,
          expiresAt: options.expiresAt,
        },
      };
    },
    catch: (error) =>
      new KeyMaterialError({
        reason: `Unable to generate Ed25519 key pair: ${String(error)}`,
      }),
  });

export const ed25519Signer = (
  privateKey: PrivateKeyRecord,
): CommandAuthSignerService => ({
  sign: (input) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      yield* assertNotExpired(privateKey, now);
      const payload = yield* canonicalPayload(input);
      const signature = yield* Effect.try({
        try: () => cryptoSign(null, payload, privateKey.privateKeyPem),
        catch: (error) =>
          new KeyMaterialError({
            reason: `Unable to sign command payload: ${String(error)}`,
          }),
      });
      return {
        version: commandAuthHeaderVersion,
        algorithm: commandAuthAlgorithm,
        keyId: privateKey.keyId,
        signature: encodeBase64Url(signature),
      };
    }),
});

export interface Ed25519VerifierOptions {
  readonly keys: ReadonlyArray<PublicKeyRecord>;
  readonly replay?: CommandAuthReplayStore;
  readonly window?: Parameters<typeof Duration.fromInputUnsafe>[0];
}

export const ed25519Verifier = (
  options: Ed25519VerifierOptions,
): CommandAuthVerifierService => {
  const keys = new Map(options.keys.map((key) => [key.keyId, key]));
  const window = Duration.toMillis(
    Duration.fromInputUnsafe(options.window ?? options.replay?.window ?? defaultReplayWindow),
  );
  const replay = options.replay ?? makeMemoryReplayStore();

  return {
    verify: (input) =>
      Effect.gen(function* () {
        const header = yield* parseSignatureHeader(input.header);
        const key = keys.get(header.keyId);
        if (key === undefined) {
          return yield* new UnknownKeyId({
            keyId: header.keyId,
            reason: `Key '${header.keyId}' is not trusted by this receiver`,
          });
        }

        const now = input.now ?? (yield* Clock.currentTimeMillis);
        yield* assertNotExpired(key, now);
        yield* assertWithinSkew(header.keyId, input.input.envelope.sentAt, now, window);

        const signature = decodeBase64Url(header.signature);
        if (signature === undefined) {
          return yield* new MalformedSignatureHeader({
            reason: "Signature must be base64url encoded",
          });
        }

        const payload = yield* canonicalPayload(input.input);
        const verified = yield* Effect.try({
          try: () => cryptoVerify(null, payload, key.publicKeyPem, signature),
          catch: (error) =>
            new SignatureVerificationFailed({
              keyId: header.keyId,
              reason: `Unable to verify command signature: ${String(error)}`,
            }),
        });
        if (!verified) {
          return yield* new SignatureVerificationFailed({
            keyId: header.keyId,
            reason: `Command signature did not verify for key '${header.keyId}'`,
          });
        }

        yield* replay.reserve({
          keyId: header.keyId,
          envelopeId: input.input.envelope.id,
          sentAt: input.input.envelope.sentAt,
          expiresAt: input.input.envelope.sentAt + window,
        });
      }),
  };
};

export const decodePublicKeyRecordsJson = (
  text: string,
): Effect.Effect<ReadonlyArray<PublicKeyRecord>, KeyMaterialError> =>
  Effect.gen(function* () {
    const parsed = yield* Schema.decodeUnknownEffect(responseBodyJson)(text).pipe(
      Effect.mapError(
        (error) =>
          new KeyMaterialError({
            reason: `Unable to decode command auth public key JSON: ${String(error)}`,
          }),
      ),
    );
    return yield* Schema.decodeUnknownEffect(Schema.Array(PublicKeyRecordSchema))(parsed).pipe(
      Effect.mapError(
        (error) =>
          new KeyMaterialError({
            reason: `Invalid command auth public key records: ${String(error)}`,
          }),
      ),
    );
  });

const escapeJsonString = (value: string): string =>
  value.replace(/[\u0000-\u001f"\\]/g, (character) => {
    switch (character) {
      case "\"":
        return "\\\"";
      case "\\":
        return "\\\\";
      case "\b":
        return "\\b";
      case "\f":
        return "\\f";
      case "\n":
        return "\\n";
      case "\r":
        return "\\r";
      case "\t":
        return "\\t";
      default:
        return `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`;
    }
  });

const jsonString = (value: string): string => `"${escapeJsonString(value)}"`;

export const publicKeyRecordJson = (record: PublicKeyRecord): string =>
  [
    "{",
    `  "keyId": ${jsonString(record.keyId)},`,
    `  "name": ${jsonString(record.name)},`,
    `  "algorithm": ${jsonString(record.algorithm)},`,
    `  "expiresAt": ${jsonString(record.expiresAt)},`,
    `  "publicKeyPem": ${jsonString(record.publicKeyPem)}`,
    "}",
  ].join("\n");

export const publicKeyRecordsJson = (
  records: ReadonlyArray<PublicKeyRecord>,
): string => `[${records.map((record) => `\n${publicKeyRecordJson(record)}`).join(",")}\n]`;

const samePublicKeyRecord = (
  left: PublicKeyRecord,
  right: PublicKeyRecord,
): boolean =>
  left.keyId === right.keyId &&
  left.name === right.name &&
  left.algorithm === right.algorithm &&
  left.expiresAt === right.expiresAt &&
  left.publicKeyPem === right.publicKeyPem;

export const mergePublicKeyRecords = (
  records: ReadonlyArray<PublicKeyRecord>,
): Effect.Effect<ReadonlyArray<PublicKeyRecord>, KeyMaterialError> =>
  Effect.gen(function* () {
    const byKeyId = new Map<string, PublicKeyRecord>();
    for (const record of records) {
      const existing = byKeyId.get(record.keyId);
      if (existing !== undefined && !samePublicKeyRecord(existing, record)) {
        return yield* new KeyMaterialError({
          reason: `Duplicate command auth keyId '${record.keyId}' has different key material`,
        });
      }
      byKeyId.set(record.keyId, record);
    }
    return [...byKeyId.values()].sort((left, right) => left.keyId.localeCompare(right.keyId));
  });

const decodePublicKeyRecordJson = (
  text: string,
): Effect.Effect<ReadonlyArray<PublicKeyRecord>, KeyMaterialError> =>
  decodePublicKeyRecordsJson(text).pipe(
    Effect.catch(() =>
      Effect.gen(function* () {
        const parsed = yield* Schema.decodeUnknownEffect(responseBodyJson)(text).pipe(
          Effect.mapError(
            (error) =>
              new KeyMaterialError({
                reason: `Unable to decode command auth public key JSON: ${String(error)}`,
              }),
          ),
        );
        const record = yield* Schema.decodeUnknownEffect(PublicKeyRecordSchema)(parsed).pipe(
          Effect.mapError(
            (error) =>
              new KeyMaterialError({
                reason: `Invalid command auth public key record: ${String(error)}`,
              }),
          ),
        );
        return [record];
      })
    ),
  );

const readPublicKeyRecordFile = (
  path: string,
): Effect.Effect<ReadonlyArray<PublicKeyRecord>, KeyMaterialError> =>
  Effect.try({
    try: () => readFileSync(path, "utf8"),
    catch: (error) =>
      new KeyMaterialError({
        reason: `Unable to read command auth keyring file '${path}': ${String(error)}`,
      }),
  }).pipe(Effect.flatMap(decodePublicKeyRecordJson));

const publicKeyRecordFilesInDirectory = (
  directory: string,
): Effect.Effect<ReadonlyArray<string>, KeyMaterialError> =>
  Effect.try({
    try: () => {
      if (!existsSync(directory)) {
        return [];
      }
      return readdirSync(directory)
        .map((entry) => NodePath.join(directory, entry))
        .filter((entryPath) => statSync(entryPath).isFile() && entryPath.endsWith(".json"))
        .sort();
    },
    catch: (error) =>
      new KeyMaterialError({
        reason: `Unable to read command auth keyring directory '${directory}': ${String(error)}`,
      }),
  });

export const loadPublicKeyRecords = (
  options: LoadPublicKeyRecordsOptions,
): Effect.Effect<ReadonlyArray<PublicKeyRecord>, KeyMaterialError> =>
  Effect.gen(function* () {
    const inline = typeof options.inline === "string"
      ? [options.inline]
      : options.inline ?? [];
    const files = [
      ...(options.file === undefined ? [] : [options.file]),
      ...(options.files ?? []),
    ];
    const directories = [
      ...(options.directory === undefined ? [] : [options.directory]),
      ...(options.directories ?? []),
    ];
    const decoded: PublicKeyRecord[] = [];
    for (const text of inline) {
      decoded.push(...yield* decodePublicKeyRecordJson(text));
    }
    for (const file of files) {
      decoded.push(...yield* readPublicKeyRecordFile(file));
    }
    for (const directory of directories) {
      const directoryFiles = yield* publicKeyRecordFilesInDirectory(directory);
      for (const file of directoryFiles) {
        decoded.push(...yield* readPublicKeyRecordFile(file));
      }
    }
    return yield* mergePublicKeyRecords(decoded);
  });

export const commandAuthErrorMessage = (error: CommandAuthError): string =>
  error.reason;

interface CommandAuthApi {
  readonly generateEd25519KeyPair: typeof generateEd25519KeyPair;
  readonly ed25519Signer: typeof ed25519Signer;
  readonly ed25519Verifier: typeof ed25519Verifier;
  readonly canonicalPayload: typeof canonicalPayload;
  readonly canonicalPayloadText: typeof canonicalPayloadText;
  readonly decodePublicKeyRecordsJson: typeof decodePublicKeyRecordsJson;
  readonly loadPublicKeyRecords: typeof loadPublicKeyRecords;
  readonly publicKeyRecordJson: typeof publicKeyRecordJson;
  readonly publicKeyRecordsJson: typeof publicKeyRecordsJson;
  readonly mergePublicKeyRecords: typeof mergePublicKeyRecords;
  readonly formatSignatureHeader: typeof formatSignatureHeader;
  readonly parseSignatureHeader: typeof parseSignatureHeader;
  readonly Replay: {
    readonly memory: typeof makeMemoryReplayStore;
  };
  readonly Schema: {
    readonly PublicKeyRecord: typeof PublicKeyRecordSchema;
    readonly PrivateKeyRecord: typeof PrivateKeyRecordSchema;
  };
  readonly Errors: {
    readonly MissingSignatureHeader: typeof MissingSignatureHeader;
    readonly MalformedSignatureHeader: typeof MalformedSignatureHeader;
    readonly UnknownKeyId: typeof UnknownKeyId;
    readonly ExpiredKey: typeof ExpiredKey;
    readonly SignatureVerificationFailed: typeof SignatureVerificationFailed;
    readonly ReplayedCommand: typeof ReplayedCommand;
    readonly CanonicalPayloadError: typeof CanonicalPayloadError;
    readonly KeyMaterialError: typeof KeyMaterialError;
    readonly CommandAuthReplayStoreError: typeof CommandAuthReplayStoreError;
  };
  readonly errorMessage: typeof commandAuthErrorMessage;
}

export const CommandAuth: CommandAuthApi = {
  generateEd25519KeyPair,
  ed25519Signer,
  ed25519Verifier,
  canonicalPayload,
  canonicalPayloadText,
  decodePublicKeyRecordsJson,
  loadPublicKeyRecords,
  publicKeyRecordJson,
  publicKeyRecordsJson,
  mergePublicKeyRecords,
  formatSignatureHeader,
  parseSignatureHeader,
  Replay: {
    memory: makeMemoryReplayStore,
  },
  Schema: {
    PublicKeyRecord: PublicKeyRecordSchema,
    PrivateKeyRecord: PrivateKeyRecordSchema,
  },
  Errors: {
    MissingSignatureHeader,
    MalformedSignatureHeader,
    UnknownKeyId,
    ExpiredKey,
    SignatureVerificationFailed,
    ReplayedCommand,
    CanonicalPayloadError,
    KeyMaterialError,
    CommandAuthReplayStoreError,
  },
  errorMessage: commandAuthErrorMessage,
};

export {
  canonicalPayload,
  canonicalPayloadText,
  formatSignatureHeader,
  parseSignatureHeader,
  MissingSignatureHeader,
  MalformedSignatureHeader,
  UnknownKeyId,
  ExpiredKey,
  SignatureVerificationFailed,
  ReplayedCommand,
  CanonicalPayloadError,
  KeyMaterialError,
  CommandAuthReplayStoreError,
};
