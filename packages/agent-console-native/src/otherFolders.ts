/**
 * Root children the repo scan did not claim. Not a second discovery path —
 * only subtracts against an already-scanned result, under the **same**
 * expanded `rootDir` the scan used. Repo identity stays on `ScannedRepo.repo`
 * (git remote name); this never invents names from folder basenames.
 *
 * @internal
 */
import type { OpencodeClient } from "./client";
import type { FolderTarget } from "./HomeTargetPickers";
import type { ScannedRepo } from "./repoScan";

export const listOtherFolders = async (
  client: OpencodeClient,
  /** Expanded root — identical string passed to `scanRepos`. */
  rootDir: string,
  scanned: ReadonlyArray<ScannedRepo>,
): Promise<ReadonlyArray<FolderTarget>> => {
  try {
    const { data } = await client.file.list({ query: { directory: rootDir, path: "." } });
    const claimed = new Set<string>();
    for (const repo of scanned) {
      for (const wt of repo.worktrees) {
        claimed.add(wt.path);
        // Claim the immediate child of rootDir that contains this checkout
        // (`{root}/{repo}/main` → claim `{root}/{repo}` so it isn't listed
        // again as a plain folder).
        if (wt.path.startsWith(`${rootDir}/`)) {
          const rest = wt.path.slice(rootDir.length + 1);
          const top = rest.split("/")[0];
          if (top !== undefined && top.length > 0) claimed.add(`${rootDir}/${top}`);
        }
      }
    }

    return (data ?? [])
      .filter((e) => e.type === "directory" && e.name !== ".git")
      .map((e) => ({ kind: "folder" as const, name: e.name, path: `${rootDir}/${e.name}` }))
      .filter((f) => !claimed.has(f.path));
  } catch {
    return [];
  }
};
