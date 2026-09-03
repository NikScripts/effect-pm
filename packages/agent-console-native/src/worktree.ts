/**
 * Worktree creation — runs `git worktree add` via a short-lived session
 * under the "repo-admin" agent. Ported from packages/agent-console's
 * worktree.ts; native takes the client as an argument (no module singleton).
 *
 * @internal
 */
import { REPO_ADMIN_AGENT, WORKTREE_SETUP_PREFIX } from "./agentConstants";
import type { OpencodeClient } from "./client";
import { DEFAULT_WORKTREE_TEMPLATE, getWorktreeTemplate } from "./settings";

export { DEFAULT_WORKTREE_TEMPLATE };

export const resolveWorktreePath = (
  rootDir: string,
  repo: string,
  name: string,
  template: string = DEFAULT_WORKTREE_TEMPLATE,
): string =>
  template.replaceAll("{root}", rootDir).replaceAll("{repo}", repo).replaceAll("{name}", name);

export class WorktreeCreateError extends Error {}

export const createWorktree = async (
  client: OpencodeClient,
  rootDir: string,
  repo: string,
  mainCheckoutPath: string,
  name: string,
): Promise<string> => {
  const template = await getWorktreeTemplate();
  const worktreePath = resolveWorktreePath(rootDir, repo, name, template);

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
