import { Context, Effect, Layer, Option } from "effect";
import type { ProcessManagerLogEntry } from "./processManagerLogEntry.js";
import {
  normalizeProcessManagerTarget,
  resolveProcessManagerTarget,
  type ProcessManagerTargetCandidate,
} from "./ProcessManagerTargetResolver.js";

/**
 * Standard log annotation keys for effect-pm (captured into {@link ProcessManagerLogEntry}).
 *
 * @public
 */
export const ProcessManagerLogAnnotationKeys = {
  groupId: "groupId",
  processId: "processId",
  queueId: "queueId",
} as const;

/**
 * Resolved operator log filter from a single user-entered target string.
 *
 * @public
 */
export type ProcessManagerLogScope =
  | { readonly _tag: "all" }
  | { readonly _tag: "group"; readonly groupId: string }
  | { readonly _tag: "process"; readonly groupId: string; readonly processId: string }
  | { readonly _tag: "queue"; readonly groupId: string; readonly queueId: string };

/**
 * Group id for the child control plane when watching live logs.
 *
 * @public
 */
export const logScopeGroupId = (scope: ProcessManagerLogScope): string | undefined =>
  scope._tag === "all" ? undefined : scope.groupId;

/**
 * @public
 */
export class ProcessGroupLogContext extends Context.Service<
  ProcessGroupLogContext,
  { readonly groupId: string }
>()("@nikscripts/effect-pm/processGroupLogContext") {}

/**
 * Scoped {@link Effect.annotateLogsScoped} for every fiber under a group runtime.
 *
 * @public
 */
export const layerProcessGroupLogContext = (
  groupId: string,
): Layer.Layer<ProcessGroupLogContext> =>
  Layer.effect(
    ProcessGroupLogContext,
    Effect.gen(function* () {
      yield* Effect.annotateLogsScoped({
        [ProcessManagerLogAnnotationKeys.groupId]: groupId,
      });
      return { groupId };
    }),
  );

/**
 * Annotate logs emitted from a process supervisor fiber.
 *
 * @public
 */
export const withProcessLogAnnotations = <A, E, R>(
  processId: string,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.annotateLogs(effect, {
    [ProcessManagerLogAnnotationKeys.processId]: processId,
  });

/**
 * Annotate logs emitted from a queue worker fiber.
 *
 * @public
 */
export const withQueueLogAnnotations = <A, E, R>(
  queueId: string,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.annotateLogs(effect, {
    [ProcessManagerLogAnnotationKeys.queueId]: queueId,
  });

const annotationValue = (
  annotations: Readonly<Record<string, string>>,
  key: string,
): string | undefined => annotations[key];

/**
 * Returns true when a captured entry should be shown for the resolved scope.
 *
 * @public
 */
export const logEntryMatchesScope = (
  entry: ProcessManagerLogEntry,
  scope: ProcessManagerLogScope,
): boolean => {
  if (scope._tag === "all") {
    return true;
  }
  const group = annotationValue(entry.annotations, ProcessManagerLogAnnotationKeys.groupId);
  if (group !== undefined && group !== scope.groupId) {
    return false;
  }
  if (scope._tag === "group") {
    return group === undefined || group === scope.groupId;
  }
  if (scope._tag === "process") {
    return (
      annotationValue(entry.annotations, ProcessManagerLogAnnotationKeys.processId) ===
      scope.processId
    );
  }
  return (
    annotationValue(entry.annotations, ProcessManagerLogAnnotationKeys.queueId) === scope.queueId
  );
};

type GroupCatalogEntry = {
  readonly id: string;
};

const resolveGroupFromInput = <G extends GroupCatalogEntry>(
  groups: ReadonlyArray<G>,
  input: string,
): Option.Option<G> => {
  const normalizedInput = normalizeProcessManagerTarget(input);
  const matches = groups.filter((group) => {
    const normalizedId = normalizeProcessManagerTarget(group.id);
    return (
      normalizedId === normalizedInput || normalizedId.endsWith(`/${normalizedInput}`)
    );
  });
  if (matches.length === 1) {
    return Option.some(matches[0]!);
  }
  return Option.none();
};

/**
 * Resolve a user target string to a log scope (group, process, or queue).
 *
 * @public
 */
export const resolveLogScope = <G extends GroupCatalogEntry>(
  groups: ReadonlyArray<G>,
  input: Option.Option<string>,
  candidates: ReadonlyArray<ProcessManagerTargetCandidate>,
): Effect.Effect<
  ProcessManagerLogScope,
  { readonly reason: string }
> =>
  Option.match(input, {
    onNone: () => Effect.succeed({ _tag: "all" }),
    onSome: (value) =>
      Effect.gen(function* () {
        const asGroup = resolveGroupFromInput(groups, value);
        if (Option.isSome(asGroup)) {
          return { _tag: "group", groupId: asGroup.value.id };
        }
        const resolution = resolveProcessManagerTarget(value, candidates);
        if (resolution._tag === "Resolved") {
          const { candidate } = resolution;
          if (candidate.kind === "process") {
            return {
              _tag: "process",
              groupId: candidate.groupId,
              processId: candidate.id,
            };
          }
          return {
            _tag: "queue",
            groupId: candidate.groupId,
            queueId: candidate.id,
          };
        }
        if (resolution._tag === "Ambiguous") {
          const rows = resolution.candidates
            .map(
              ({ candidate, minimumSuffix }) =>
                `${candidate.kind}\t[${minimumSuffix}]\t${candidate.id}`,
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
