/**
 * Pure target resolution helpers for multi-group ProcessManager CLI commands.
 *
 * @internal
 */

export interface ProcessManagerTargetCandidate {
  readonly id: string;
  readonly kind: "process" | "queue";
  readonly groupId: string;
}

export interface ResolvedProcessManagerTarget {
  readonly _tag: "Resolved";
  readonly input: string;
  readonly normalizedInput: string;
  readonly candidate: ProcessManagerTargetCandidate;
}

export interface AmbiguousProcessManagerTarget {
  readonly _tag: "Ambiguous";
  readonly input: string;
  readonly normalizedInput: string;
  readonly candidates: ReadonlyArray<{
    readonly candidate: ProcessManagerTargetCandidate;
    readonly minimumSuffix: string;
    readonly unique: boolean;
  }>;
}

export interface MissingProcessManagerTarget {
  readonly _tag: "Missing";
  readonly input: string;
  readonly normalizedInput: string;
}

export type ProcessManagerTargetResolution =
  | ResolvedProcessManagerTarget
  | AmbiguousProcessManagerTarget
  | MissingProcessManagerTarget;

const splitSegments = (id: string): ReadonlyArray<string> =>
  id.split("/").filter((segment) => segment.length > 0);

const normalizeSegment = (segment: string): string =>
  segment
    .trim()
    .replace(/^@/, "")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const normalizeProcessManagerTarget = (input: string): string =>
  splitSegments(input)
    .map(normalizeSegment)
    .filter((segment) => segment.length > 0)
    .join("/");

const isSuffixMatch = (candidate: string, input: string): boolean =>
  candidate === input || candidate.endsWith(`/${input}`);

const suffixOf = (
  normalizedId: string,
  segmentCount: number,
): string => {
  const segments = splitSegments(normalizedId);
  return segments.slice(Math.max(0, segments.length - segmentCount)).join("/");
};

const shortestUniqueSuffix = (
  normalizedId: string,
  allNormalizedIds: ReadonlyArray<string>,
): { readonly minimumSuffix: string; readonly unique: boolean } => {
  const segments = splitSegments(normalizedId);
  for (let length = 1; length <= segments.length; length++) {
    const suffix = suffixOf(normalizedId, length);
    const matches = allNormalizedIds.filter((candidate) =>
      isSuffixMatch(candidate, suffix)
    );
    if (matches.length === 1) {
      return { minimumSuffix: suffix, unique: true };
    }
  }
  return { minimumSuffix: normalizedId, unique: false };
};

export const resolveProcessManagerTarget = (
  input: string,
  candidates: ReadonlyArray<ProcessManagerTargetCandidate>,
): ProcessManagerTargetResolution => {
  const normalizedInput = normalizeProcessManagerTarget(input);
  const indexed = candidates.map((candidate) => ({
    candidate,
    normalizedId: normalizeProcessManagerTarget(candidate.id),
  }));
  const matches = indexed.filter(({ normalizedId }) =>
    isSuffixMatch(normalizedId, normalizedInput)
  );

  if (matches.length === 0) {
    return {
      _tag: "Missing",
      input,
      normalizedInput,
    };
  }

  if (matches.length === 1) {
    const match = matches[0];
    if (match === undefined) {
      return {
        _tag: "Missing",
        input,
        normalizedInput,
      };
    }
    return {
      _tag: "Resolved",
      input,
      normalizedInput,
      candidate: match.candidate,
    };
  }

  const allNormalizedIds = indexed.map(({ normalizedId }) => normalizedId);
  return {
    _tag: "Ambiguous",
    input,
    normalizedInput,
    candidates: matches.map(({ candidate, normalizedId }) => ({
      candidate,
      ...shortestUniqueSuffix(normalizedId, allNormalizedIds),
    })),
  };
};
