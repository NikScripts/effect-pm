/**
 * First-run screen — asks for the root folder repos live under. No layout
 * is assumed beneath it: repos and their worktrees are discovered by
 * scanning (repoScan.ts, real `git worktree list` output), not a directory
 * naming convention. Reachable again later via Settings for changing it.
 *
 * @internal
 */
import * as React from "react";
import * as Router from "last-ts/Router";
import { setRootDir } from "../opencode/settings";
import { urls } from "../site";
import { navigateWithTransition } from "../viewTransition";

export const Setup = (): React.ReactElement => {
  const router = Router.useRouter();
  const [value, setValue] = React.useState("");

  const save = (e: React.FormEvent): void => {
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed.length === 0) return;
    setRootDir(trimmed);
    navigateWithTransition(() => router.go(urls.sessions()));
  };

  return (
    <div className="setup-screen">
      <h1>Where do your repos live?</h1>
      <p className="hint">
        The folder repos are checked out under, e.g. <code>/Users/you/Coding</code>. Repos and
        worktrees are found by scanning — no particular layout required.
      </p>
      <form onSubmit={save}>
        <input
          type="text"
          className="setup-input"
          placeholder="/Users/you/Coding"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
        <button type="submit" className="setup-submit" disabled={value.trim().length === 0}>
          Continue
        </button>
      </form>
    </div>
  );
};
