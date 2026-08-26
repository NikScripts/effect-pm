/**
 * Shared by worktree.ts, homeDir.ts, and settingsFile.ts — kept in its own
 * leaf module (no imports) rather than re-exported from worktree.ts,
 * which would create a cycle: worktree.ts imports settings.ts, and
 * settingsFile.ts (imported by settings.ts) needs these same two
 * constants.
 *
 * @internal
 */

/** Every session title created by a background operation (worktree setup,
 * settings-file writes) — session lists filter these out, they're not
 * something the owner should see mixed into their chats. */
export const WORKTREE_SETUP_PREFIX = "[worktree-setup]";

export const REPO_ADMIN_AGENT = "repo-admin";
