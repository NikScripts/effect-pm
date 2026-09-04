/**
 * The bottom-sheet composer for starting a new session — modeled on the
 * Cursor iOS app's own "plan, ask, build" sheet: two selector pills up top
 * (repo, then worktree — Cursor's own second pill is "environment"/cloud,
 * which we don't have a concept of), a real text composer, and a send
 * button disabled until there's text. Sending creates the session *and*
 * delivers the typed text as its first message in one motion, rather than
 * dropping you into an empty chat.
 *
 * Tapping either pill (or the model selector) opens the same searchable
 * full sheet as Cursor's own "Workspace" picker: close button + centered
 * title, a search field, an "Active" row for the current pick, then every
 * other option as a flat, dividers-not-cards list.
 *
 * Repo/worktree options still come from the real repoScan.ts result (git
 * worktree list), not an assumed layout.
 *
 * @internal
 */
import { ArrowUp, ChevronDown, ChevronsUpDown, Folder, Plus, Search, X } from "lucide-react";
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
  | { readonly step: "newWorktree"; readonly repo: string; readonly mainCheckoutPath: string }
  | { readonly step: "model" };

const worktreeLabel = (wt: ScannedWorktree): string => (wt.isMain ? "main" : wt.name);

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
  const [pickerSearch, setPickerSearch] = React.useState("");
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

  const openPicker = (step: SubPickerStep): void => {
    setPickerSearch("");
    setSubPicker(step);
  };

  const worktreesForRepo = (repo: string): ReadonlyArray<ScannedWorktree> =>
    (scanned ?? []).find((r) => r.repo === repo)?.worktrees ?? [];

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

  const search = pickerSearch.trim().toLowerCase();

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
            onClick={() => openPicker({ step: "repo" })}
          >
            {selection === undefined ? (scanning ? "Scanning…" : "Repo") : selection.repo}
            <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="composer-selector"
            disabled={selection === undefined}
            onClick={() => selection !== undefined && openPicker({ step: "worktree", repo: selection.repo })}
          >
            {selection === undefined ? "Worktree" : worktreeLabel(selection.worktree)}
            <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
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
            onClick={() => {
              if (selection === undefined) return;
              const main = worktreesForRepo(selection.repo).find((w) => w.isMain) ?? selection.worktree;
              setNewWorktreeName("");
              openPicker({ step: "newWorktree", repo: selection.repo, mainCheckoutPath: main.path });
            }}
          >
            <Plus size={18} strokeWidth={2.2} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="composer-model-selector"
            disabled={models.length === 0}
            onClick={() => openPicker({ step: "model" })}
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
      </div>

      {subPicker !== undefined ? (
        <div className="selection-sheet" onClick={(e) => e.stopPropagation()}>
          <div className="selection-sheet-handle" />
          <div className="selection-sheet-header">
            <button type="button" className="picker-close" onClick={() => setSubPicker(undefined)} aria-label="Close">
              <X size={18} strokeWidth={2} aria-hidden="true" />
            </button>
            <h3>
              {subPicker.step === "repo"
                ? "Repo"
                : subPicker.step === "model"
                  ? "Model"
                  : subPicker.step === "newWorktree"
                    ? "New worktree"
                    : "Worktree"}
            </h3>
          </div>

          {subPicker.step === "newWorktree" ? (
            <div className="picker-new-worktree">
              <input
                type="text"
                placeholder="Worktree name"
                value={newWorktreeName}
                onChange={(e) => setNewWorktreeName(e.target.value)}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                disabled={busy}
                autoFocus
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => void createNewWorktree(subPicker.repo, subPicker.mainCheckoutPath)}
              >
                {busy ? "Creating…" : "Create"}
              </button>
            </div>
          ) : (
            <>
              <div className="selection-sheet-search">
                <Search size={16} strokeWidth={2} aria-hidden="true" />
                <input
                  type="text"
                  placeholder={
                    subPicker.step === "repo" ? "Search repos…" : subPicker.step === "model" ? "Search models…" : "Search worktrees…"
                  }
                  value={pickerSearch}
                  onChange={(e) => setPickerSearch(e.target.value)}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                />
              </div>

              {subPicker.step === "repo" ? (
                <RepoOptions
                  repos={(scanned ?? []).map((r) => r.repo)}
                  active={selection?.repo}
                  search={search}
                  onPick={(repo) => {
                    const target = (scanned ?? []).find((r) => r.repo === repo);
                    const main = target?.worktrees.find((w) => w.isMain) ?? target?.worktrees[0];
                    if (target !== undefined && main !== undefined) setSelection({ repo: target.repo, worktree: main });
                    setSubPicker(undefined);
                  }}
                />
              ) : subPicker.step === "model" ? (
                <ModelOptions
                  models={models}
                  active={selectedModel}
                  search={search}
                  onPick={(model) => {
                    setSelectedModel(model);
                    setSubPicker(undefined);
                  }}
                />
              ) : (
                <WorktreeOptions
                  worktrees={worktreesForRepo(subPicker.repo)}
                  active={selection?.repo === subPicker.repo ? selection.worktree : undefined}
                  search={search}
                  onPick={(wt) => {
                    setSelection({ repo: subPicker.repo, worktree: wt });
                    setSubPicker(undefined);
                  }}
                />
              )}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
};

/** One row: folder icon, name, an up/down chevron only on the current
 * pick — matches the reference's "Active" row treatment, folded into a
 * single flat list instead of separate Active/Recents/More sections
 * (we don't track repo-selection recency the way Cursor's own history
 * does). */
const OptionRow = (props: {
  readonly label: string;
  readonly active: boolean;
  readonly onClick: () => void;
}): React.ReactElement => (
  <button type="button" className={`selection-option${props.active ? " selection-option-active" : ""}`} onClick={props.onClick}>
    <Folder size={17} strokeWidth={1.6} aria-hidden="true" className="selection-option-icon" />
    <span className="selection-option-label">{props.label}</span>
    {props.active ? <ChevronsUpDown size={15} strokeWidth={1.8} aria-hidden="true" className="selection-option-chevron" /> : null}
  </button>
);

const RepoOptions = (props: {
  readonly repos: ReadonlyArray<string>;
  readonly active: string | undefined;
  readonly search: string;
  readonly onPick: (repo: string) => void;
}): React.ReactElement => {
  const filtered = props.repos.filter((r) => r.toLowerCase().includes(props.search));
  return (
    <div className="selection-list">
      {filtered.length === 0 ? <p className="hint">No matches.</p> : null}
      {filtered.map((repo) => (
        <OptionRow key={repo} label={repo} active={repo === props.active} onClick={() => props.onPick(repo)} />
      ))}
    </div>
  );
};

const WorktreeOptions = (props: {
  readonly worktrees: ReadonlyArray<ScannedWorktree>;
  readonly active: ScannedWorktree | undefined;
  readonly search: string;
  readonly onPick: (wt: ScannedWorktree) => void;
}): React.ReactElement => {
  const filtered = props.worktrees.filter((wt) => worktreeLabel(wt).toLowerCase().includes(props.search));
  return (
    <div className="selection-list">
      {filtered.length === 0 ? <p className="hint">No matches.</p> : null}
      {filtered.map((wt) => (
        <OptionRow key={wt.path} label={worktreeLabel(wt)} active={wt.path === props.active?.path} onClick={() => props.onPick(wt)} />
      ))}
    </div>
  );
};

const ModelOptions = (props: {
  readonly models: ReadonlyArray<ModelOption>;
  readonly active: ModelOption | undefined;
  readonly search: string;
  readonly onPick: (model: ModelOption) => void;
}): React.ReactElement => {
  const filtered = props.models.filter((m) => m.name.toLowerCase().includes(props.search));
  return (
    <div className="selection-list">
      {filtered.length === 0 ? <p className="hint">No matches.</p> : null}
      {filtered.map((model) => (
        <OptionRow
          key={`${model.providerID}/${model.modelID}`}
          label={model.name}
          active={props.active?.providerID === model.providerID && props.active.modelID === model.modelID}
          onClick={() => props.onPick(model)}
        />
      ))}
    </div>
  );
};
