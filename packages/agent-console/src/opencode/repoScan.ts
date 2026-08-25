/**
 * Real repo/worktree discovery — no assumed directory layout. A repo is
 * anything under `rootDir` with a `.git` entry; its worktrees are whatever
 * `git worktree list --porcelain` actually says, run via the same scoped
 * "repo-admin" agent worktree.ts uses (bash restricted to `git worktree*`).
 * This is a real filesystem+git scan, not string-matching against a path
 * convention — an existing repo can lay its worktrees out however it wants.
 *
 * Scanning every repo on every render would be slow and hammer the
 * server, so this is meant to be triggered occasionally (Settings' "Rescan"
 * button) or on a cold start with no cached data — see repoScanCache.ts for
 * the caching/staleness side of that.
 *
 * @internal
 */
import { client } from "./client";
import { REPO_ADMIN_AGENT, WORKTREE_SETUP_PREFIX } from "./worktree";

export type ScannedWorktree = {
  readonly name: string;
  readonly path: string;
  /** True for the repo's primary checkout (not a `git worktree add`'d one) —
   * shown distinctly from a real worktree, and distinctly from the
   * "(no worktree)" fallback bucket used for sessions that don't match any
   * scanned worktree at all. */
  readonly isMain: boolean;
};

export type ScannedRepo = {
  readonly repo: string;
  readonly worktrees: ReadonlyArray<ScannedWorktree>;
};

const listDirectoryEntries = async (
  directory: string,
  path: string,
): Promise<ReadonlyArray<{ readonly name: string; readonly type: "file" | "directory" }>> => {
  const { data } = await client.file.list({ query: { directory, path } });
  return data ?? [];
};

const isGitRepo = async (rootDir: string, name: string): Promise<boolean> => {
  try {
    const entries = await listDirectoryEntries(rootDir, name);
    return entries.some((e) => e.name === ".git");
  } catch {
    return false;
  }
};

/** `git worktree list --porcelain` output looks like:
 *   worktree /path/to/main
 *   HEAD <sha>
 *   branch refs/heads/main
 *
 *   worktree /path/to/other
 *   HEAD <sha>
 *   branch refs/heads/feature
 * — blank-line-separated blocks, one `worktree <path>` line each. */
const parsePorcelain = (output: string, repoDir: string): ReadonlyArray<ScannedWorktree> =>
  output
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length).trim())
    .filter((path) => path.length > 0)
    .map((path) => ({
      path,
      name: path === repoDir ? "(main)" : (path.split("/").filter((s) => s.length > 0).at(-1) ?? path),
      isMain: path === repoDir,
    }));

const runGitWorktreeList = async (rootDir: string, repo: string): Promise<ReadonlyArray<ScannedWorktree>> => {
  const repoDir = `${rootDir}/${repo}`;
  const { data: session } = await client.session.create({
    query: { directory: repoDir },
    body: { title: `${WORKTREE_SETUP_PREFIX} scan ${repo}` },
  });
  if (session === undefined) return [];

  const { data: message } = await client.session.shell({
    path: { id: session.id },
    query: { directory: repoDir },
    body: { agent: REPO_ADMIN_AGENT, command: "git worktree list --porcelain" },
  });
  if (message === undefined) return [];

  const { data: full } = await client.session.message({
    path: { id: session.id, messageID: message.id },
    query: { directory: repoDir },
  });
  const toolPart = full?.parts.find((p) => p.type === "tool");
  if (toolPart === undefined || toolPart.type !== "tool" || toolPart.state.status !== "completed") return [];

  return parsePorcelain(toolPart.state.output, repoDir);
};

export const scanRepos = async (rootDir: string): Promise<ReadonlyArray<ScannedRepo>> => {
  const candidates = await listDirectoryEntries(rootDir, ".");
  const repoNames = candidates.filter((e) => e.type === "directory").map((e) => e.name);

  const results = await Promise.all(
    repoNames.map(async (repo) => {
      if (!(await isGitRepo(rootDir, repo))) return undefined;
      const worktrees = await runGitWorktreeList(rootDir, repo);
      return { repo, worktrees } satisfies ScannedRepo;
    }),
  );

  return results.filter((r): r is ScannedRepo => r !== undefined);
};
