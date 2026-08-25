/**
 * Thin wrapper over `@opencode-ai/sdk` — the OpenCode server this client talks to,
 * and the agent profile (see ../../opencode.jsonc) every session is created under.
 *
 * @internal
 */
import { createOpencodeClient } from "@opencode-ai/sdk/client";

const baseUrl = `http://${import.meta.env.VITE_OPENCODE_HOST ?? "127.0.0.1"}:${
  import.meta.env.VITE_OPENCODE_PORT ?? "4096"
}`;

export const client = createOpencodeClient({ baseUrl });

/** Every session created by this client runs under the no-edit "console" agent. */
export const AGENT = "console";
