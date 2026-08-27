/**
 * Module-level (not React state) cache — survives unmount/remount as the
 * user navigates home -> chat -> back. Ported from
 * packages/agent-console/src/opencode/cache.ts (transcriptCache only; the
 * web version's session-list/detail caches have native equivalents already
 * in repoScanCache.ts/sessionCache.ts).
 *
 * @internal
 */
import type { Transcript } from "./useSessionStream";

export const transcriptCache = new Map<string, Transcript>();
