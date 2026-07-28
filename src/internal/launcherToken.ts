/**
 * @module internal/launcherToken
 *
 * Opaque assume-token mint — Effect-wrapped CSPRNG (`globalThis.crypto.getRandomValues`),
 * never cleartext in logs ({@link Redacted}). Isolates the Web Crypto primitive behind an
 * Effect boundary (no raw `crypto.randomUUID` in app/Launcher call sites).
 */
import { Effect, Redacted } from "effect";

/** Bytes minted into a hex assume token. @internal */
export const LAUNCHER_TOKEN_BYTES = 32;

/**
 * Fill `byteLength` cryptographically strong random bytes via Web Crypto.
 * @internal
 */
export const randomTokenBytes = (
  byteLength: number,
): Effect.Effect<Uint8Array> =>
  Effect.sync(() => {
    const bytes = new Uint8Array(byteLength);
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  });

/**
 * Mint an opaque high-entropy assume token (hex) wrapped in {@link Redacted}.
 * @internal
 */
export const mintAssumeToken: Effect.Effect<Redacted.Redacted<string>> =
  Effect.gen(function* () {
    const bytes = yield* randomTokenBytes(LAUNCHER_TOKEN_BYTES);
    let hex = "";
    for (let i = 0; i < bytes.length; i++) {
      hex += bytes[i]!.toString(16).padStart(2, "0");
    }
    return Redacted.make(hex);
  });
