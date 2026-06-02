import { Effect } from "effect";
import type { CommandAuthSignatureHeader } from "../../CommandAuth";
import { MalformedSignatureHeader, MissingSignatureHeader } from "./errors";

const headerPrefix = "v1";

export const formatSignatureHeader = (
  header: CommandAuthSignatureHeader,
): string =>
  `${header.version}; alg=${header.algorithm}; keyId=${header.keyId}; signature=${header.signature}`;

const parsePart = (part: string): readonly [string, string] | undefined => {
  const index = part.indexOf("=");
  if (index <= 0) {
    return undefined;
  }
  const key = part.slice(0, index).trim();
  const value = part.slice(index + 1).trim();
  return key.length === 0 || value.length === 0 ? undefined : [key, value];
};

export const parseSignatureHeader = (
  header: string | CommandAuthSignatureHeader | undefined,
): Effect.Effect<
  CommandAuthSignatureHeader,
  MissingSignatureHeader | MalformedSignatureHeader
> => {
  if (header === undefined) {
    return Effect.fail(
      new MissingSignatureHeader({ reason: "Missing Effect-PM-Signature header" }),
    );
  }
  if (typeof header !== "string") {
    return Effect.succeed(header);
  }

  const [version, ...parts] = header.split(";").map((part) => part.trim());
  if (version !== headerPrefix) {
    return Effect.fail(
      new MalformedSignatureHeader({
        reason: "Signature header must start with v1",
      }),
    );
  }

  const parsed = new Map<string, string>();
  for (const part of parts) {
    const pair = parsePart(part);
    if (pair === undefined) {
      return Effect.fail(
        new MalformedSignatureHeader({
          reason: `Malformed signature header part '${part}'`,
        }),
      );
    }
    parsed.set(pair[0], pair[1]);
  }

  const algorithm = parsed.get("alg");
  const keyId = parsed.get("keyId");
  const signature = parsed.get("signature");
  if (algorithm !== "Ed25519" || keyId === undefined || signature === undefined) {
    return Effect.fail(
      new MalformedSignatureHeader({
        reason: "Signature header requires alg=Ed25519, keyId, and signature",
      }),
    );
  }

  return Effect.succeed({
    version: "v1",
    algorithm,
    keyId,
    signature,
  });
};
