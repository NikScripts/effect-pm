/**
 * Resolves the server's `$HOME`, once, for expanding a `~/`-prefixed root
 * folder. Confirmed hands-on: the file API's `directory` param is a literal
 * filesystem path — passing it `~/Coding` isn't shorthand there, it's just
 * a directory named `~` that doesn't exist, and the server 500s. The
 * browser has no OS access to expand it itself, so this asks the
 * `repo-admin` agent (already the one narrow, permission-scoped agent
 * agent-console uses for anything shell-adjacent — see worktree.ts) to
 * read it server-side, once, and caches the result for the page's lifetime.
 *
 * @internal
 */
import type { AssistantMessage, Part } from "@opencode-ai/sdk";
import { client } from "./client";
import { REPO_ADMIN_AGENT, WORKTREE_SETUP_PREFIX } from "./worktree";

type ShellResult = { readonly info: AssistantMessage; readonly parts: ReadonlyArray<Part> };

const isShellResult = (value: unknown): value is ShellResult =>
  typeof value === "object" && value !== null && "parts" in value && Array.isArray((value as { parts: unknown }).parts);

let cached: string | undefined;
let inFlight: Promise<string | undefined> | undefined;

const runEchoHome = async (): Promise<string | undefined> => {
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

export const resolveHomeDir = (): Promise<string | undefined> => {
  if (cached !== undefined) return Promise.resolve(cached);
  if (inFlight !== undefined) return inFlight;

  inFlight = runEchoHome()
    .then((home) => {
      cached = home;
      return home;
    })
    .finally(() => {
      inFlight = undefined;
    });
  return inFlight;
};

/** Expands a leading `~` (bare, or `~/...`) against the server's real
 * `$HOME` — returns the path unchanged if it doesn't start with `~`, and
 * unchanged (not silently dropped) if `$HOME` couldn't be resolved, so a
 * failure here surfaces as the same "not found" the literal `~` already
 * produced rather than a new, different kind of broken. */
export const expandHome = async (path: string): Promise<string> => {
  if (path !== "~" && !path.startsWith("~/")) return path;

  const home = await resolveHomeDir();
  if (home === undefined) return path;

  return path === "~" ? home : `${home}${path.slice(1)}`;
};
