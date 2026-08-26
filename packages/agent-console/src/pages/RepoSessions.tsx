/**
 * `/repo/:name` — all of one repo's sessions, each card showing its
 * worktree. A pill row at the top (one per worktree in this repo, +
 * implicit "All") filters the list without navigating away — switching
 * between worktree sessions within a repo is frequent enough to want that
 * without a page transition each time.
 *
 * @internal
 */
import { ChevronLeft } from "lucide-react";
import * as React from "react";
import type { Session } from "@opencode-ai/sdk";
import * as Router from "last-ts/Router";
import { NewSessionPicker } from "../components/NewSessionPicker";
import { SessionCard } from "../components/SessionCard";
import { sessionListCache } from "../opencode/cache";
import { client } from "../opencode/client";
import { MAIN_WORKTREE, NO_WORKTREE, displayWorktree, groupByRepo, matchSession } from "../opencode/repoGrouping";
import type { ScannedRepo } from "../opencode/repoScan";
import { getCachedRepos, isStale, rescan } from "../opencode/repoScanCache";
import { getRootDir } from "../opencode/settings";
import { useSessionDetails } from "../opencode/useSessionDetails";
import { urls } from "../site";
import { navigateWithTransition } from "../viewTransition";
import { WORKTREE_SETUP_PREFIX } from "../opencode/worktree";

const ALL = "__all__";

export const RepoSessions = (props: { readonly name: string }): React.ReactElement => {
  const router = Router.useRouter();
  const rootDir = getRootDir();

  const [sessions, setSessions] = React.useState<ReadonlyArray<Session>>(
    sessionListCache.sessions ?? [],
  );
  const [loading, setLoading] = React.useState(sessionListCache.sessions === undefined);
  const [filter, setFilter] = React.useState<string>(ALL);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [scanned, setScanned] = React.useState<ReadonlyArray<ScannedRepo> | undefined>(
    getCachedRepos(),
  );

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (sessionListCache.sessions === undefined) setLoading(true);
      try {
        const { data } = await client.session.list();
        const visible = (data ?? []).filter((s) => !s.title.startsWith(WORKTREE_SETUP_PREFIX));
        if (!cancelled) {
          sessionListCache.sessions = visible;
          setSessions(visible);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (rootDir === undefined) return;
    if (scanned === undefined || isStale()) {
      rescan(rootDir)
        .then(setScanned)
        .catch(() => {
          // Non-fatal — sessions still show, ungrouped, via the fallback bucket.
        });
    }
  }, [rootDir]); // eslint-disable-line react-hooks/exhaustive-deps -- one-shot on mount

  const openSession = (id: string): void => {
    navigateWithTransition(() => router.go(urls.session(id)));
  };

  const goBack = (): void => {
    navigateWithTransition(() => router.go(urls.sessions()));
  };

  const group = groupByRepo(sessions, scanned ?? []).find((g) => g.repo === props.name);
  const repoSessions = group?.sessions ?? [];
  const worktreeNames = group === undefined ? [] : [...group.worktrees.keys()].filter((wt) => wt !== MAIN_WORKTREE);
  const filtered =
    filter === ALL
      ? repoSessions
      : repoSessions.filter((s) => matchSession(s.directory, scanned ?? []).worktree === filter);
  // useSessionDetails must run on every render (Rules of Hooks) — the
  // rootDir-undefined early return has to come after it, not before.
  const details = useSessionDetails(repoSessions);

  if (rootDir === undefined) return <p className="hint">Set a root folder in Setup first.</p>;

  return (
    <div className="repo-sessions-page">
      <header className="chat-header">
        <button type="button" className="back-link" aria-label="Back to home" onClick={goBack}>
          <ChevronLeft size={20} strokeWidth={2.2} aria-hidden="true" />
        </button>
        <span className="chat-title">{props.name}</span>
        <button type="button" className="new-session-button" onClick={() => setPickerOpen(true)}>
          New chat
        </button>
      </header>

      {worktreeNames.length > 0 ? (
        <div className="worktree-pills">
          <button
            type="button"
            className={`worktree-pill${filter === ALL ? " worktree-pill-active" : ""}`}
            onClick={() => setFilter(ALL)}
          >
            All
          </button>
          {worktreeNames.map((wt) => (
            <button
              key={wt}
              type="button"
              className={`worktree-pill${filter === wt ? " worktree-pill-active" : ""}`}
              onClick={() => setFilter(wt)}
            >
              {wt === NO_WORKTREE ? "(none)" : wt}
            </button>
          ))}
        </div>
      ) : null}

      {loading ? <p className="hint">Loading…</p> : null}
      {!loading && filtered.length === 0 ? <p className="hint">No sessions here yet.</p> : null}

      <div className="session-cards">
        {filtered.map((session) => {
          const { worktree } = matchSession(session.directory, scanned ?? []);
          return (
            <SessionCard
              key={session.id}
              session={session}
              detail={details.get(session.id)}
              onOpen={openSession}
              worktree={displayWorktree(worktree)}
            />
          );
        })}
      </div>

      {pickerOpen ? (
        <NewSessionPicker onClose={() => setPickerOpen(false)} initialRepo={props.name} />
      ) : null}
    </div>
  );
};
