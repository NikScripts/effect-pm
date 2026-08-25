/**
 * Real repo/worktree discovery — driven entirely by git's own on-disk
 * metadata, not folder location or shelling out to `git`. A checkout is
 * anything under `rootDir` (or one level deeper — confirmed hands-on this
 * matters: real repos here live at `rootDir/packages/effect-pm`, not
 * `rootDir/effect-pm`) with a `.git` entry.
 *
 * The point the owner corrected this on: "repos aren't folders, worktrees
 * aren't just folders. Folders are just where they are stored." Concretely:
 * a normal repo checkout has `.git` as a DIRECTORY; a `git worktree add`'d
 * checkout has `.git` as a FILE containing a single `gitdir: <path>` line
 * pointing back at `<main checkout>/.git/worktrees/<name>`. That pointer —
 * and the main checkout's own `.git/worktrees` bookkeeping, which points
 * the other direction — is the repo's real identity. This reads those
 * files directly (`file.read`), never `git worktree list` in a shelled-out
 * session: it's fewer moving parts, doesn't need the repo-admin agent at
 * all for scanning (only worktree *creation* still needs it — see
 * worktree.ts), and can't be fooled by directories that happen to look
 * like they belong together.
 *
 * Scanning every repo on every render would be slow and hammer the
 * server, so this is meant to be triggered occasionally (Settings' "Rescan"
 * button) or on a cold start with no cached data — see repoScanCache.ts for
 * the caching/staleness side of that.
 *
 * @internal
 */
import { client } from "./client";

export type ScannedWorktree = {
  readonly name: string;
  readonly path: string;
  /** True for the repo's primary checkout (`.git` is a directory there) —
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

const readFileText = async (directory: string, path: string): Promise<string | undefined> => {
  try {
    const { data } = await client.file.read({ query: { directory, path } });
    return data?.type === "text" ? data.content : undefined;
  } catch {
    return undefined;
  }
};

const basename = (path: string): string => {
  const segments = path.split("/").filter((s) => s.length > 0);
  return segments[segments.length - 1] ?? path;
};

const stripTrailingDotGit = (path: string): string => (path.endsWith("/.git") ? path.slice(0, -"/.git".length) : path);

type GitEntry = { readonly checkoutDir: string; readonly gitType: "file" | "directory" };

/** Every directory under `rootDir` with a `.git` entry (one or two levels
 * down — see the module comment), noting whether that `.git` is a file or
 * a directory. Also checks `rootDir` itself — the configured root is often
 * pointed straight at a checkout (this very repo, say), not a container
 * folder above one; missing that case meant every session under it fell
 * through to the basename fallback instead of ever reaching a real scan.
 * Doesn't descend into a confirmed checkout's own subdirectories (avoids
 * treating a submodule as its own top-level repo). */
const findGitEntries = async (rootDir: string): Promise<ReadonlyArray<GitEntry>> => {
  const rootEntries = await listDirectoryEntries(rootDir, ".");
  const rootDotGit = rootEntries.find((e) => e.name === ".git");
  const ownRoot: ReadonlyArray<GitEntry> = rootDotGit === undefined ? [] : [{ checkoutDir: rootDir, gitType: rootDotGit.type }];

  const level1 = rootEntries.filter((e) => e.type === "directory");

  const found = await Promise.all(
    level1.map(async (entry): Promise<ReadonlyArray<GitEntry>> => {
      const ownEntries = await listDirectoryEntries(rootDir, entry.name);
      const dotGit = ownEntries.find((e) => e.name === ".git");
      if (dotGit !== undefined) return [{ checkoutDir: `${rootDir}/${entry.name}`, gitType: dotGit.type }];

      const level2 = ownEntries.filter((e) => e.type === "directory");
      const nested = await Promise.all(
        level2.map(async (sub): Promise<GitEntry | undefined> => {
          const subPath = `${entry.name}/${sub.name}`;
          const subEntries = await listDirectoryEntries(rootDir, subPath);
          const nestedDotGit = subEntries.find((e) => e.name === ".git");
          return nestedDotGit === undefined
            ? undefined
            : { checkoutDir: `${rootDir}/${subPath}`, gitType: nestedDotGit.type };
        }),
      );
      return nested.filter((e): e is GitEntry => e !== undefined);
    }),
  );

  return [...ownRoot, ...found.flat()];
};

/** A `.git` FILE usually means this checkout is a linked worktree, not a
 * repo in its own right — its content is `gitdir: <main>/.git/worktrees/<name>`,
 * resolved back to `<main>`, the repo's real identity.
 *
 * But a `.git` FILE is also what a git *submodule* checkout has, and when
 * the superproject containing it is itself a linked worktree, git nests the
 * submodule's real gitdir under that worktree's own entry:
 * `<main>/.git/worktrees/<name>/modules/<submodule path...>` — a *relative*
 * path in practice, and one that still contains the `/.git/worktrees/`
 * marker, so it'd otherwise be misread as this checkout's own worktree
 * entry (confirmed hands-on: a `repos/effect` submodule checkout produced a
 * bogus second "repo" with a broken relative main path). A genuine worktree
 * pointer is always absolute and ends exactly at `.../worktrees/<name>` —
 * nothing after it. */
const resolveMainFromWorktreeGitFile = async (checkoutDir: string): Promise<string | undefined> => {
  const content = await readFileText(checkoutDir, ".git");
  if (content === undefined) return undefined;

  const match = content.trim().match(/^gitdir:\s*(.+)$/);
  if (match === null || match[1] === undefined) return undefined;

  const gitdirPath = match[1].trim();
  if (!gitdirPath.startsWith("/")) return undefined;

  const marker = "/.git/worktrees/";
  const markerIndex = gitdirPath.indexOf(marker);
  if (markerIndex === -1) return undefined;

  const afterMarker = gitdirPath.slice(markerIndex + marker.length);
  if (afterMarker.length === 0 || afterMarker.includes("/")) return undefined;

  return gitdirPath.slice(0, markerIndex);
};

/** A `.git` DIRECTORY is a main checkout (or a standalone repo with no
 * linked worktrees). Its `.git/worktrees/<name>/gitdir` file is git's own
 * bookkeeping for each worktree linked to it — its content is
 * `<worktree path>/.git`, read directly, never inferred from a folder
 * name or location. */
const listLinkedWorktrees = async (mainCheckoutDir: string): Promise<ReadonlyArray<ScannedWorktree>> => {
  const entries = await listDirectoryEntries(mainCheckoutDir, ".git/worktrees");
  const names = entries.filter((e) => e.type === "directory").map((e) => e.name);

  const worktrees = await Promise.all(
    names.map(async (name): Promise<ScannedWorktree | undefined> => {
      const content = await readFileText(mainCheckoutDir, `.git/worktrees/${name}/gitdir`);
      if (content === undefined) return undefined;
      return { name, path: stripTrailingDotGit(content.trim()), isMain: false };
    }),
  );

  return worktrees.filter((w): w is ScannedWorktree => w !== undefined);
};

export const scanRepos = async (rootDir: string): Promise<ReadonlyArray<ScannedRepo>> => {
  const entries = await findGitEntries(rootDir);

  // Resolve every discovered checkout to its main checkout's directory —
  // git's own canonical repo identity, never wherever the folder happens
  // to be sitting on disk.
  const mains = new Set<string>();
  for (const entry of entries) {
    if (entry.gitType === "directory") {
      mains.add(entry.checkoutDir);
    } else {
      const main = await resolveMainFromWorktreeGitFile(entry.checkoutDir);
      if (main !== undefined) mains.add(main);
    }
  }

  const groups = await Promise.all(
    Array.from(mains).map(async (mainCheckoutDir): Promise<ScannedRepo> => {
      const linked = await listLinkedWorktrees(mainCheckoutDir);
      return {
        repo: basename(mainCheckoutDir),
        worktrees: [{ name: "(main)", path: mainCheckoutDir, isMain: true }, ...linked],
      };
    }),
  );

  return groups;
};
