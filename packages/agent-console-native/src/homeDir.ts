/**
 * Resolves the server's `$HOME`, once, for expanding a `~/`-prefixed root
 * folder — ported from packages/agent-console/src/opencode/homeDir.ts.
 * Confirmed hands-on there: the file API's `directory` param is a literal
 * filesystem path, so `~/Coding` isn't shorthand, it's just a directory
 * named `~` that doesn't exist, and the server 500s. Native has no OS
 * access to expand it itself either, so this asks the `repo-admin` agent
 * (already configured server-side, shared with the web app — see
 * agentConstants.ts) to read it server-side, once per connected server,
 * and caches the result.
 *
 * Takes `client` as a parameter rather than importing a singleton (see
 * repoScan.ts for why), and caches per client instance rather than
 * globally — native can reconnect to a different server within one process
 * lifetime (the web app can't, so its version doesn't need this).
 *
 * @internal
 */
import type { AssistantMessage, Part } from "@opencode-ai/sdk";
import { REPO_ADMIN_AGENT, WORKTREE_SETUP_PREFIX } from "./agentConstants";
import type { OpencodeClient } from "./client";

type ShellResult = { readonly info: AssistantMessage; readonly parts: ReadonlyArray<Part> };

const isShellResult = (value: unknown): value is ShellResult =>
  typeof value === "object" && value !== null && "parts" in value && Array.isArray((value as { parts: unknown }).parts);

const cache = new Map<OpencodeClient, string | undefined>();
const inFlight = new Map<OpencodeClient, Promise<string | undefined>>();

const runEchoHome = async (client: OpencodeClient): Promise<string | undefined> => {
  const { data: session } = await client.session.create({
    query: { directory: "/" },
    body: { title: `${WORKTREE_SETUP_PREFIX} resolve $HOME` },
  });
  if (session === undefined) return undefined;

  const { data } = await client.session.shell({
    path: { id: session.id },
    query: { directory: "/" },
    body: { agent: REPO_ADMIN_AGENT, command: "echo $HOME" },
  });
  if (data === undefined || !isShellResult(data)) return undefined;

  const toolPart = data.parts.find((p) => p.type === "tool");
  if (toolPart === undefined || toolPart.type !== "tool" || toolPart.state.status !== "completed") return undefined;

  const home = toolPart.state.output.trim();
  return home.startsWith("/") ? home : undefined;
};

export const resolveHomeDir = (client: OpencodeClient): Promise<string | undefined> => {
  if (cache.has(client)) return Promise.resolve(cache.get(client));
  const existing = inFlight.get(client);
  if (existing !== undefined) return existing;

  const promise = runEchoHome(client)
    .then((home) => {
      cache.set(client, home);
      return home;
    })
    .finally(() => {
      inFlight.delete(client);
    });
  inFlight.set(client, promise);
  return promise;
};

/** Expands a leading `~` (bare, or `~/...`) against the server's real
 * `$HOME` — returns the path unchanged if it doesn't start with `~`, and
 * unchanged (not silently dropped) if `$HOME` couldn't be resolved, so a
 * failure here surfaces as the same "not found" the literal `~` already
 * produced rather than a new, different kind of broken. */
export const expandHome = async (client: OpencodeClient, path: string): Promise<string> => {
  if (path !== "~" && !path.startsWith("~/")) return path;

  const home = await resolveHomeDir(client);
  if (home === undefined) return path;

  return path === "~" ? home : `${home}${path.slice(1)}`;
};
