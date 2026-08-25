/**
 * Root folder, new-worktree path template, and a manual rescan trigger —
 * the scan itself (repoScan.ts) is the source of truth for what repos and
 * worktrees actually exist; nothing here assumes a directory layout, the
 * template only controls where a *new* worktree gets created.
 *
 * @internal
 */
import * as React from "react";
import * as Router from "last-ts/Router";
import {
  DEFAULT_WORKTREE_TEMPLATE,
  getLastScanAt,
  getRootDir,
  getWorktreeTemplate,
  setRootDir,
  setWorktreeTemplate,
} from "../opencode/settings";
import { rescan } from "../opencode/repoScanCache";
import { urls } from "../site";
import { navigateWithTransition } from "../viewTransition";

const timeAgo = (ms: number): string => {
  const seconds = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

export const Settings = (): React.ReactElement => {
  const router = Router.useRouter();
  const [rootDir, setRootDirValue] = React.useState(getRootDir() ?? "");
  const [template, setTemplateValue] = React.useState(getWorktreeTemplate());
  const [lastScanAt, setLastScanAtState] = React.useState(getLastScanAt());
  const [scanning, setScanning] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>(undefined);

  const goBack = (): void => {
    navigateWithTransition(() => router.go(urls.sessions()));
  };

  const saveRootDir = (): void => {
    const trimmed = rootDir.trim();
    if (trimmed.length === 0) return;
    setRootDir(trimmed);
  };

  const saveTemplate = (): void => {
    const trimmed = template.trim();
    setWorktreeTemplate(trimmed.length === 0 ? DEFAULT_WORKTREE_TEMPLATE : trimmed);
  };

  const runRescan = async (): Promise<void> => {
    const dir = getRootDir();
    if (dir === undefined) return;
    setScanning(true);
    setError(undefined);
    try {
      await rescan(dir);
      setLastScanAtState(getLastScanAt());
    } catch {
      setError("Rescan failed — check the OpenCode server is reachable.");
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="settings-page">
      <header className="chat-header">
        <button type="button" className="back-link" aria-label="Back" onClick={goBack}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path
              d="M15 6l-6 6 6 6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <span className="chat-title">Settings</span>
      </header>

      <div className="settings-body">
        <section className="settings-section">
          <h2 className="section-heading">Root folder</h2>
          <p className="hint">Where repos are discovered from.</p>
          <div className="settings-field">
            <input
              type="text"
              value={rootDir}
              onChange={(e) => setRootDirValue(e.target.value)}
              onBlur={saveRootDir}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
          </div>
        </section>

        <section className="settings-section">
          <h2 className="section-heading">New-worktree path</h2>
          <p className="hint">
            Used only when creating a new worktree — placeholders: <code>{"{root}"}</code>,{" "}
            <code>{"{repo}"}</code>, <code>{"{name}"}</code>. Existing repos/worktrees are
            discovered by scanning, never assumed to follow this.
          </p>
          <div className="settings-field">
            <input
              type="text"
              value={template}
              onChange={(e) => setTemplateValue(e.target.value)}
              onBlur={saveTemplate}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
          </div>
        </section>

        <section className="settings-section">
          <h2 className="section-heading">Repo scan</h2>
          <p className="hint">
            {lastScanAt === undefined ? "Never scanned." : `Last scanned ${timeAgo(lastScanAt)}.`} Runs
            automatically when stale, or trigger one now.
          </p>
          {error !== undefined ? <div className="error-banner">{error}</div> : null}
          <button type="button" className="settings-rescan-button" disabled={scanning} onClick={() => void runRescan()}>
            {scanning ? "Scanning…" : "Rescan repos"}
          </button>
        </section>
      </div>
    </div>
  );
};
