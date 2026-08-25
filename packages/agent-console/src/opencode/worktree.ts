/**
 * Worktree creation — runs `git worktree add` via a short-lived session
 * under the "repo-admin" agent profile (opencode.jsonc), whose bash
 * permission is scoped to `git worktree*` only (not the general "console"
 * agent, which denies bash entirely).
 *
 * The setup session is titled with the `WORKTREE_SETUP_PREFIX` so session
 * lists (Home, RepoSessions) can filter it out — it's a background
 * operation, not something the owner should see mixed into their chats.
 *
 * @internal
 */
import { client } from "./client";
import { resolveWorktreePath } from "./settings";

export const WORKTREE_SETUP_PREFIX = "[worktree-setup]";

export const REPO_ADMIN_AGENT = "repo-admin";

export class WorktreeCreateError extends Error {}

/** Creates a new git worktree (new branch `name`) at the path the
 * configured template resolves to (Settings — defaults to
 * `rootDir/repo/worktrees/name`), scoped to the repo root (the worktree
 * doesn't exist yet, so the setup session can't run inside it). Returns
 * the new worktree's absolute path on success. */
export const createWorktree = async (
  rootDir: string,
  repo: string,
  name: string,
): Promise<string> => {
  const repoDir = `${rootDir}/${repo}`;
  const worktreePath = resolveWorktreePath(rootDir, repo, name);

  const { data: setupSession } = await client.session.create({
    query: { directory: repoDir },
    body: { title: `${WORKTREE_SETUP_PREFIX} ${name}` },
  });
  if (setupSession === undefined) {
    throw new WorktreeCreateError("Couldn't start the worktree-setup session.");
  }

  const { data: result } = await client.session.shell({
    path: { id: setupSession.id },
    query: { directory: repoDir },
    body: {
      agent: REPO_ADMIN_AGENT,
      command: `git worktree add ${worktreePath} -b ${name}`,
    },
  });
  if (result === undefined) {
    throw new WorktreeCreateError(`\`git worktree add\` failed for "${name}".`);
  }

  return worktreePath;
};
