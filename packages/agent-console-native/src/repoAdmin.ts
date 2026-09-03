/**
 * Short-lived `repo-admin` shell sessions — shared by worktree create,
 * repo init/clone, and folder mkdir so each caller doesn’t re-open the
 * same session/shell boilerplate.
 *
 * @internal
 */
import type { AssistantMessage, Part } from "@opencode-ai/sdk";
import { REPO_ADMIN_AGENT, WORKTREE_SETUP_PREFIX } from "./agentConstants";
import type { OpencodeClient } from "./client";

type ShellResult = { readonly info: AssistantMessage; readonly parts: ReadonlyArray<Part> };

const isShellResult = (value: unknown): value is ShellResult =>
  typeof value === "object" && value !== null && "parts" in value && Array.isArray((value as { parts: unknown }).parts);

export class RepoAdminError extends Error {}

/** Run `command` under `directory` via repo-admin; returns trimmed stdout. */
export const runRepoAdmin = async (
  client: OpencodeClient,
  directory: string,
  command: string,
  title: string,
): Promise<string> => {
  const { data: session } = await client.session.create({
    query: { directory },
    body: { title: `${WORKTREE_SETUP_PREFIX} ${title}` },
  });
  if (session === undefined) {
    throw new RepoAdminError(`Couldn't start a setup session for "${title}".`);
  }

  const { data } = await client.session.shell({
    path: { id: session.id },
    query: { directory },
    body: { agent: REPO_ADMIN_AGENT, command },
  });
  if (data === undefined || !isShellResult(data)) {
    throw new RepoAdminError(`Command failed: ${command}`);
  }

  const toolPart = data.parts.find((p) => p.type === "tool");
  if (toolPart === undefined || toolPart.type !== "tool") {
    throw new RepoAdminError(`Command produced no output: ${command}`);
  }
  if (toolPart.state.status !== "completed") {
    const error = toolPart.state.status === "error" ? toolPart.state.error : "failed";
    throw new RepoAdminError(error);
  }
  return toolPart.state.output.trim();
};
