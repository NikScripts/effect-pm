/**
 * Groups sessions by repo -> worktree, matched against a real repoScan.ts
 * result. Ported verbatim from packages/agent-console/src/opencode/
 * repoGrouping.ts — 100% pure logic (no platform dependency at all), a
 * direct candidate for a shared package once this proves out here.
 *
 * @internal
 */
import type { Session } from "@opencode-ai/sdk";
import type { ScannedRepo } from "./repoScan";

export type RepoWorktree = {
  readonly repo: string;
  readonly worktree: string;
};

export const MAIN_WORKTREE = "(main)";
export const NO_WORKTREE = "(no worktree)";

export const displayWorktree = (worktree: string): string | undefined =>
  worktree === MAIN_WORKTREE || worktree === NO_WORKTREE ? undefined : worktree;

const basename = (path: string): string => {
  const segments = path.split("/").filter((s) => s.length > 0);
  return segments[segments.length - 1] ?? path;
};

const isUnder = (directory: string, worktreePath: string): boolean =>
  directory === worktreePath || directory.startsWith(`${worktreePath}/`);

export const matchSession = (
  directory: string,
  scanned: ReadonlyArray<ScannedRepo>,
): RepoWorktree => {
  let best: { readonly repo: string; readonly worktree: string; readonly pathLength: number } | undefined;
  for (const repo of scanned) {
    for (const wt of repo.worktrees) {
      if (!isUnder(directory, wt.path)) continue;
      if (best === undefined || wt.path.length > best.pathLength) {
        best = { repo: repo.repo, worktree: wt.isMain ? MAIN_WORKTREE : wt.name, pathLength: wt.path.length };
      }
    }
  }
  if (best !== undefined) return { repo: best.repo, worktree: best.worktree };
  return { repo: basename(directory), worktree: NO_WORKTREE };
};

export type RepoGroup = {
  readonly repo: string;
  readonly sessions: ReadonlyArray<Session>;
  readonly worktrees: ReadonlyMap<string, ReadonlyArray<Session>>;
  readonly mostRecentUpdate: number;
  readonly isKnownRepo: boolean;
};

export const groupByRepo = (
  sessions: ReadonlyArray<Session>,
  scanned: ReadonlyArray<ScannedRepo>,
): ReadonlyArray<RepoGroup> => {
  const byRepo = new Map<string, Session[]>();
  for (const session of sessions) {
    const { repo } = matchSession(session.directory, scanned);
    const list = byRepo.get(repo);
    if (list === undefined) byRepo.set(repo, [session]);
    else list.push(session);
  }

  const groups: Array<RepoGroup> = [];
  for (const [repo, repoSessions] of byRepo) {
    const sorted = [...repoSessions].sort((a, b) => b.time.updated - a.time.updated);
    const byWorktree = new Map<string, Session[]>();
    for (const session of sorted) {
      const { worktree } = matchSession(session.directory, scanned);
      const list = byWorktree.get(worktree);
      if (list === undefined) byWorktree.set(worktree, [session]);
      else list.push(session);
    }
    groups.push({
      repo,
      sessions: sorted,
      worktrees: byWorktree,
      mostRecentUpdate: sorted[0]?.time.updated ?? 0,
      isKnownRepo: scanned.some((r) => r.repo === repo),
    });
  }

  return groups.sort((a, b) => b.mostRecentUpdate - a.mostRecentUpdate);
};
