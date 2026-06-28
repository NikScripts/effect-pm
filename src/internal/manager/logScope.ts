/**
 * Operator log scope resolution for `pm watch` / `pm logs`.
 *
 * @module internal/manager/logScope
 * @internal
 */

import { Effect, Option } from "effect";
import type { LogEntry } from "../../LogEntry";
import { LogAnnotationKeys } from "../../LogContext";
import {
  normalizeProcessManagerTarget,
  resolveProcessManagerTarget,
  type ProcessManagerTargetCandidate,
} from "./targetResolver";

/**
 * Resolved operator log filter from a single user-entered target string.
 *
 * @internal
 */
export type LogScope =
  | { readonly _tag: "all" }
  | { readonly _tag: "group"; readonly groupId: string }
  | { readonly _tag: "process"; readonly groupId: string; readonly processId: string }
  | { readonly _tag: "queue"; readonly groupId: string; readonly queueId: string };

/** @internal */
export const logScopeGroupId = (scope: LogScope): string | undefined =>
  scope._tag === "all" ? undefined : scope.groupId;

const annotationValue = (
  annotations: Readonly<Record<string, string>>,
  key: string,
): string | undefined => annotations[key];

/** @internal */
export const logEntryMatchesScope = (
  entry: LogEntry,
  scope: LogScope,
): boolean => {
  if (scope._tag === "all") {
    return true;
  }
  const group = annotationValue(entry.annotations, LogAnnotationKeys.groupId);
  if (group !== undefined && group !== scope.groupId) {
    return false;
  }
  if (scope._tag === "group") {
    return group === undefined || group === scope.groupId;
  }
  if (scope._tag === "process") {
    return (
      annotationValue(entry.annotations, LogAnnotationKeys.processId) ===
      scope.processId
    );
  }
  return (
    annotationValue(entry.annotations, LogAnnotationKeys.queueId) === scope.queueId
  );
};

type GroupCatalogEntry = {
  readonly key: string;
};

const resolveGroupFromInput = <G extends GroupCatalogEntry>(
  groups: ReadonlyArray<G>,
  input: string,
): Option.Option<G> => {
  const normalizedInput = normalizeProcessManagerTarget(input);
  const matches = groups.filter((group) => {
    const normalizedId = normalizeProcessManagerTarget(group.key);
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
  candidates: ReadonlyArray<ProcessManagerTargetCandidate>,
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
        const resolution = resolveProcessManagerTarget(value, candidates);
        if (resolution._tag === "Resolved") {
          const { candidate } = resolution;
          if (candidate.kind === "process") {
            return {
              _tag: "process",
              groupId: candidate.groupId,
              processId: candidate.key,
            };
          }
          return {
            _tag: "queue",
            groupId: candidate.groupId,
            queueId: candidate.key,
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
          reason: `No group, process, or queue matched '${value}'`,
        });
      }),
  });
