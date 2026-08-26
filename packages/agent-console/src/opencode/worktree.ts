/**
 * Worktree creation — runs `git worktree add` via a short-lived session
 * under the "repo-admin" agent profile (~/.config/opencode/opencode.jsonc —
 * global, not project-local; see that file's comment for why), whose bash
 * permission is scoped to `git worktree*` only (not the general "console"
 * agent, which denies bash entirely).
 *
 * The setup session is titled with the `WORKTREE_SETUP_PREFIX` so session
 * lists (Home, RepoSessions) can filter it out — it's a background
 * operation, not something the owner should see mixed into their chats.
 *
 * @internal
 */
import { REPO_ADMIN_AGENT, WORKTREE_SETUP_PREFIX } from "./agentConstants";
import { client } from "./client";
import { resolveWorktreePath } from "./settings";

export { REPO_ADMIN_AGENT, WORKTREE_SETUP_PREFIX };

export class WorktreeCreateError extends Error {}

/** Creates a new git worktree (new branch `name`) at the path the
 * configured template resolves to (Settings — defaults to
 * `rootDir/repo/worktrees/name`). The command runs scoped to
 * `mainCheckoutPath` (an existing worktree of this repo — repoScan.ts's
 * `(main)` entry, not `rootDir/repo`, which doesn't always exist: a repo's
 * real checkout can live deeper, e.g. `rootDir/packages/effect-pm`).
 * Returns the new worktree's absolute path on success. */
export const createWorktree = async (
  rootDir: string,
  repo: string,
  mainCheckoutPath: string,
  name: string,
): Promise<string> => {
  const worktreePath = resolveWorktreePath(rootDir, repo, name);

  const { data: setupSession } = await client.session.create({
    query: { directory: mainCheckoutPath },
    body: { title: `${WORKTREE_SETUP_PREFIX} ${name}` },
  });
  if (setupSession === undefined) {
    throw new WorktreeCreateError("Couldn't start the worktree-setup session.");
  }

  const { data: result } = await client.session.shell({
    path: { id: setupSession.id },
    query: { directory: mainCheckoutPath },
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
