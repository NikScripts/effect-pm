/**
 * Durable settings — `~/.config/agent-console/settings.json` on the
 * server's own machine, not just localStorage. localStorage is fast and
 * synchronous (settings.ts reads it directly, no await needed before first
 * render) but it's browser-cache state: cleared site data, a private
 * window, or a different browser loses it completely. This is the copy
 * that survives that — read once on a cold start (no rootDir in
 * localStorage yet) to restore from, written on every change so it never
 * drifts from what's actually configured.
 *
 * There's no generic file-*write* endpoint on the OpenCode server (only
 * list/read) — writing means running a real shell command, same as
 * worktree creation, under the same narrow `repo-admin` agent (its bash
 * permission has one exact pattern for this, see
 * ~/.config/opencode/opencode.jsonc). The command's destination path is a
 * fixed literal string this module controls — never built from anything
 * user-typed — so the permission pattern can be an exact prefix match, the
 * same shape as its `git worktree*`/`echo $HOME` rules.
 *
 * @internal
 */
import type { AssistantMessage, Part } from "@opencode-ai/sdk";
import { REPO_ADMIN_AGENT, WORKTREE_SETUP_PREFIX } from "./agentConstants";
import { client } from "./client";
import { resolveHomeDir } from "./homeDir";

type ShellResult = { readonly info: AssistantMessage; readonly parts: ReadonlyArray<Part> };

const isShellResult = (value: unknown): value is ShellResult =>
  typeof value === "object" && value !== null && "parts" in value && Array.isArray((value as { parts: unknown }).parts);

export type PersistedSettings = {
  readonly rootDir: string;
  readonly worktreeTemplate: string;
};

const SETTINGS_DIR = ".config/agent-console";
const SETTINGS_FILE = "settings.json";

const readFileText = async (directory: string, path: string): Promise<string | undefined> => {
  try {
    const { data } = await client.file.read({ query: { directory, path } });
    return data?.type === "text" ? data.content : undefined;
  } catch {
    return undefined;
  }
};

/** Reads the durable settings file, if the server's `$HOME` resolves and
 * the file exists and parses. Any failure at any step just means "nothing
 * to restore" — this is a best-effort recovery path, not a hard
 * dependency. */
export const readSettingsFile = async (): Promise<PersistedSettings | undefined> => {
  const home = await resolveHomeDir();
  if (home === undefined) return undefined;

  const content = await readFileText(home, `${SETTINGS_DIR}/${SETTINGS_FILE}`);
  if (content === undefined) return undefined;

  try {
    const parsed: unknown = JSON.parse(content);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "rootDir" in parsed &&
      "worktreeTemplate" in parsed &&
      typeof (parsed as { rootDir: unknown }).rootDir === "string" &&
      typeof (parsed as { worktreeTemplate: unknown }).worktreeTemplate === "string"
    ) {
      return parsed as PersistedSettings;
    }
    return undefined;
  } catch {
    return undefined;
  }
};

/** Writes the durable settings file. Best-effort — a failure here (server
 * unreachable, $HOME unresolvable) leaves localStorage as the only copy,
 * same as before this existed; it's not surfaced as a blocking error since
 * every setting still works for the current device/session either way. */
export const writeSettingsFile = async (settings: PersistedSettings): Promise<void> => {
  const home = await resolveHomeDir();
  if (home === undefined) return;

  // A heredoc here (originally `cat > path <<'EOF' ... EOF`) got mangled in
  // practice — confirmed hands-on: the file was created but ended up empty,
  // 0 bytes. Multi-line commands going through an LLM-mediated shell call
  // aren't reliable the way they'd be from a real terminal. Base64 avoids
  // the problem entirely: single line, no newlines, no quoting to get
  // wrong (base64 output is alphanumeric plus `+/=`, safe inside single
  // quotes verbatim).
  const json = JSON.stringify(settings, null, 2);
  const base64 = btoa(String.fromCharCode(...new TextEncoder().encode(json)));
  const command =
    `mkdir -p "$HOME/${SETTINGS_DIR}" && ` +
    `printf '%s' '${base64}' | base64 -d > "$HOME/${SETTINGS_DIR}/${SETTINGS_FILE}"`;

  try {
    const { data: session } = await client.session.create({
      query: { directory: home },
      body: { title: `${WORKTREE_SETUP_PREFIX} save settings` },
    });
    if (session === undefined) return;

    const { data } = await client.session.shell({
      path: { id: session.id },
      query: { directory: home },
      body: { agent: REPO_ADMIN_AGENT, command },
    });
    if (data === undefined || !isShellResult(data)) return;
  } catch {
    // Best-effort — see the export's own comment.
  }
};
