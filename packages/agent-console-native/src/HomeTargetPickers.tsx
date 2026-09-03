/**
 * Home composer top section — native SwiftUI `Menu` selectors for repo,
 * worktree, and branch. Trigger chrome is an RN pill (`RNHostView` label)
 * so fill + label color are under our control; SwiftUI `tint` on
 * `bordered` kept resolving to the same light system gray.
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
        <Text style={styles.pillText} numberOfLines={1}>
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

  const repoDisabled = props.scanned.length === 0 && props.otherFolders.length === 0;
  const repoOnly = props.target?.kind !== "repo";

  return (
    <View style={styles.row}>
      <View style={styles.leading}>
        <Host
          style={[styles.pillHost, { width: pillHostWidth(repoLabel) }]}
          matchContents={{ vertical: true }}
          ignoreSafeArea="all"
        >
          <Menu
            label={<PillLabel text={repoLabel} dimmed={repoDisabled} />}
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
