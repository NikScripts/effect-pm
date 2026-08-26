/**
 * The bottom-sheet composer for starting a new session — modeled on the
 * Cursor iOS app's own "plan, ask, build" sheet: a repo/worktree selector
 * row up top (tap to change it via the existing repo -> worktree list),
 * a real text composer, and a send button that's disabled until there's
 * text. Sending creates the session *and* delivers the typed text as its
 * first message in one motion, rather than dropping you into an empty chat.
 *
 * Repo/worktree options still come from the real repoScan.ts result (git
 * worktree list), not an assumed layout.
 *
 * @internal
 */
import { ArrowUp, ChevronDown, Plus, X } from "lucide-react";
import * as React from "react";
import * as Router from "last-ts/Router";
import { AGENT, client } from "../opencode/client";
import { type ModelOption, getDefaultModel, listModels } from "../opencode/models";
import type { ScannedRepo, ScannedWorktree } from "../opencode/repoScan";
import { getCachedRepos, isStale, rescan } from "../opencode/repoScanCache";
import { getRootDir } from "../opencode/settings";
import { randomSlug } from "../opencode/slug";
import { createWorktree } from "../opencode/worktree";
import { urls } from "../site";
import { navigateWithTransition } from "../viewTransition";

type Selection = { readonly repo: string; readonly worktree: ScannedWorktree };

type SubPickerStep =
  | { readonly step: "repo" }
  | { readonly step: "worktree"; readonly repo: string }
  | { readonly step: "model" };

export const NewSessionPicker = (props: {
  readonly onClose: () => void;
  /** Pre-selected repo — used from RepoSessions, where the repo is already known. */
  readonly initialRepo?: string;
}): React.ReactElement => {
  const router = Router.useRouter();
  const rootDir = getRootDir();

  const [scanned, setScanned] = React.useState<ReadonlyArray<ScannedRepo> | undefined>(
    getCachedRepos(),
  );
  const [scanning, setScanning] = React.useState(false);
  const [selection, setSelection] = React.useState<Selection | undefined>(undefined);
  const [subPicker, setSubPicker] = React.useState<SubPickerStep | undefined>(undefined);
  const [newWorktreeName, setNewWorktreeName] = React.useState("");
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [models, setModels] = React.useState<ReadonlyArray<ModelOption>>([]);
  const [selectedModel, setSelectedModel] = React.useState<ModelOption | undefined>(undefined);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    listModels().then((options) => {
      setModels(options);
      setSelectedModel((current) => current ?? getDefaultModel());
    });
  }, []);

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

  // Default selection once repos are known: the pre-selected repo (from
  // RepoSessions) or whichever repo the scan found first, each pointed at
  // its main checkout — mirrors the reference sheet always opening with
  // *something* already chosen, never empty.
  React.useEffect(() => {
    if (selection !== undefined || scanned === undefined) return;
    const repo = props.initialRepo !== undefined ? scanned.find((r) => r.repo === props.initialRepo) : scanned[0];
    const main = repo?.worktrees.find((w) => w.isMain) ?? repo?.worktrees[0];
    if (repo !== undefined && main !== undefined) setSelection({ repo: repo.repo, worktree: main });
  }, [scanned, selection, props.initialRepo]);

  React.useLayoutEffect(() => {
    const el = textareaRef.current;
    if (el === null) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  const openSession = (id: string): void => {
    navigateWithTransition(() => router.go(urls.session(id)));
  };

  const send = async (): Promise<void> => {
    const value = text.trim();
    if (value.length === 0 || selection === undefined || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const { data } = await client.session.create({ query: { directory: selection.worktree.path } });
      if (data === undefined) throw new Error("no session returned");
      await client.session.promptAsync({
        path: { id: data.id },
        body: {
          agent: AGENT,
          parts: [{ type: "text", text: value }],
          model:
            selectedModel === undefined
              ? undefined
              : { providerID: selectedModel.providerID, modelID: selectedModel.modelID },
        },
      });
      props.onClose();
      openSession(data.id);
    } catch {
      setError("Couldn't start a session — is the OpenCode server running?");
      setBusy(false);
    }
  };

  const repoNames = (scanned ?? []).map((r) => r.repo);
  const worktreesForSubPicker =
    subPicker?.step === "worktree" ? ((scanned ?? []).find((r) => r.repo === subPicker.repo)?.worktrees ?? []) : [];

  const createNewWorktree = async (repo: string, mainCheckoutPath: string): Promise<void> => {
    if (rootDir === undefined) return;
    const name = newWorktreeName.trim() || randomSlug();
    setBusy(true);
    setError(undefined);
    try {
      const path = await createWorktree(rootDir, repo, mainCheckoutPath, name);
      setSelection({ repo, worktree: { name, path, isMain: false } });
      setNewWorktreeName("");
      setSubPicker(undefined);
    } catch {
      setError(`Couldn't create worktree "${name}".`);
    } finally {
      setBusy(false);
    }
  };

  if (rootDir === undefined) {
    // Shouldn't happen — Home redirects to /setup first — but don't crash if it does.
    return (
      <div className="picker-overlay" onClick={props.onClose}>
        <div className="composer-sheet" onClick={(e) => e.stopPropagation()}>
          <p className="hint">Set a root folder in Setup first.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="picker-overlay" onClick={props.onClose}>
      <div className="composer-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="composer-sheet-handle" />

        {error !== undefined ? <div className="error-banner">{error}</div> : null}

        <div className="composer-sheet-selector-row">
          <button
            type="button"
            className="composer-selector"
            disabled={scanned === undefined}
            onClick={() => setSubPicker({ step: "repo" })}
          >
            {selection === undefined
              ? scanning
                ? "Scanning…"
                : "Pick a repo"
              : `${selection.repo} ${selection.worktree.isMain ? "main" : selection.worktree.name}`}
            <ChevronDown size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>

        <textarea
          ref={textareaRef}
          rows={1}
          value={text}
          disabled={busy}
          placeholder="Plan, ask, build…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />

        <div className="composer-sheet-bottom-row">
          <button
            type="button"
            className="composer-plus"
            aria-label="New worktree"
            disabled={selection === undefined || busy}
            onClick={() => selection !== undefined && setSubPicker({ step: "worktree", repo: selection.repo })}
          >
            <Plus size={18} strokeWidth={2.2} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="composer-model-selector"
            disabled={models.length === 0}
            onClick={() => setSubPicker({ step: "model" })}
          >
            {selectedModel?.name ?? "Model"}
            <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="send-button"
            aria-label="Send"
            disabled={busy || text.trim().length === 0 || selection === undefined}
            onClick={() => void send()}
          >
            <ArrowUp size={18} strokeWidth={2.4} aria-hidden="true" />
          </button>
        </div>

        {subPicker !== undefined ? (
          <div className="sub-picker">
            <div className="sub-picker-header">
              <button type="button" className="picker-close" onClick={() => setSubPicker(undefined)} aria-label="Close">
                <X size={18} strokeWidth={2} aria-hidden="true" />
              </button>
              <h3>
                {subPicker.step === "repo"
                  ? "Pick a repo"
                  : subPicker.step === "model"
                    ? "Pick a model"
                    : `Worktree in ${subPicker.repo}`}
              </h3>
            </div>

            {subPicker.step === "repo" ? (
              <div className="picker-list">
                {repoNames.map((repo) => (
                  <button
                    key={repo}
                    type="button"
                    className="picker-item"
                    onClick={() => setSubPicker({ step: "worktree", repo })}
                  >
                    {repo}
                  </button>
                ))}
              </div>
            ) : subPicker.step === "model" ? (
              <div className="picker-list">
                {models.map((model) => (
                  <button
                    key={`${model.providerID}/${model.modelID}`}
                    type="button"
                    className="picker-item"
                    onClick={() => {
                      setSelectedModel(model);
                      setSubPicker(undefined);
                    }}
                  >
                    {model.name}
                  </button>
                ))}
              </div>
            ) : (
              <>
                <div className="picker-list">
                  {worktreesForSubPicker.map((wt) => (
                    <button
                      key={wt.path}
                      type="button"
                      className="picker-item"
                      onClick={() => {
                        setSelection({ repo: subPicker.repo, worktree: wt });
                        setSubPicker(undefined);
                      }}
                    >
                      {wt.isMain ? "main" : wt.name}
                    </button>
                  ))}
                </div>
                <div className="picker-new-worktree">
                  <input
                    type="text"
                    placeholder="New worktree name"
                    value={newWorktreeName}
                    onChange={(e) => setNewWorktreeName(e.target.value)}
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                    disabled={busy}
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      const main = worktreesForSubPicker.find((w) => w.isMain) ?? worktreesForSubPicker[0];
                      if (main === undefined) return;
                      void createNewWorktree(subPicker.repo, main.path);
                    }}
                  >
                    {busy ? "Creating…" : "+ New worktree"}
                  </button>
                </div>
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
};
