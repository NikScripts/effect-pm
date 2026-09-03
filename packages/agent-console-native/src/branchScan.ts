/**
 * Read the current branch and list local branches for a checkout, via the
 * OpenCode file API (no shell). Worktrees store `.git` as a file pointing
 * at a gitdir — HEAD lives there, while branch refs stay on the main
 * checkout's `.git`.
 *
 * @internal
 */
import type { OpencodeClient } from "./client";

const readFileText = async (
  client: OpencodeClient,
  directory: string,
  path: string,
): Promise<string | undefined> => {
  try {
    const { data } = await client.file.read({ query: { directory, path } });
    return data?.type === "text" ? data.content : undefined;
  } catch {
    return undefined;
  }
};

/** Absolute gitdir for a checkout, if `.git` is a `gitdir:` file. */
const resolveGitdir = async (
  client: OpencodeClient,
  checkoutDir: string,
): Promise<string | undefined> => {
  const content = await readFileText(client, checkoutDir, ".git");
  if (content === undefined) return undefined;
  const match = content.trim().match(/^gitdir:\s*(.+)$/);
  if (match === null || match[1] === undefined) return undefined;
  const gitdir = match[1].trim();
  return gitdir.startsWith("/") ? gitdir : undefined;
};

const parseHeadRef = (content: string): string | undefined => {
  const trimmed = content.trim();
  const refMatch = trimmed.match(/^ref:\s*refs\/heads\/(.+)$/);
  if (refMatch?.[1] !== undefined) return refMatch[1];
  // Detached HEAD — short sha for display.
  if (/^[0-9a-f]{7,40}$/i.test(trimmed)) return trimmed.slice(0, 7);
  return undefined;
};

/** Current branch (or short detached SHA) for a worktree/checkout path. */
export const readCurrentBranch = async (
  client: OpencodeClient,
  checkoutDir: string,
): Promise<string | undefined> => {
  const gitdir = await resolveGitdir(client, checkoutDir);
  if (gitdir !== undefined) {
    const head = await readFileText(client, gitdir, "HEAD");
    return head === undefined ? undefined : parseHeadRef(head);
  }
  const head = await readFileText(client, checkoutDir, ".git/HEAD");
  return head === undefined ? undefined : parseHeadRef(head);
};

/** Local branch names from the main checkout's refs (+ packed-refs). */
export const listLocalBranches = async (
  client: OpencodeClient,
  mainCheckoutDir: string,
): Promise<ReadonlyArray<string>> => {
  const names = new Set<string>();

  const walkHeads = async (relative: string, prefix: string): Promise<void> => {
    try {
      const { data } = await client.file.list({
        query: { directory: mainCheckoutDir, path: relative },
      });
      for (const entry of data ?? []) {
        const full = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
        if (entry.type === "directory") {
          await walkHeads(`${relative}/${entry.name}`, full);
        } else {
          names.add(full);
        }
      }
    } catch {
      // Missing refs/heads is fine (empty repo / packed-only).
    }
  };

  await walkHeads(".git/refs/heads", "");

  const packed = await readFileText(client, mainCheckoutDir, ".git/packed-refs");
  if (packed !== undefined) {
    for (const line of packed.split("\n")) {
      if (line.startsWith("#") || line.startsWith("^")) continue;
      const match = line.match(/^[0-9a-f]+\s+refs\/heads\/(\S+)/i);
      if (match?.[1] !== undefined) names.add(match[1]);
    }
  }

  return Array.from(names).sort((a, b) => a.localeCompare(b));
};
