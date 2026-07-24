/**
 * Operator log scope resolution for `hyperlink watch` / `hyperlink logs`.
 *
 * @module internal/manager/logScope
 * @internal
 */

import { Effect, Option } from "effect";
import { kind as daemonKind } from "../../Daemon";
import { kind as workPoolKind } from "../../WorkPool";
import type { LogEntry } from "../../LogEntry";
import * as LogEntryModule from "../../LogEntry";
import {
  normalizeDaemonManagerTarget,
  resolveDaemonManagerTarget,
  type DaemonManagerTargetCandidate,
} from "./targetResolver";

/**
 * Resolved operator log filter from a single user-entered target string.
 *
 * Hyperlink scopes carry the registration **key** (same as `Tag.key`). Kind is in `_tag`
 * (`hyperlink-ts/Daemon` | `hyperlink-ts/WorkPool`); RPC wire prefix stays `groupId`.
 *
 * @internal
 */
export type LogScope =
  | { readonly _tag: "all" }
  | { readonly _tag: "group"; readonly groupId: string }
  | { readonly _tag: typeof daemonKind; readonly groupId: string; readonly key: string }
  | { readonly _tag: typeof workPoolKind; readonly groupId: string; readonly key: string };

/** @internal */
export const logScopeGroupId = (scope: LogScope): string | undefined =>
  scope._tag === "all" ? undefined : scope.groupId;

/** @internal */
export const logEntryMatchesScope = (
  entry: LogEntry,
  scope: LogScope,
): boolean => {
  if (scope._tag === "all") {
    return true;
  }
  // "group" is legacy CLI scoping (groups were removed) — no per-entry group annotation remains, so it
  // matches every line. Hyperlink scopes filter by lineage key.
  if (scope._tag === "group") {
    return true;
  }
  return LogEntryModule.hasKey(scope.key)(entry);
};

type GroupCatalogEntry = {
  readonly key: string;
};

const resolveGroupFromInput = <G extends GroupCatalogEntry>(
  groups: ReadonlyArray<G>,
  input: string,
): Option.Option<G> => {
  const normalizedInput = normalizeDaemonManagerTarget(input);
  const matches = groups.filter((group) => {
    const normalizedId = normalizeDaemonManagerTarget(group.key);
    return (
      normalizedId === normalizedInput || normalizedId.endsWith(`/${normalizedInput}`)
    );
  });
  if (matches.length === 1) {
    return Option.some(matches[0]!);
  }
  return Option.none();
};

/** @internal */
export const resolveLogScope = <G extends GroupCatalogEntry>(
  groups: ReadonlyArray<G>,
  input: Option.Option<string>,
  candidates: ReadonlyArray<DaemonManagerTargetCandidate>,
): Effect.Effect<
  LogScope,
  { readonly reason: string }
> =>
  Option.match(input, {
    onNone: () => Effect.succeed({ _tag: "all" }),
    onSome: (value) =>
      Effect.gen(function* () {
        const asGroup = resolveGroupFromInput(groups, value);
        if (Option.isSome(asGroup)) {
          return { _tag: "group", groupId: asGroup.value.key };
        }
        const resolution = resolveDaemonManagerTarget(value, candidates);
        if (resolution._tag === "Resolved") {
          const { candidate } = resolution;
          if (candidate.kind === daemonKind) {
            return {
              _tag: daemonKind,
              groupId: candidate.groupId,
              key: candidate.key,
            };
          }
          return {
            _tag: workPoolKind,
            groupId: candidate.groupId,
            key: candidate.key,
          };
        }
        if (resolution._tag === "Ambiguous") {
          const rows = resolution.candidates
            .map(
              ({ candidate, minimumSuffix }) =>
                `${candidate.kind}\t[${minimumSuffix}]\t${candidate.key}`,
            )
            .join("\n");
          return yield* Effect.fail({
            reason: `Ambiguous log target '${value}':\n${rows}`,
          });
        }
        return yield* Effect.fail({
          reason: `No group, daemon, or queue matched '${value}'`,
        });
      }),
  });
