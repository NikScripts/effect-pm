/**
 * New-session flow: pick a repo, then pick an existing worktree or create a
 * new one (auto-named if left blank), then create the chat session scoped
 * to that worktree's directory. Repo/worktree options come from the real
 * repoScan.ts result (git worktree list), not an assumed layout.
 *
 * @internal
 */
import { X } from "lucide-react";
import * as React from "react";
import * as Router from "last-ts/Router";
import { client } from "../opencode/client";
import type { ScannedRepo } from "../opencode/repoScan";
import { getCachedRepos, isStale, rescan } from "../opencode/repoScanCache";
import { getRootDir } from "../opencode/settings";
import { randomSlug } from "../opencode/slug";
import { createWorktree } from "../opencode/worktree";
import { urls } from "../site";
import { navigateWithTransition } from "../viewTransition";

type Step = { readonly step: "repo" } | { readonly step: "worktree"; readonly repo: string };

export const NewSessionPicker = (props: {
  readonly onClose: () => void;
  /** Pre-selected repo — used from RepoSessions, where the repo is already known. */
  readonly initialRepo?: string;
}): React.ReactElement => {
  const router = Router.useRouter();
  const rootDir = getRootDir();

  const [state, setState] = React.useState<Step>(
    props.initialRepo !== undefined ? { step: "worktree", repo: props.initialRepo } : { step: "repo" },
  );
  const [scanned, setScanned] = React.useState<ReadonlyArray<ScannedRepo> | undefined>(
    getCachedRepos(),
  );
  const [scanning, setScanning] = React.useState(false);
  const [newWorktreeName, setNewWorktreeName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>(undefined);

  React.useEffect(() => {
    if (rootDir === undefined) return;
    if (scanned === undefined || isStale()) {
      setScanning(true);
      rescan(rootDir)
        .then(setScanned)
        .catch((err: unknown) => setError(err instanceof Error ? err.message : "Couldn't scan for repos."))
        .finally(() => setScanning(false));
    }
  }, [rootDir]); // eslint-disable-line react-hooks/exhaustive-deps -- one-shot on mount, not on every `scanned` update

  const openSession = (id: string): void => {
    navigateWithTransition(() => router.go(urls.session(id)));
  };

  const createInDirectory = async (directory: string): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      const { data } = await client.session.create({ query: { directory } });
      if (data === undefined) throw new Error("no session returned");
      props.onClose();
      openSession(data.id);
    } catch {
      setError("Couldn't start a session — is the OpenCode server running?");
    } finally {
      setBusy(false);
    }
  };

  const createNewWorktree = async (repo: string, mainCheckoutPath: string): Promise<void> => {
    if (rootDir === undefined) return;
    const name = newWorktreeName.trim() || randomSlug();
    setBusy(true);
    setError(undefined);
    try {
      const path = await createWorktree(rootDir, repo, mainCheckoutPath, name);
      await createInDirectory(path);
    } catch {
      setError(`Couldn't create worktree "${name}".`);
      setBusy(false);
    }
  };

  if (rootDir === undefined) {
    // Shouldn't happen — Home redirects to /setup first — but don't crash if it does.
    return (
      <div className="picker-overlay" onClick={props.onClose}>
        <div className="picker-sheet" onClick={(e) => e.stopPropagation()}>
          <p className="hint">Set a root folder in Setup first.</p>
        </div>
      </div>
    );
  }

  const repos = scanned ?? [];
  const repoNames = repos.map((r) => r.repo);
  const worktrees = state.step === "worktree" ? (repos.find((r) => r.repo === state.repo)?.worktrees ?? []) : [];

  return (
    <div className="picker-overlay" onClick={props.onClose}>
      <div className="picker-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="picker-header">
          <h2>{state.step === "repo" ? "Pick a repo" : `New chat in ${state.repo}`}</h2>
          <button type="button" className="picker-close" onClick={props.onClose} aria-label="Close">
            <X size={18} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>

        {error !== undefined ? <div className="error-banner">{error}</div> : null}

        {state.step === "repo" ? (
          scanning && repoNames.length === 0 ? (
            <p className="hint">Scanning for repos…</p>
          ) : repoNames.length === 0 ? (
            <p className="hint">No repos found under the configured root folder.</p>
          ) : (
            <div className="picker-list">
              {repoNames.map((repo) => (
                <button
                  key={repo}
                  type="button"
                  className="picker-item"
                  onClick={() => setState({ step: "worktree", repo })}
                >
                  {repo}
                </button>
              ))}
            </div>
          )
        ) : (
          <>
            {worktrees.length > 0 ? (
              <div className="picker-list">
                {worktrees.map((wt) => (
                  <button
                    key={wt.path}
                    type="button"
                    className="picker-item"
                    disabled={busy}
                    onClick={() => void createInDirectory(wt.path)}
                  >
                    {wt.name}
                  </button>
                ))}
              </div>
            ) : (
              <p className="hint">No worktrees found — create one below.</p>
            )}
            <div className="picker-new-worktree">
              <input
                type="text"
                placeholder="New worktree name (blank = auto)"
                value={newWorktreeName}
                onChange={(e) => setNewWorktreeName(e.target.value)}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                disabled={busy}
              />
              <button
                type="button"
                disabled={busy || worktrees.length === 0}
                onClick={() => {
                  if (state.step !== "worktree") return;
                  const main = worktrees.find((w) => w.isMain) ?? worktrees[0];
                  if (main === undefined) return;
                  void createNewWorktree(state.repo, main.path);
                }}
              >
                {busy ? "Creating…" : "+ New worktree"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
