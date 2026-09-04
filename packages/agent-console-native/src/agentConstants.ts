/**
 * Ported verbatim from packages/agent-console/src/opencode/agentConstants.ts
 * — shared by homeDir.ts (worktree.ts/settingsFile.ts equivalents don't
 * exist here yet). Kept in its own leaf module for the same reason as the
 * web app's copy: avoids an import cycle once this is used from more than
 * one place.
 *
 * @internal
 */

/** Every session title created by a background operation (worktree setup,
 * settings-file writes) — session lists filter these out, they're not
 * something the owner should see mixed into their chats. */
export const WORKTREE_SETUP_PREFIX = "[worktree-setup]";

export const REPO_ADMIN_AGENT = "repo-admin";
