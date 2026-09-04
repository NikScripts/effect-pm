/**
 * OpenCode client — unlike agent-console's web version, `baseUrl` isn't a
 * fixed relative path proxied by a dev server; it's built from whatever
 * server address the user configured (settings.ts), since a native app has
 * no "same origin" to resolve a relative path against.
 *
 * Uses `expo/fetch`, not the global `fetch`, for the `client.event.subscribe()`
 * SSE stream (session chat's real-time transcript) — React Native's default
 * fetch doesn't expose a streamable `response.body`, which the SDK's event
 * stream depends on to read Server-Sent Events as they arrive. `FetchResponse`
 * (expo/fetch's response type) explicitly `implements Response`, so it's a
 * direct, cast-free fit for the SDK's `fetch` config slot.
 *
 * @internal
 */
import { createOpencodeClient } from "@opencode-ai/sdk/client";
import { fetch as expoFetch } from "expo/fetch";

/** Accepts "host:port", "http://host:port", with or without a trailing
 * slash — normalizes to a bare "http://host:port" base URL. Defaults to
 * http:// (not https://) since this always points at a local/Tailscale
 * opencode server, never a public host. */
export const normalizeServerAddress = (input: string): string => {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return `http://${trimmed}`;
};

export const makeClient = (serverAddress: string) =>
  createOpencodeClient({ baseUrl: normalizeServerAddress(serverAddress), fetch: (request) => expoFetch(request) });

export type OpencodeClient = ReturnType<typeof makeClient>;

/** Every session created by this client runs under the no-edit "console" agent. */
export const AGENT = "console";
