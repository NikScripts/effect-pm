/**
 * Home composer top section — native SwiftUI `Menu` selectors for repo,
 * branch, and worktree. Repo + branch hug on the leading edge; worktree
 * sits alone on the trailing edge. Trigger chrome is an RN pill
 * (`RNHostView` label) so fill + label color are under our control;
 * SwiftUI `tint` on `bordered` kept resolving to the same light system gray.
 *
 * @internal
 */
import { Feather } from "@expo/vector-icons";
import {
  Button,
  Divider,
  Host,
  Menu,
  RNHostView,
  Section,
  Toggle,
} from "@expo/ui/swift-ui";
import {
  buttonStyle,
  disabled as disabledModifier,
  menuIndicator,
  menuStyle,
} from "@expo/ui/swift-ui/modifiers";
import * as React from "react";
import { Alert, DynamicColorIOS, StyleSheet, Text, useColorScheme, View } from "react-native";
import { useAppContext } from "./AppContext";
import { listLocalBranches, readCurrentBranch } from "./branchScan";
import type { ScannedRepo, ScannedWorktree } from "./repoScan";
import { randomSlug } from "./slug";
import { createWorkspaceFolder } from "./repoCreate";
import { NewRepoSheet } from "./NewRepoSheet";
import {
  getDefaultWorktreePreference,
  getLastWorktreeByRepo,
  getRepoMenuSort,
  setLastWorktreeForRepo,
  setRepoMenuSort,
  type RepoMenuSort,
} from "./settings";
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
  /** Most-recent session time per repo / folder name — drives "Recent" sort. */
  readonly activityByName: ReadonlyMap<string, number>;
  readonly target: SessionTarget | undefined;
  readonly onChange: (target: SessionTarget) => void;
  /** Rescan repos after create/clone/mkdir/worktree. */
  readonly onWorkspaceChanged: () => Promise<void>;
};

/** Filled chip — systemGray5 / gray4, not the translucent bordered default. */
const PILL_BG = DynamicColorIOS({ light: "#E5E5EA", dark: "#3A3A3C" });
const PILL_FG = DynamicColorIOS({ light: "#3C3C43", dark: "#EBEBF5" });
const PILL_CHEVRON = { light: "#8E8E93", dark: "#8E8E93" } as const;

/** Custom label as the whole trigger — no SwiftUI button chrome. */
const MENU_MODIFIERS = [
  menuStyle("button"),
  buttonStyle("plain"),
  menuIndicator("hidden"),
] as const;

const PILL_HEIGHT = 32;
const PILL_MAX_WIDTH = 160;
const PILL_MIN_WIDTH = 56;

/**
 * Host `matchContents` (horizontal) races RNHostView Yoga measurement and
 * can settle at width 0 — that emptied the worktree trigger. Size the Host
 * from the label string instead (same idea as SystemIcon’s explicit box).
 */
const pillHostWidth = (text: string): number =>
  Math.min(PILL_MAX_WIDTH, Math.max(PILL_MIN_WIDTH, Math.ceil(text.length * 7.8) + 40));

const PillLabel = (props: { readonly text: string; readonly dimmed?: boolean }): React.ReactElement => {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  return (
    <RNHostView matchContents>
      <View style={[styles.pill, props.dimmed === true && styles.pillDimmed]}>
        <Text style={styles.pillText} numberOfLines={1} ellipsizeMode="head">
          {props.text}
        </Text>
        <Feather name="chevron-down" size={12} color={PILL_CHEVRON[scheme]} />
      </View>
    </RNHostView>
  );
};

export const HomeTargetPickers = (props: Props): React.ReactElement => {
  const { client, rootDir } = useAppContext();
  const [branches, setBranches] = React.useState<ReadonlyArray<string>>([]);
  const [newRepoOpen, setNewRepoOpen] = React.useState(false);
  const [sort, setSort] = React.useState<RepoMenuSort>("recent");

  React.useEffect(() => {
    void getRepoMenuSort().then(setSort);
  }, []);

  const toggleSort = (): void => {
    const next: RepoMenuSort = sort === "recent" ? "alphabetical" : "recent";
    setSort(next);
    void setRepoMenuSort(next);
  };

  const sortedRepos = React.useMemo((): ReadonlyArray<ScannedRepo> => {
    const list = [...props.scanned];
    if (sort === "alphabetical") {
      return list.sort((a, b) => a.repo.localeCompare(b.repo));
    }
    return list.sort(
      (a, b) => (props.activityByName.get(b.repo) ?? 0) - (props.activityByName.get(a.repo) ?? 0),
    );
  }, [props.scanned, props.activityByName, sort]);

  const sortedFolders = React.useMemo((): ReadonlyArray<FolderTarget> => {
    const list = [...props.otherFolders];
    if (sort === "alphabetical") {
      return list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return list.sort(
      (a, b) => (props.activityByName.get(b.name) ?? 0) - (props.activityByName.get(a.name) ?? 0),
    );
  }, [props.otherFolders, props.activityByName, sort]);

  // Default to first known repo once scan lands (respects default-worktree pref).
  React.useEffect(() => {
    if (props.target !== undefined || sortedRepos.length === 0) return;
    const repo = sortedRepos[0]!;
    void (async () => {
      const preference = await getDefaultWorktreePreference();
      const lastByRepo = preference === "last" ? await getLastWorktreeByRepo() : {};
      const lastKey = lastByRepo[repo.repo];
      const fromLast =
        lastKey !== undefined
          ? repo.worktrees.find((w) => worktreeLabel(w) === lastKey || w.name === lastKey)
          : undefined;
      const main = repo.worktrees.find((w) => w.isMain) ?? repo.worktrees[0];
      const chosen = fromLast ?? main;
      if (chosen === undefined) return;
      const branch = (await readCurrentBranch(client, chosen.path)) ?? "main";
      props.onChange({ kind: "repo", repo: repo.repo, worktree: chosen, branch });
    })();
  }, [sortedRepos, props.target, props.onChange, client]);

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
    void (async () => {
      const preference = await getDefaultWorktreePreference();
      const lastByRepo = preference === "last" ? await getLastWorktreeByRepo() : {};
      const lastKey = lastByRepo[repo.repo];
      const fromLast =
        lastKey !== undefined
          ? repo.worktrees.find((w) => worktreeLabel(w) === lastKey || w.name === lastKey)
          : undefined;
      const main = repo.worktrees.find((w) => w.isMain) ?? repo.worktrees[0];
      const chosen = fromLast ?? main;
      if (chosen === undefined) return;
      const branch = (await readCurrentBranch(client, chosen.path)) ?? "main";
      props.onChange({ kind: "repo", repo: repo.repo, worktree: chosen, branch });
    })();
  };

  const pickFolder = (folder: FolderTarget): void => {
    props.onChange(folder);
  };

  const pickWorktree = (wt: ScannedWorktree): void => {
    if (props.target?.kind !== "repo") return;
    const previous = props.target;
    void setLastWorktreeForRepo(previous.repo, worktreeLabel(wt));
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
                await props.onWorkspaceChanged();
                void setLastWorktreeForRepo(target.repo, name);
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

  const promptNewFolder = (): void => {
    Alert.prompt(
      "New workspace folder",
      "A non-git folder under your root.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Create",
          onPress: (value?: string) => {
            void (async () => {
              const name = (value ?? "").trim();
              if (name.length === 0) return;
              try {
                const path = await createWorkspaceFolder(client, rootDir, name);
                await props.onWorkspaceChanged();
                props.onChange({ kind: "folder", name, path });
              } catch {
                Alert.alert("Couldn't create folder", `Failed to create "${name}".`);
              }
            })();
          },
        },
      ],
      "plain-text",
    );
  };

  const onRepoCreated = (repoName: string, mainPath: string): void => {
    void (async () => {
      await props.onWorkspaceChanged();
      const branch = (await readCurrentBranch(client, mainPath)) ?? "main";
      props.onChange({
        kind: "repo",
        repo: repoName,
        worktree: { name: "(main)", path: mainPath, isMain: true },
        branch,
      });
    })();
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
    props.target?.kind === "repo"
      ? worktreeLabel(props.target.worktree) || props.target.worktree.name || "Worktree"
      : "Worktree";
  const branchPill =
    props.target?.kind === "repo"
      ? props.target.branch || "Branch"
      : "Branch";

  const worktrees = (() => {
    if (props.target?.kind !== "repo") return [] as ReadonlyArray<ScannedWorktree>;
    const target = props.target;
    return props.scanned.find((r) => r.repo === target.repo)?.worktrees ?? [target.worktree];
  })();

  const repoOnly = props.target?.kind !== "repo";

  return (
    <>
    <View style={styles.row}>
      <View style={styles.leading}>
        <Host
          style={[styles.pillHost, { width: pillHostWidth(repoLabel) }]}
          matchContents={{ vertical: true }}
          ignoreSafeArea="all"
        >
          <Menu
            label={<PillLabel text={repoLabel} />}
            modifiers={[...MENU_MODIFIERS]}
          >
            <Button
              label={sort === "recent" ? "Sort: Recent" : "Sort: A–Z"}
              systemImage="arrow.up.arrow.down"
              onPress={toggleSort}
            />
            <Section title="Repos">
              {sortedRepos.map((repo) => {
                const active = props.target?.kind === "repo" && props.target.repo === repo.repo;
                return (
                  <Toggle
                    key={repo.repo}
                    label={repo.repo}
                    systemImage="shippingbox"
                    isOn={active}
                    onIsOnChange={(on) => {
                      if (on) pickRepo(repo);
                    }}
                  />
                );
              })}
              <Button label="New repo…" systemImage="plus" onPress={() => setNewRepoOpen(true)} />
            </Section>
            <Section title="Workspaces">
              {sortedFolders.map((folder) => {
                const active = props.target?.kind === "folder" && props.target.path === folder.path;
                return (
                  <Toggle
                    key={folder.path}
                    label={folder.name}
                    systemImage="folder"
                    isOn={active}
                    onIsOnChange={(on) => {
                      if (on) pickFolder(folder);
                    }}
                  />
                );
              })}
              <Button label="New folder…" systemImage="plus" onPress={promptNewFolder} />
            </Section>
          </Menu>
        </Host>

        <Host
          style={[styles.pillHost, { width: pillHostWidth(branchPill) }]}
          matchContents={{ vertical: true }}
          ignoreSafeArea="all"
        >
          <Menu
            label={<PillLabel text={branchPill} dimmed={repoOnly} />}
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

      <Host
        style={[styles.pillHost, { width: pillHostWidth(worktreePill) }]}
        matchContents={{ vertical: true }}
        ignoreSafeArea="all"
      >
        <Menu
          label={<PillLabel text={worktreePill} dimmed={repoOnly} />}
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
    </View>
    <NewRepoSheet
      visible={newRepoOpen}
      onClose={() => setNewRepoOpen(false)}
      onCreated={onRepoCreated}
    />
    </>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 6,
  },
  leading: {
    flexDirection: "row",
    alignItems: "center",
    flexGrow: 0,
    flexShrink: 1,
    gap: 8,
    minWidth: 0,
  },
  pillHost: {
    height: PILL_HEIGHT,
    flexGrow: 0,
    flexShrink: 0,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    height: PILL_HEIGHT,
    width: "100%",
    paddingHorizontal: 12,
    borderRadius: PILL_HEIGHT / 2,
    borderCurve: "continuous",
    overflow: "hidden",
    backgroundColor: PILL_BG,
  },
  pillDimmed: {
    opacity: 0.4,
  },
  pillText: {
    flexShrink: 1,
    color: PILL_FG,
    fontSize: 13,
    fontWeight: "600",
  },
});
