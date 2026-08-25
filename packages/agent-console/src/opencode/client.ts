/**
 * Thin wrapper over `@opencode-ai/sdk` — the OpenCode server this client talks to,
 * and the agent profile (see ../../opencode.jsonc) every session is created under.
 *
 * Default `baseUrl` is the relative `/opencode` path, proxied to the local
 * opencode server by vite.config.ts's dev-server proxy — NOT an absolute
 * `127.0.0.1` URL. The browser resolves a relative URL against whatever origin
 * it loaded the page from (a Tailscale IP on a phone, `localhost` on this
 * machine); `127.0.0.1` there would mean "that device itself", not this one,
 * and opencode's own server only binds to loopback by default anyway — the
 * proxy is what makes it reachable at all from another device.
 *
 * @internal
 */
import { createOpencodeClient } from "@opencode-ai/sdk/client";

const baseUrl = import.meta.env.VITE_OPENCODE_BASE_URL ?? "/opencode";

export const client = createOpencodeClient({ baseUrl });

/** Every session created by this client runs under the no-edit "console" agent. */
export const AGENT = "console";
