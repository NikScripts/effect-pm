/**
 * Assert an {@link Exit} failed with a tagged error (`_tag`), not a message string.
 * Accepts `Exit<*, unknown>` so Layer builds whose `E` was erased still work.
 */
import { Cause, Exit, Option } from "effect";
import { expect } from "vitest";

const isTagged = (
  value: unknown,
  tag: string,
): value is { readonly _tag: string } =>
  typeof value === "object" &&
  value !== null &&
  "_tag" in value &&
  value._tag === tag;

export const expectTaggedFailure = (
  exit: Exit.Exit<unknown, unknown>,
  tag: string,
): { readonly _tag: string } => {
  expect(Exit.isFailure(exit)).toBe(true);
  if (!Exit.isFailure(exit)) {
    throw new Error("expected Failure exit");
  }
  const err = Option.getOrThrow(Cause.findErrorOption(exit.cause));
  expect(isTagged(err, tag)).toBe(true);
  if (!isTagged(err, tag)) {
    throw new Error(`expected tagged failure ${tag}`);
  }
  return err;
};
