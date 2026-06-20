import { Data } from "effect";

export class MissingSignatureHeader extends Data.TaggedError(
  "MissingSignatureHeader",
)<{
  readonly reason: string;
}> {}

export class MalformedSignatureHeader extends Data.TaggedError(
  "MalformedSignatureHeader",
)<{
  readonly reason: string;
}> {}

export class UnknownKeyId extends Data.TaggedError("UnknownKeyId")<{
  readonly keyId: string;
  readonly reason: string;
}> {}

export class ExpiredKey extends Data.TaggedError("ExpiredKey")<{
  readonly keyId: string;
  readonly expiresAt: string;
  readonly reason: string;
}> {}

export class SignatureVerificationFailed extends Data.TaggedError(
  "SignatureVerificationFailed",
)<{
  readonly keyId: string;
  readonly reason: string;
}> {}

export class ReplayedCommand extends Data.TaggedError("ReplayedCommand")<{
  readonly keyId: string;
  readonly envelopeId: string;
  readonly reason: string;
}> {}

export class CanonicalPayloadError extends Data.TaggedError(
  "CanonicalPayloadError",
)<{
  readonly reason: string;
}> {}

export class KeyMaterialError extends Data.TaggedError("KeyMaterialError")<{
  readonly reason: string;
}> {}

export class CommandAuthReplayStoreError extends Data.TaggedError(
  "CommandAuthReplayStoreError",
)<{
  readonly reason: string;
}> {}
