/**
 * Parse remote git URLs, probe refs, and create / clone repos into the
 * configured main-checkout path template.
 *
 * @internal
 */
import type { OpencodeClient } from "./client";
import { expandHome } from "./homeDir";
import { RepoAdminError, runRepoAdmin } from "./repoAdmin";
import { getRepoTemplate, resolveRepoPath } from "./settings";

export type ParsedRemote = {
  readonly input: string;
  readonly url: string;
  readonly host: string | undefined;
  readonly owner: string | undefined;
  readonly name: string;
};

export type RemotePreview = {
  readonly remote: ParsedRemote;
  readonly defaultBranch: string | undefined;
  readonly branches: ReadonlyArray<string>;
  readonly destination: string;
};

export type GitHubSearchHit = {
  readonly fullName: string;
  readonly url: string;
  readonly description: string | undefined;
};

/** Normalize paste targets like `owner/repo`, SSH, or https into a fetch URL. */
export const parseRemoteInput = (raw: string): ParsedRemote | undefined => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;

  // owner/repo shorthand → GitHub
  if (/^[\w.-]+\/[\w.-]+$/.test(trimmed) && !trimmed.includes(":")) {
    const [owner, name] = trimmed.split("/");
    if (owner === undefined || name === undefined) return undefined;
    return {
      input: trimmed,
      url: `https://github.com/${owner}/${name}.git`,
      host: "github.com",
      owner,
      name: name.replace(/\.git$/, ""),
    };
  }

  // git@host:owner/repo.git
  const ssh = trimmed.match(/^git@([^:]+):(.+)$/);
  if (ssh !== null && ssh[1] !== undefined && ssh[2] !== undefined) {
    const path = ssh[2].replace(/\.git$/, "");
    const segments = path.split("/").filter((s) => s.length > 0);
    const name = segments[segments.length - 1];
    if (name === undefined) return undefined;
    return {
      input: trimmed,
      url: trimmed,
      host: ssh[1],
      owner: segments.length >= 2 ? segments[segments.length - 2] : undefined,
      name,
    };
  }

  // https://host/owner/repo(.git)?
  try {
    const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
    const parsed = new URL(withScheme);
    const segments = parsed.pathname.split("/").filter((s) => s.length > 0);
    const name = segments[segments.length - 1]?.replace(/\.git$/, "");
    if (name === undefined || name.length === 0) return undefined;
    return {
      input: trimmed,
      url: withScheme.endsWith(".git") ? withScheme : `${withScheme.replace(/\/$/, "")}.git`,
      host: parsed.host,
      owner: segments.length >= 2 ? segments[segments.length - 2] : undefined,
      name,
    };
  } catch {
    return undefined;
  }
};

const parseLsRemote = (output: string): { defaultBranch: string | undefined; branches: ReadonlyArray<string> } => {
  const branches: Array<string> = [];
  let headTarget: string | undefined;
  for (const line of output.split("\n")) {
    const match = line.match(/^[0-9a-f]+\s+(\S+)$/i);
    if (match === null || match[1] === undefined) continue;
    const ref = match[1];
    if (ref === "HEAD") continue;
    if (ref.startsWith("refs/heads/")) {
      branches.push(ref.slice("refs/heads/".length));
      continue;
    }
    // symref lines: `ref: refs/heads/main	HEAD` appear with some git versions via --symref
  }
  // Prefer explicit symref if present in raw output
  const sym = output.match(/ref:\s*refs\/heads\/(\S+)\s+HEAD/);
  if (sym?.[1] !== undefined) headTarget = sym[1];
  else if (branches.includes("main")) headTarget = "main";
  else if (branches.includes("master")) headTarget = "master";
  else headTarget = branches[0];

  return { defaultBranch: headTarget, branches };
};

export const previewRemote = async (
  client: OpencodeClient,
  rootDir: string,
  rawUrl: string,
  repoNameOverride?: string,
): Promise<RemotePreview> => {
  const remote = parseRemoteInput(rawUrl);
  if (remote === undefined) throw new RepoAdminError("That doesn't look like a git URL or owner/repo.");

  const expanded = await expandHome(client, rootDir);
  const template = await getRepoTemplate();
  const repoName = (repoNameOverride?.trim() || remote.name).trim();
  const destination = resolveRepoPath(expanded, repoName, template);

  const output = await runRepoAdmin(
    client,
    expanded,
    `git ls-remote --heads --symref ${JSON.stringify(remote.url)}`,
    "ls-remote",
  );
  const { defaultBranch, branches } = parseLsRemote(output);
  return { remote: { ...remote, name: repoName }, defaultBranch, branches, destination };
};

export const cloneRepo = async (
  client: OpencodeClient,
  rootDir: string,
  remoteUrl: string,
  repoName: string,
  branch: string | undefined,
): Promise<string> => {
  const expanded = await expandHome(client, rootDir);
  const template = await getRepoTemplate();
  const destination = resolveRepoPath(expanded, repoName, template);
  const parent = destination.replace(/\/[^/]+$/, "");
  const branchFlag = branch !== undefined && branch.length > 0 ? `-b ${JSON.stringify(branch)} ` : "";
  await runRepoAdmin(
    client,
    expanded,
    `mkdir -p ${JSON.stringify(parent)} && git clone ${branchFlag}${JSON.stringify(remoteUrl)} ${JSON.stringify(destination)}`,
    `clone ${repoName}`,
  );
  return destination;
};

export const initRepo = async (
  client: OpencodeClient,
  rootDir: string,
  repoName: string,
): Promise<string> => {
  const expanded = await expandHome(client, rootDir);
  const template = await getRepoTemplate();
  const destination = resolveRepoPath(expanded, repoName, template);
  const parent = destination.replace(/\/[^/]+$/, "");
  await runRepoAdmin(
    client,
    expanded,
    `mkdir -p ${JSON.stringify(parent)} && mkdir -p ${JSON.stringify(destination)} && git -C ${JSON.stringify(destination)} init -b main`,
    `init ${repoName}`,
  );
  return destination;
};

export const createWorkspaceFolder = async (
  client: OpencodeClient,
  rootDir: string,
  name: string,
): Promise<string> => {
  const expanded = await expandHome(client, rootDir);
  const path = `${expanded}/${name}`;
  await runRepoAdmin(client, expanded, `mkdir -p ${JSON.stringify(path)}`, `mkdir ${name}`);
  return path;
};

/** Best-effort GitHub search via `gh`. Returns [] if gh isn't available. */
export const searchGitHubRepos = async (
  client: OpencodeClient,
  rootDir: string,
  query: string,
): Promise<ReadonlyArray<GitHubSearchHit>> => {
  const q = query.trim();
  if (q.length === 0) return [];
  const expanded = await expandHome(client, rootDir);
  try {
    const output = await runRepoAdmin(
      client,
      expanded,
      `gh search repos ${JSON.stringify(q)} --limit 8 --json fullName,url,description 2>/dev/null || true`,
      "gh search",
    );
    if (output.length === 0 || output.startsWith("[" ) === false) return [];
    const parsed: unknown = JSON.parse(output);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((row) => {
      if (typeof row !== "object" || row === null) return [];
      const fullName = (row as { fullName?: unknown }).fullName;
      const url = (row as { url?: unknown }).url;
      const description = (row as { description?: unknown }).description;
      if (typeof fullName !== "string" || typeof url !== "string") return [];
      return [
        {
          fullName,
          url,
          description: typeof description === "string" ? description : undefined,
        },
      ];
    });
  } catch {
    return [];
  }
};
