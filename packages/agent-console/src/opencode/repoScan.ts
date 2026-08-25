/**
 * Real repo/worktree discovery — no assumed directory layout. A checkout is
 * anything under `rootDir` (or one level deeper — confirmed hands-on this
 * matters: real repos here live at `rootDir/packages/effect-pm`, not
 * `rootDir/effect-pm`) with a `.git` entry. Its worktrees are whatever
 * `git worktree list --porcelain` actually says, run via the "repo-admin"
 * agent (~/.config/opencode/opencode.jsonc — global, not project-local; see
 * that file's comment for why).
 *
 * Confirmed hands-on on this machine: worktrees of the *same* repo can be
 * scattered across genuinely different top-level folders (mid-rename, e.g.
 * `Hyperlink/worktrees/*` and `packages/effect-pm*` turned out to be one
 * repo's worktrees). So this doesn't name a repo after the folder it found
 * a checkout in — it runs `git worktree list` from each newly-discovered
 * checkout, and every path *that* returns gets marked covered before
 * moving on, so the same repo is never shelled out to twice and its
 * scattered worktrees end up in one group. The repo's display name is its
 * main worktree's own directory name (what `git worktree list` itself
 * calls canonical — always the first entry).
 *
 * Scanning every repo on every render would be slow and hammer the
 * server, so this is meant to be triggered occasionally (Settings' "Rescan"
 * button) or on a cold start with no cached data — see repoScanCache.ts for
 * the caching/staleness side of that.
 *
 * @internal
 */
import type { AssistantMessage, Part } from "@opencode-ai/sdk";
import { client } from "./client";
import { REPO_ADMIN_AGENT, WORKTREE_SETUP_PREFIX } from "./worktree";

/** The SDK's declared type for `session.shell`'s 200 response is a bare
 * `AssistantMessage` — confirmed hands-on (dumped the raw response) that's
 * wrong; the real shape is `{ info, parts }`, same as `session.message`.
 * Trusting the wrong declared type meant `.id` silently read as `undefined`
 * at runtime (TS had no way to catch it), which cascaded into a very
 * confusing failure two calls downstream. Narrowed with a real runtime
 * check below, not a blind cast past the wrong declared type. */
type ShellResult = { readonly info: AssistantMessage; readonly parts: ReadonlyArray<Part> };

const isShellResult = (value: unknown): value is ShellResult =>
  typeof value === "object" &&
  value !== null &&
  "parts" in value &&
  Array.isArray((value as { parts: unknown }).parts);

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

type DirEntry = { readonly name: string; readonly type: "file" | "directory" };

const listDirectoryEntries = async (directory: string, path: string): Promise<ReadonlyArray<DirEntry>> => {
  try {
    const { data } = await client.file.list({ query: { directory, path } });
    return data ?? [];
  } catch {
    return [];
  }
};

const basename = (path: string): string => {
  const segments = path.split("/").filter((s) => s.length > 0);
  return segments[segments.length - 1] ?? path;
};

/** Every directory under `rootDir` that's itself a git checkout (`.git`
 * present, one or two levels down — see the module comment). Doesn't
 * descend into a confirmed checkout's own subdirectories (avoids treating
 * a submodule as its own top-level repo). */
const findGitCheckouts = async (rootDir: string): Promise<ReadonlyArray<string>> => {
  const level1 = (await listDirectoryEntries(rootDir, ".")).filter((e) => e.type === "directory");

  const checkouts = await Promise.all(
    level1.map(async (entry) => {
      const ownEntries = await listDirectoryEntries(rootDir, entry.name);
      if (ownEntries.some((e) => e.name === ".git")) return [`${rootDir}/${entry.name}`];

      const level2 = ownEntries.filter((e) => e.type === "directory");
      const nested = await Promise.all(
        level2.map(async (sub) => {
          const subPath = `${entry.name}/${sub.name}`;
          const subEntries = await listDirectoryEntries(rootDir, subPath);
          return subEntries.some((e) => e.name === ".git") ? `${rootDir}/${subPath}` : undefined;
        }),
      );
      return nested.filter((p): p is string => p !== undefined);
    }),
  );

  return checkouts.flat();
};

/** `git worktree list --porcelain` output looks like:
 *   worktree /path/to/main
 *   HEAD <sha>
 *   branch refs/heads/main
 *
 *   worktree /path/to/other
 *   HEAD <sha>
 *   branch refs/heads/feature
 * — blank-line-separated blocks, one `worktree <path>` line each. The
 * *first* entry is always the main worktree (git's own convention). */
const parsePorcelain = (output: string): ReadonlyArray<ScannedWorktree> =>
  output
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length).trim())
    .filter((path) => path.length > 0)
    .map((path, i) => ({ path, name: i === 0 ? "(main)" : basename(path), isMain: i === 0 }));

const runGitWorktreeList = async (checkoutPath: string): Promise<ReadonlyArray<ScannedWorktree>> => {
  const { data: session } = await client.session.create({
    query: { directory: checkoutPath },
    body: { title: `${WORKTREE_SETUP_PREFIX} scan ${basename(checkoutPath)}` },
  });
  if (session === undefined) return [];

  const { data } = await client.session.shell({
    path: { id: session.id },
    query: { directory: checkoutPath },
    body: { agent: REPO_ADMIN_AGENT, command: "git worktree list --porcelain" },
  });
  if (data === undefined || !isShellResult(data)) return [];

  const toolPart = data.parts.find((p) => p.type === "tool");
  if (toolPart === undefined || toolPart.type !== "tool" || toolPart.state.status !== "completed") return [];

  return parsePorcelain(toolPart.state.output);
};

export const scanRepos = async (rootDir: string): Promise<ReadonlyArray<ScannedRepo>> => {
  const checkouts = await findGitCheckouts(rootDir);

  const covered = new Set<string>();
  const groups: Array<ScannedRepo> = [];

  // Sequential, not Promise.all: each iteration needs to know what the
  // *previous* one already covered before deciding whether to shell out.
  for (const checkoutPath of checkouts) {
    if (covered.has(checkoutPath)) continue;
    const worktrees = await runGitWorktreeList(checkoutPath);
    if (worktrees.length === 0) continue;
    for (const wt of worktrees) covered.add(wt.path);
    const main = worktrees.find((w) => w.isMain) ?? worktrees[0]!;
    groups.push({ repo: basename(main.path), worktrees });
  }

  return groups;
};
