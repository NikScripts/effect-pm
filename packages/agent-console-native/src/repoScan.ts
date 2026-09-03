/**
 * Real repo/worktree discovery — driven entirely by git's own on-disk
 * metadata, not folder location or shelling out to `git`. A checkout is
 * anything under `rootDir` (or one level deeper) with a `.git` entry.
 *
 * Ported from packages/agent-console/src/opencode/repoScan.ts — pure logic,
 * no platform-specific dependencies beyond the SDK client itself, so this
 * is a verbatim copy (modulo taking `client` as a parameter — the web app
 * has one fixed client instance for the whole app; native's is built at
 * runtime from a user-configured server address, so there's no module-level
 * singleton to import here) pending a proper shared package once the
 * native app's actual needs are proven out. See that file's own history for
 * the full story on *why* it's shaped this way (git-file-based identity,
 * not folder-based; root-checkout detection; submodule-vs-worktree gitdir
 * disambiguation; remote-derived repo naming).
 *
 * @internal
 */
import type { OpencodeClient } from "./client";

export type ScannedWorktree = {
  readonly name: string;
  readonly path: string;
  readonly isMain: boolean;
};

export type ScannedRepo = {
  readonly repo: string;
  readonly worktrees: ReadonlyArray<ScannedWorktree>;
};

type DirEntry = { readonly name: string; readonly type: "file" | "directory" };

const listDirectoryEntries = async (client: OpencodeClient, directory: string, path: string): Promise<ReadonlyArray<DirEntry>> => {
  try {
    const { data } = await client.file.list({ query: { directory, path } });
    return data ?? [];
  } catch {
    return [];
  }
};

const readFileText = async (client: OpencodeClient, directory: string, path: string): Promise<string | undefined> => {
  try {
    const { data } = await client.file.read({ query: { directory, path } });
    return data?.type === "text" ? data.content : undefined;
  } catch {
    return undefined;
  }
};

export class RepoScanError extends Error {}

const basename = (path: string): string => {
  const segments = path.split("/").filter((s) => s.length > 0);
  return segments[segments.length - 1] ?? path;
};

const stripTrailingDotGit = (path: string): string => (path.endsWith("/.git") ? path.slice(0, -"/.git".length) : path);

type GitEntry = { readonly checkoutDir: string; readonly gitType: "file" | "directory" };

const findGitEntries = async (client: OpencodeClient, rootDir: string): Promise<ReadonlyArray<GitEntry>> => {
  let rootEntries: ReadonlyArray<DirEntry>;
  try {
    const { data, error } = await client.file.list({ query: { directory: rootDir, path: "." } });
    if (error !== undefined) {
      const message = typeof error === "object" && error !== null && "data" in error ? (error as { data?: { message?: string } }).data?.message : undefined;
      throw new Error(message ?? "unreachable");
    }
    rootEntries = data ?? [];
  } catch (cause) {
    throw new RepoScanError(`Couldn't list "${rootDir}" — check the root folder path in Settings.`, { cause });
  }

  const rootDotGit = rootEntries.find((e) => e.name === ".git");
  const ownRoot: ReadonlyArray<GitEntry> = rootDotGit === undefined ? [] : [{ checkoutDir: rootDir, gitType: rootDotGit.type }];

  const level1 = rootEntries.filter((e) => e.type === "directory");

  const found = await Promise.all(
    level1.map(async (entry): Promise<ReadonlyArray<GitEntry>> => {
      const ownEntries = await listDirectoryEntries(client, rootDir, entry.name);
      const dotGit = ownEntries.find((e) => e.name === ".git");
      if (dotGit !== undefined) return [{ checkoutDir: `${rootDir}/${entry.name}`, gitType: dotGit.type }];

      const level2 = ownEntries.filter((e) => e.type === "directory");
      const nested = await Promise.all(
        level2.map(async (sub): Promise<ReadonlyArray<GitEntry>> => {
          const subPath = `${entry.name}/${sub.name}`;
          const subEntries = await listDirectoryEntries(client, rootDir, subPath);
          const nestedDotGit = subEntries.find((e) => e.name === ".git");
          if (nestedDotGit !== undefined) {
            return [{ checkoutDir: `${rootDir}/${subPath}`, gitType: nestedDotGit.type }];
          }

          // Third level — covers `{root}/{repo}/worktrees/{name}` linked
          // checkouts when they appear before we resolve them via the main
          // `.git/worktrees` table (and any deeper nest we still want).
          const level3 = subEntries.filter((e) => e.type === "directory");
          const deeper = await Promise.all(
            level3.map(async (leaf): Promise<GitEntry | undefined> => {
              const leafPath = `${subPath}/${leaf.name}`;
              const leafEntries = await listDirectoryEntries(client, rootDir, leafPath);
              const leafDotGit = leafEntries.find((e) => e.name === ".git");
              return leafDotGit === undefined
                ? undefined
                : { checkoutDir: `${rootDir}/${leafPath}`, gitType: leafDotGit.type };
            }),
          );
          return deeper.filter((e): e is GitEntry => e !== undefined);
        }),
      );
      return nested.flat();
    }),
  );

  return [...ownRoot, ...found.flat()];
};

const resolveMainFromWorktreeGitFile = async (client: OpencodeClient, checkoutDir: string): Promise<string | undefined> => {
  const content = await readFileText(client, checkoutDir, ".git");
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

const listLinkedWorktrees = async (client: OpencodeClient, mainCheckoutDir: string): Promise<ReadonlyArray<ScannedWorktree>> => {
  const entries = await listDirectoryEntries(client, mainCheckoutDir, ".git/worktrees");
  const names = entries.filter((e) => e.type === "directory").map((e) => e.name);

  const worktrees = await Promise.all(
    names.map(async (name): Promise<ScannedWorktree | undefined> => {
      const content = await readFileText(client, mainCheckoutDir, `.git/worktrees/${name}/gitdir`);
      if (content === undefined) return undefined;
      return { name, path: stripTrailingDotGit(content.trim()), isMain: false };
    }),
  );

  return worktrees.filter((w): w is ScannedWorktree => w !== undefined);
};

const resolveRepoName = async (client: OpencodeClient, mainCheckoutDir: string): Promise<string> => {
  const config = await readFileText(client, mainCheckoutDir, ".git/config");
  const fromRemote = config === undefined ? undefined : repoNameFromConfig(config);
  if (fromRemote !== undefined) return fromRemote;

  // Main checkouts live at `{root}/{repo}/main` by default — basename alone
  // would report every repo as "main". Prefer the parent folder name in that
  // case (and for a bare "master" checkout folder too).
  const base = basename(mainCheckoutDir);
  if (base === "main" || base === "master") {
    const parent = basename(mainCheckoutDir.replace(/\/[^/]+\/?$/, ""));
    if (parent.length > 0 && parent !== base) return parent;
  }
  return base;
};

const repoNameFromConfig = (config: string): string | undefined => {
  const originSection = config.match(/\[remote "origin"\][^[]*/);
  const anySection = originSection?.[0] ?? config.match(/\[remote "[^"]+"\][^[]*/)?.[0];
  if (anySection === undefined) return undefined;

  const urlMatch = anySection.match(/url\s*=\s*(\S+)/);
  if (urlMatch === null || urlMatch[1] === undefined) return undefined;

  return repoNameFromRemoteUrl(urlMatch[1]);
};

const repoNameFromRemoteUrl = (url: string): string | undefined => {
  const withoutDotGit = url.trim().replace(/\.git$/, "");
  const segments = withoutDotGit.split(/[/:]/).filter((s) => s.length > 0);
  return segments[segments.length - 1];
};

export const scanRepos = async (client: OpencodeClient, rootDir: string): Promise<ReadonlyArray<ScannedRepo>> => {
  const entries = await findGitEntries(client, rootDir);

  const mains = new Set<string>();
  for (const entry of entries) {
    if (entry.gitType === "directory") {
      mains.add(entry.checkoutDir);
    } else {
      const main = await resolveMainFromWorktreeGitFile(client, entry.checkoutDir);
      if (main !== undefined) mains.add(main);
    }
  }

  const groups = await Promise.all(
    Array.from(mains).map(async (mainCheckoutDir): Promise<ScannedRepo> => {
      const [linked, repo] = await Promise.all([listLinkedWorktrees(client, mainCheckoutDir), resolveRepoName(client, mainCheckoutDir)]);
      return {
        repo,
        worktrees: [{ name: "(main)", path: mainCheckoutDir, isMain: true }, ...linked],
      };
    }),
  );

  // Merge checkouts that share a repo identity (e.g. remote-derived name).
  const merged = new Map<string, ScannedRepo>();
  for (const group of groups) {
    const existing = merged.get(group.repo);
    if (existing === undefined) {
      merged.set(group.repo, group);
      continue;
    }
    const paths = new Set(existing.worktrees.map((w) => w.path));
    merged.set(group.repo, {
      repo: group.repo,
      worktrees: [...existing.worktrees, ...group.worktrees.filter((w) => !paths.has(w.path))],
    });
  }

  return Array.from(merged.values()).sort((a, b) => a.repo.localeCompare(b.repo));
};
