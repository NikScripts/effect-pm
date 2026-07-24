/**
 * @module cli/types
 *
 * Shared CLI tree / tag shapes (kept free of Effect CLI so {@link Tui} can import them).
 */
import type { Effect } from "effect";
import { specOf } from "../Hyperlink";

/**
 * The structural shape the CLI reads from a resource tag: yieldable (→ its service), with
 * `key` / `description` and the stowed contract spec. A `Hyperlink.Tag` / `WorkPool.Tag`
 * / `Daemon.Tag` class satisfies this — pass the classes directly.
 *
 * @public
 */
export type CliHyperlinkTag = Effect.Effect<unknown, never, unknown> & {
  readonly key: string;
  readonly description: string | undefined;
} & Parameters<typeof specOf>[0];

/**
 * A tree node: a leaf resource tag, or a group (named members, possibly nested).
 *
 * @public
 */
export type CliNode = CliHyperlinkTag | CliGroup;

/**
 * A group-shaped node (`Group.Tag` or any `{ key, members }` record).
 *
 * @public
 */
export type CliGroup = {
  readonly key: string;
  readonly members: Record<string, CliNode>;
};

/**
 * What {@link cli} accepts: a `Group.Tag`, or a flat/nested `{ commandName: node }` record.
 *
 * @public
 */
export type CliTree = CliGroup | Record<string, CliNode>;
