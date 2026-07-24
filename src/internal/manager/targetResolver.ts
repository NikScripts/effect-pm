/**
 * Pure target resolution helpers for multi-group DaemonManager CLI commands.
 *
 * The CLI keeps canonical ids Effect-style and case-preserving, but users can
 * type normalized suffixes such as `north-west/billing-group/sync-invoices`.
 * This module owns that user-facing normalization without weakening the ids
 * stored in contracts.
 *
 * @internal
 */

/** Candidate command target from a fetched group contract. */
export interface DaemonManagerTargetCandidate {
  readonly key: string;
  readonly kind: string;
  readonly groupId: string;
  readonly controls: ReadonlyArray<string>;
}

/** Exactly one process or queue matched the user's input. */
export interface ResolvedDaemonManagerTarget {
  readonly _tag: "Resolved";
  readonly input: string;
  readonly normalizedInput: string;
  readonly candidate: DaemonManagerTargetCandidate;
}

/** More than one process or queue matched the user's input. */
export interface AmbiguousDaemonManagerTarget {
  readonly _tag: "Ambiguous";
  readonly input: string;
  readonly normalizedInput: string;
  readonly candidates: ReadonlyArray<{
    readonly candidate: DaemonManagerTargetCandidate;
    readonly minimumSuffix: string;
    readonly unique: boolean;
  }>;
}

/** No process or queue matched the user's input. */
export interface MissingDaemonManagerTarget {
  readonly _tag: "Missing";
  readonly input: string;
  readonly normalizedInput: string;
}

export type DaemonManagerTargetResolution =
  | ResolvedDaemonManagerTarget
  | AmbiguousDaemonManagerTarget
  | MissingDaemonManagerTarget;

const splitSegments = (id: string): ReadonlyArray<string> =>
  id.split("/").filter((segment) => segment.length > 0);

// Normalize one path segment for typing convenience:
// `SyncInvoices`, `sync_invoices`, and `sync invoices` all become
// `sync-invoices`.
const normalizeSegment = (segment: string): string =>
  segment
    .trim()
    .replace(/^@/, "")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Normalize a full process/queue key or user-entered alias. */
export const normalizeDaemonManagerTarget = (input: string): string =>
  splitSegments(input)
    .map(normalizeSegment)
    .filter((segment) => segment.length > 0)
    .join("/");

const isSuffixMatch = (candidate: string, input: string): boolean =>
  candidate === input || candidate.endsWith(`/${input}`);

// Return the last N path segments of a normalized id.
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
  // Walk from shortest to longest suffix so ambiguity diagnostics can show the
  // minimum users must type to select this candidate.
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

/**
 * Resolve one user-entered target against process and queue candidates.
 */
export const resolveDaemonManagerTarget = (
  input: string,
  candidates: ReadonlyArray<DaemonManagerTargetCandidate>,
): DaemonManagerTargetResolution => {
  const normalizedInput = normalizeDaemonManagerTarget(input);
  const indexed = candidates.map((candidate) => ({
    candidate,
    normalizedId: normalizeDaemonManagerTarget(candidate.key),
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
