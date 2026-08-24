/**
 * @module internal/launcherToken
 *
 * Opaque assume-token mint — Effect-wrapped CSPRNG (`globalThis.crypto.getRandomValues`)
 * + {@link Encoding.encodeHex}, branded as {@link Token}, never cleartext in logs
 * ({@link Redacted}). Isolates the Web Crypto primitive behind an Effect boundary
 * (Effect's `Random` is seeded PRNG, not CSPRNG).
 */
import { Effect, Encoding, Redacted } from "effect";

/** Bytes minted into a hex assume token. @internal */
export const LAUNCHER_TOKEN_BYTES = 32;

declare const LauncherTokenBrand: unique symbol;

/**
 * Opaque assume-token brand (thin sugar over a redacted hex string).
 *
 * @category models
 * @public
 */
export type Token = string & { readonly [LauncherTokenBrand]: unique symbol };

/** Brand a cleartext hex string as {@link Token}. @internal */
export const brandToken = (clear: string): Token => clear as Token;

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
 * Mint an opaque high-entropy assume token (hex), brand as {@link Token}, wrap in {@link Redacted}.
 * @internal
 */
export const mintAssumeToken: Effect.Effect<Redacted.Redacted<Token>> =
  randomTokenBytes(LAUNCHER_TOKEN_BYTES).pipe(
    Effect.map((bytes) =>
      Redacted.make(brandToken(Encoding.encodeHex(bytes))),
    ),
  );
