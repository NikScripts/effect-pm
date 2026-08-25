import * as React from "react";
import type { Session } from "@opencode-ai/sdk";
import * as Router from "last-ts/Router";
import { sessionListCache } from "../opencode/cache";
import { client } from "../opencode/client";
import { type SessionDetail, useSessionDetails } from "../opencode/useSessionDetails";
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

const SessionStats = (props: {
  readonly detail: SessionDetail | undefined;
}): React.ReactElement | null => {
  const detail = props.detail;
  if (detail === undefined) return null;
  return (
    <div className="session-stats">
      {detail.status === "busy" || detail.status === "retry" ? (
        <span className="status-active" title={detail.status}>
          <span className="status-dot" />
          {detail.status === "retry" ? "retrying" : "active"}
        </span>
      ) : null}
      <span className="stat-fixed">
        {detail.messageCount}
        {detail.messageCountIsExact ? "" : "+"} msg
      </span>
      {detail.editCount > 0 ? (
        <span className="stat-add stat-fixed">
          {detail.editCount}
          {detail.messageCountIsExact ? "" : "+"} ed
        </span>
      ) : null}
    </div>
  );
};

const SessionCard = (props: {
  readonly session: Session;
  readonly detail: SessionDetail | undefined;
  readonly onOpen: (id: string) => void;
}): React.ReactElement => {
  const { session, detail } = props;
  return (
    <button
      type="button"
      className="session-card"
      style={{ viewTransitionName: `session-${session.id}` }}
      onClick={() => props.onOpen(session.id)}
    >
      <div className="session-card-top">
        <div className="session-card-title">{session.title || session.id}</div>
        {session.parentID !== undefined ? <span className="session-fork-badge">forked</span> : null}
      </div>
      <div className="session-card-preview">{detail?.preview ?? " "}</div>
      <div className="session-card-meta">
        <SessionStats detail={detail} />
        <span className="session-time">{timeAgo(session.time.updated)}</span>
      </div>
    </button>
  );
};

export const SessionList = (): React.ReactElement => {
  const router = Router.useRouter();
  // Stale-while-revalidate: render the cached list instantly (e.g. coming
  // back from a chat) instead of a blank "Loading…" flash, then refresh.
  const [sessions, setSessions] = React.useState<ReadonlyArray<Session>>(
    sessionListCache.sessions ?? [],
  );
  const [loading, setLoading] = React.useState(sessionListCache.sessions === undefined);
  const [error, setError] = React.useState<string | undefined>(undefined);

  const refresh = React.useCallback(async (): Promise<void> => {
    // Only show the loading state on a true cold start — a background
    // refresh of already-cached data shouldn't blank the list out.
    if (sessionListCache.sessions === undefined) setLoading(true);
    setError(undefined);
    try {
      const { data } = await client.session.list();
      sessionListCache.sessions = data ?? [];
      setSessions(data ?? []);
    } catch {
      // Server unreachable / restarting — surface it instead of leaving the
      // "Loading…" state stuck forever with no way to recover.
      setError("Couldn't reach the OpenCode server.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const createSession = async (): Promise<void> => {
    try {
      const { data } = await client.session.create({});
      if (data === undefined) return;
      navigateWithTransition(() => router.go(urls.session(data.id)));
    } catch {
      setError("Couldn't start a session — is the OpenCode server running?");
    }
  };

  const openSession = (id: string): void => {
    navigateWithTransition(() => router.go(urls.session(id)));
  };

  const sorted = [...sessions].sort((a, b) => b.time.updated - a.time.updated);
  const details = useSessionDetails(sorted);

  return (
    <div className="session-list">
      <header className="list-header">
        <h1>Sessions</h1>
        <button type="button" className="new-session-button" onClick={() => void createSession()}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              d="M12 5v14M5 12h14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
            />
          </svg>
          New chat
        </button>
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
      <div className="session-cards">
        {sorted.map((session) => (
          <SessionCard
            key={session.id}
            session={session}
            detail={details.get(session.id)}
            onOpen={openSession}
          />
        ))}
      </div>
      {!loading && error === undefined && sessions.length === 0 ? (
        <p className="hint">No sessions yet — start one above.</p>
      ) : null}
    </div>
  );
};
