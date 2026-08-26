/**
 * Front page: "Recent" (most-recent sessions across every repo/worktree
 * combined — the owner regularly switches between worktrees *and* repos,
 * so this surfaces whatever's most recent regardless of where it lives) +
 * a repo list below (deliberate browsing, sorted by most-recent activity).
 *
 * Repo/worktree grouping comes from a real filesystem+git scan
 * (repoScan.ts / repoScanCache.ts), not an assumed directory layout — the
 * cache is read synchronously so this renders instantly, then a rescan
 * kicks off in the background if the cache is missing or stale.
 *
 * @internal
 */
import { ArrowUp, ChevronRight, Folder, FolderPlus, Plus, Search, Settings as SettingsIcon } from "lucide-react";
import * as React from "react";
import type { Session } from "@opencode-ai/sdk";
import * as Router from "last-ts/Router";
import { NewSessionPicker } from "../components/NewSessionPicker";
import { SessionCard } from "../components/SessionCard";
import { sessionListCache } from "../opencode/cache";
import { client } from "../opencode/client";
import { displayWorktree, groupByRepo, matchSession } from "../opencode/repoGrouping";
import type { ScannedRepo } from "../opencode/repoScan";
import { getCachedRepos, isStale, rescan } from "../opencode/repoScanCache";
import { getRootDir } from "../opencode/settings";
import { useSessionDetails } from "../opencode/useSessionDetails";
import { urls } from "../site";
import { navigateWithTransition } from "../viewTransition";
import { WORKTREE_SETUP_PREFIX } from "../opencode/worktree";

// Upper bound — CSS shows only the first 2 on mobile (cards are tall enough
// now, with repo+worktree+context, that 4 stacked would run long) and all 4
// from the 720px desktop breakpoint up (styles.css).
const RECENT_COUNT = 4;

export const Home = (): React.ReactElement => {
  const router = Router.useRouter();
  const rootDir = getRootDir();

  const [sessions, setSessions] = React.useState<ReadonlyArray<Session>>(
    sessionListCache.sessions ?? [],
  );
  const [loading, setLoading] = React.useState(sessionListCache.sessions === undefined);
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [scanned, setScanned] = React.useState<ReadonlyArray<ScannedRepo> | undefined>(
    getCachedRepos(),
  );
  const [scanning, setScanning] = React.useState(false);
  const [scanError, setScanError] = React.useState<string | undefined>(undefined);

  const refresh = React.useCallback(async (): Promise<void> => {
    if (sessionListCache.sessions === undefined) setLoading(true);
    setError(undefined);
    try {
      const { data } = await client.session.list();
      const visible = (data ?? []).filter((s) => !s.title.startsWith(WORKTREE_SETUP_PREFIX));
      sessionListCache.sessions = visible;
      setSessions(visible);
    } catch {
      setError("Couldn't reach the OpenCode server.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const runRescan = React.useCallback((dir: string): void => {
    setScanning(true);
    rescan(dir)
      .then((repos) => {
        setScanned(repos);
        setScanError(undefined);
      })
      .catch((err: unknown) => {
        // Sessions still show, ungrouped via the fallback bucket — but say so
        // out loud. Silently swallowing this is exactly what made a hard
        // scan failure (unreachable/unresolvable root dir) look identical to
        // "scanned fine, nothing to group" — no way to tell the two apart
        // from the UI alone.
        setScanError(err instanceof Error ? err.message : "Couldn't scan for repos.");
      })
      .finally(() => setScanning(false));
  }, []);

  React.useEffect(() => {
    if (rootDir === undefined) {
      navigateWithTransition(() => router.go(urls.setup()));
      return;
    }
    if (scanned === undefined || isStale()) runRescan(rootDir);
  }, [rootDir, scanned, runRescan, router]);

  const openSession = (id: string): void => {
    navigateWithTransition(() => router.go(urls.session(id)));
  };

  const openRepo = (repo: string): void => {
    navigateWithTransition(() => router.go(urls.repo(repo)));
  };

  const sortedByRecent = [...sessions].sort((a, b) => b.time.updated - a.time.updated);
  const recent = sortedByRecent.slice(0, RECENT_COUNT);
  const details = useSessionDetails(sortedByRecent);
  const groups = groupByRepo(sessions, scanned ?? []);
  const knownGroups = groups.filter((g) => g.isKnownRepo);
  const otherGroups = groups.filter((g) => !g.isKnownRepo);

  if (rootDir === undefined) return <p className="hint">Redirecting to setup…</p>;

  return (
    <div className="home-page">
      <header className="home-topbar">
        <button
          type="button"
          className="topbar-avatar"
          aria-label="Settings"
          onClick={() => navigateWithTransition(() => router.go(urls.settings()))}
        >
          <SettingsIcon size={20} strokeWidth={1.8} aria-hidden="true" />
        </button>
        <div className="topbar-actions">
          {/* Not wired yet — no search feature exists. Placeholder to match the layout. */}
          <button type="button" className="topbar-icon-button" aria-label="Search">
            <Search size={19} strokeWidth={1.8} aria-hidden="true" />
          </button>
          {/* Not wired yet — cloning/initializing a brand-new repo isn't built; this is
              for that, distinct from the bottom bar (a session in an *existing* repo). */}
          <button type="button" className="topbar-icon-button" aria-label="New repo or empty project">
            <FolderPlus size={19} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
      </header>

      {loading ? <p className="hint">Loading…</p> : null}
      {error !== undefined ? (
        <div className="error-banner">
          {error}{" "}
          <button type="button" onClick={() => void refresh()}>
            Retry
          </button>
        </div>
      ) : null}

      {!loading && error === undefined && sessions.length === 0 ? (
        <p className="hint">No sessions yet — start one above.</p>
      ) : null}

      {scanError !== undefined ? (
        <div className="error-banner">
          {scanError} Sessions below are shown ungrouped until this is fixed.{" "}
          <button type="button" onClick={() => runRescan(rootDir)}>
            Retry
          </button>
        </div>
      ) : null}

      {recent.length > 0 ? (
        <section className="recent-section">
          <h2 className="section-heading">Recent</h2>
          <div className="session-cards">
            {recent.map((session) => {
              const { repo, worktree } = matchSession(session.directory, scanned ?? []);
              return (
                <SessionCard
                  key={session.id}
                  session={session}
                  detail={details.get(session.id)}
                  onOpen={openSession}
                  repo={repo}
                  worktree={displayWorktree(worktree)}
                />
              );
            })}
          </div>
        </section>
      ) : null}

      {knownGroups.length > 0 ? (
        <section className="repo-list-section">
          <h2 className="section-heading">
            Workspaces
            {scanning ? <span className="scanning-hint"> — scanning…</span> : null}
          </h2>
          <div className="workspace-list">
            {knownGroups.map((group) => (
              <button
                key={group.repo}
                type="button"
                className="workspace-row"
                onClick={() => openRepo(group.repo)}
              >
                <Folder size={18} strokeWidth={1.6} aria-hidden="true" className="workspace-row-icon" />
                <span className="workspace-row-name">{group.repo}</span>
                <span className="workspace-row-count">{group.sessions.length}</span>
                <ChevronRight size={18} strokeWidth={1.8} aria-hidden="true" className="workspace-row-chevron" />
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {otherGroups.length > 0 ? (
        <section className="repo-list-section">
          <h2 className="section-heading">Other folders</h2>
          <div className="workspace-list">
            {otherGroups.map((group) => (
              <button
                key={group.repo}
                type="button"
                className="workspace-row"
                onClick={() => openRepo(group.repo)}
              >
                <Folder size={18} strokeWidth={1.6} aria-hidden="true" className="workspace-row-icon" />
                <span className="workspace-row-name">{group.repo}</span>
                <span className="workspace-row-count">{group.sessions.length}</span>
                <ChevronRight size={18} strokeWidth={1.8} aria-hidden="true" className="workspace-row-chevron" />
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <button type="button" className="home-composer-bar" onClick={() => setPickerOpen(true)}>
        <span className="home-composer-plus" aria-hidden="true">
          <Plus size={16} strokeWidth={2.2} />
        </span>
        <span className="home-composer-placeholder">Plan, ask, build…</span>
        <span className="home-composer-send" aria-hidden="true">
          <ArrowUp size={16} strokeWidth={2.4} />
        </span>
      </button>

      {pickerOpen ? <NewSessionPicker onClose={() => setPickerOpen(false)} /> : null}
    </div>
  );
};
