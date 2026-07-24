/**
 * @module cli/Tui
 *
 * Optional TUI launcher service for {@link cli}. Implemented by `hyperlink-ts/tui`'s `layer`.
 */
import { Context, Data, Effect, Option } from "effect";
import type { CliTree } from "./types";

/** Input for {@link Tui.open}: the same Group (or record) the CLI was built from, plus the
 *  member-key path to focus (`[]` = root grid, `["Mail"]` = Mail detail). */
export type TuiOpenInput = {
  readonly tree: CliTree;
  readonly path: ReadonlyArray<string>;
};

/**
 * Optional TUI launcher. Provide via `hyperlink-ts/tui`'s `layer`. Missing →
 * {@link TuiNotConfigured} when a path has no CLI action.
 *
 * @public
 */
export class Tui extends Context.Service<
  Tui,
  {
    readonly open: (input: TuiOpenInput) => Effect.Effect<void>;
  }
>()("hyperlink-ts/cli/Tui") {}

/**
 * Bare path (no action) was used but no {@link Tui} service is in context.
 *
 * @public
 */
export class TuiNotConfigured extends Data.TaggedError("TuiNotConfigured")<{
  readonly path: ReadonlyArray<string>;
  readonly message: string;
}> {}

/**
 * Open the TUI for `input.tree` focused at `input.path`, or fail {@link TuiNotConfigured}
 * when the service is absent.
 *
 * @public
 */
export const openTui = (
  input: TuiOpenInput,
): Effect.Effect<void, TuiNotConfigured> =>
  Effect.serviceOption(Tui).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => {
          const where =
            input.path.length === 0 ? "at the root" : `at \`${input.path.join(" ")}\``;
          return Effect.fail(
            new TuiNotConfigured({
              path: input.path,
              message:
                `No command/action ${where}, and the TUI is not configured. ` +
                `Pass a full command (e.g. \`<resource> <action>\`), or provide ` +
                `\`layer\` from \`hyperlink-ts/tui\`.`,
            }),
          );
        },
        onSome: (tui) => tui.open(input),
      }),
    ),
  );
