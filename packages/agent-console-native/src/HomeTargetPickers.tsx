/**
 * Home composer top section — native SwiftUI `Menu` selectors for repo,
 * worktree, and branch (not a hand-rolled RN Modal). Repo menu keeps
 * workspaces and "Other folders" as separate sections. Worktree offers
 * create-new via `Alert.prompt`. Branch lists local refs with the
 * worktree's current HEAD pre-selected.
 *
 * @internal
 */
import {
  Button,
  Divider,
  Host,
  Menu,
  Section,
  Toggle,
} from "@expo/ui/swift-ui";
import {
  buttonStyle,
  controlSize,
  disabled as disabledModifier,
  foregroundStyle,
  menuIndicator,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import * as React from "react";
import { Alert, DynamicColorIOS, StyleSheet, View } from "react-native";
import { useAppContext } from "./AppContext";
import { listLocalBranches, readCurrentBranch } from "./branchScan";
import type { ScannedRepo, ScannedWorktree } from "./repoScan";
import { randomSlug } from "./slug";
import { createWorktree } from "./worktree";

export type FolderTarget = {
  readonly kind: "folder";
  readonly name: string;
  readonly path: string;
};

export type RepoTarget = {
  readonly kind: "repo";
  readonly repo: string;
  readonly worktree: ScannedWorktree;
  readonly branch: string;
};

export type SessionTarget = FolderTarget | RepoTarget;

export const sessionDirectory = (target: SessionTarget): string =>
  target.kind === "folder" ? target.path : target.worktree.path;

export const worktreeLabel = (wt: ScannedWorktree): string => (wt.isMain ? "main" : wt.name);

type Props = {
  readonly scanned: ReadonlyArray<ScannedRepo>;
  readonly otherFolders: ReadonlyArray<FolderTarget>;
  readonly target: SessionTarget | undefined;
  readonly onChange: (target: SessionTarget) => void;
  readonly onWorktreesChanged: () => Promise<void>;
};

/** Trigger chrome inside the glass composer. `bordered` + explicit tint/
 * foreground so we don't inherit the accent-blue default — fill tracks
 * tertiarySystemFill-ish gray, label tracks secondaryLabel. */
const PILL_FILL = DynamicColorIOS({
  light: "rgba(120, 120, 128, 0.16)",
  dark: "rgba(120, 120, 128, 0.28)",
});
const PILL_LABEL = DynamicColorIOS({
  light: "rgba(60, 60, 67, 0.85)",
  dark: "rgba(235, 235, 245, 0.7)",
});
const MENU_MODIFIERS = [
  buttonStyle("bordered"),
  controlSize("small"),
  menuIndicator("visible"),
  tint(PILL_FILL),
  // After tint — same ordering lesson as Composer's chip glyphs.
  foregroundStyle(PILL_LABEL),
] as const;

export const HomeTargetPickers = (props: Props): React.ReactElement => {
  const { client, rootDir } = useAppContext();
  const [branches, setBranches] = React.useState<ReadonlyArray<string>>([]);

  // Default to first known repo (main worktree) once scan lands.
  React.useEffect(() => {
    if (props.target !== undefined || props.scanned.length === 0) return;
    const repo = props.scanned[0]!;
    const main = repo.worktrees.find((w) => w.isMain) ?? repo.worktrees[0];
    if (main === undefined) return;
    void (async () => {
      const branch = (await readCurrentBranch(client, main.path)) ?? "main";
      props.onChange({ kind: "repo", repo: repo.repo, worktree: main, branch });
    })();
  }, [props.scanned, props.target, props.onChange, client]);

  // Keep branch label in sync when the worktree changes.
  React.useEffect(() => {
    if (props.target?.kind !== "repo") return;
    const snapshot = props.target;
    let cancelled = false;
    void (async () => {
      const current = await readCurrentBranch(client, snapshot.worktree.path);
      if (cancelled || current === undefined || current === snapshot.branch) return;
      props.onChange({ ...snapshot, branch: current });
    })();
    return () => {
      cancelled = true;
    };
  }, [props.target?.kind === "repo" ? props.target.worktree.path : "", client]); // eslint-disable-line react-hooks/exhaustive-deps

  // Prefetch branches for the active repo so the menu opens ready.
  React.useEffect(() => {
    if (props.target?.kind !== "repo") {
      setBranches([]);
      return;
    }
    const target = props.target;
    const main =
      props.scanned.find((r) => r.repo === target.repo)?.worktrees.find((w) => w.isMain) ??
      target.worktree;
    let cancelled = false;
    void listLocalBranches(client, main.path).then((names) => {
      if (cancelled) return;
      const ordered =
        target.branch.length > 0 && !names.includes(target.branch)
          ? [target.branch, ...names]
          : names;
      setBranches(ordered);
    });
    return () => {
      cancelled = true;
    };
  }, [props.target, props.scanned, client]);

  const pickRepo = (repo: ScannedRepo): void => {
    const main = repo.worktrees.find((w) => w.isMain) ?? repo.worktrees[0];
    if (main === undefined) return;
    void (async () => {
      const branch = (await readCurrentBranch(client, main.path)) ?? "main";
      props.onChange({ kind: "repo", repo: repo.repo, worktree: main, branch });
    })();
  };

  const pickFolder = (folder: FolderTarget): void => {
    props.onChange(folder);
  };

  const pickWorktree = (wt: ScannedWorktree): void => {
    if (props.target?.kind !== "repo") return;
    const previous = props.target;
    void (async () => {
      const branch = (await readCurrentBranch(client, wt.path)) ?? previous.branch;
      props.onChange({ kind: "repo", repo: previous.repo, worktree: wt, branch });
    })();
  };

  const pickBranch = (branch: string): void => {
    if (props.target?.kind !== "repo") return;
    props.onChange({ ...props.target, branch });
  };

  const promptNewWorktree = (): void => {
    if (props.target?.kind !== "repo") return;
    const target = props.target;
    const repo = props.scanned.find((r) => r.repo === target.repo);
    const main = repo?.worktrees.find((w) => w.isMain) ?? target.worktree;

    Alert.prompt(
      "New worktree",
      "Leave blank for an auto-generated name.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Create",
          onPress: (value?: string) => {
            void (async () => {
              const name = (value ?? "").trim() || randomSlug();
              try {
                const path = await createWorktree(client, rootDir, target.repo, main.path, name);
                await props.onWorktreesChanged();
                props.onChange({
                  kind: "repo",
                  repo: target.repo,
                  worktree: { name, path, isMain: false },
                  branch: name,
                });
              } catch {
                Alert.alert("Couldn't create worktree", `Failed to create "${name}".`);
              }
            })();
          },
        },
      ],
      "plain-text",
    );
  };

  const repoLabel =
    props.target === undefined
      ? props.scanned.length === 0
        ? "Scanning…"
        : "Repo"
      : props.target.kind === "folder"
        ? props.target.name
        : props.target.repo;
  const worktreePill =
    props.target?.kind === "repo" ? worktreeLabel(props.target.worktree) : "Worktree";
  const branchPill = props.target?.kind === "repo" ? props.target.branch : "Branch";

  const worktrees = (() => {
    if (props.target?.kind !== "repo") return [] as ReadonlyArray<ScannedWorktree>;
    const target = props.target;
    return props.scanned.find((r) => r.repo === target.repo)?.worktrees ?? [target.worktree];
  })();

  const repoDisabled = props.scanned.length === 0 && props.otherFolders.length === 0;
  const repoOnly = props.target?.kind !== "repo";

  return (
    <View style={styles.row}>
      <Host style={styles.pillHost} matchContents={{ vertical: true }} ignoreSafeArea="all">
        <Menu
          label={repoLabel}
          modifiers={[...MENU_MODIFIERS, ...(repoDisabled ? [disabledModifier(true)] : [])]}
        >
          {props.scanned.length > 0 ? (
            <Section title="Workspaces">
              {props.scanned.map((repo) => {
                const active = props.target?.kind === "repo" && props.target.repo === repo.repo;
                return (
                  <Toggle
                    key={repo.repo}
                    label={repo.repo}
                    systemImage="folder"
                    isOn={active}
                    onIsOnChange={(on) => {
                      if (on) pickRepo(repo);
                    }}
                  />
                );
              })}
            </Section>
          ) : null}
          {props.otherFolders.length > 0 ? (
            <Section title="Other folders">
              {props.otherFolders.map((folder) => {
                const active = props.target?.kind === "folder" && props.target.path === folder.path;
                return (
                  <Toggle
                    key={folder.path}
                    label={folder.name}
                    systemImage="folder.badge.gearshape"
                    isOn={active}
                    onIsOnChange={(on) => {
                      if (on) pickFolder(folder);
                    }}
                  />
                );
              })}
            </Section>
          ) : null}
        </Menu>
      </Host>

      <Host style={styles.pillHost} matchContents={{ vertical: true }} ignoreSafeArea="all">
        <Menu
          label={worktreePill}
          modifiers={[...MENU_MODIFIERS, ...(repoOnly ? [disabledModifier(true)] : [])]}
        >
          {worktrees.map((wt) => {
            const active =
              props.target?.kind === "repo" && props.target.worktree.path === wt.path;
            return (
              <Toggle
                key={wt.path}
                label={worktreeLabel(wt)}
                systemImage={wt.isMain ? "externaldrive" : "square.on.square"}
                isOn={active}
                onIsOnChange={(on) => {
                  if (on) pickWorktree(wt);
                }}
              />
            );
          })}
          <Divider />
          <Button label="Create new…" systemImage="plus" onPress={promptNewWorktree} />
        </Menu>
      </Host>

      <Host style={styles.pillHost} matchContents={{ vertical: true }} ignoreSafeArea="all">
        <Menu
          label={branchPill}
          modifiers={[...MENU_MODIFIERS, ...(repoOnly ? [disabledModifier(true)] : [])]}
        >
          {branches.map((branch) => {
            const active = props.target?.kind === "repo" && props.target.branch === branch;
            return (
              <Toggle
                key={branch}
                label={branch}
                systemImage="arrow.triangle.branch"
                isOn={active}
                onIsOnChange={(on) => {
                  if (on) pickBranch(branch);
                }}
              />
            );
          })}
        </Menu>
      </Host>
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 6,
  },
  pillHost: {
    flex: 1,
    minWidth: 0,
  },
});
