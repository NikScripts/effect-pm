/**
 * Home composer top section — repo / worktree / branch selector pills plus
 * searchable sheets. Repo sheet keeps known git workspaces and non-git
 * "Other folders" in one list with a section break. Worktree sheet offers
 * existing checkouts plus "Create new…". Branch sheet lists local branches
 * and pre-selects whatever HEAD is on the chosen worktree.
 *
 * @internal
 */
import { Feather } from "@expo/vector-icons";
import * as React from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppContext } from "./AppContext";
import { listLocalBranches, readCurrentBranch } from "./branchScan";
import { colors } from "./colors";
import type { ScannedRepo, ScannedWorktree } from "./repoScan";
import { randomSlug } from "./slug";
import { SystemIcon } from "./SystemIcon";
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

type SheetKind =
  | { readonly step: "repo" }
  | { readonly step: "worktree" }
  | { readonly step: "branch" }
  | { readonly step: "newWorktree" };

type Props = {
  readonly scanned: ReadonlyArray<ScannedRepo>;
  readonly otherFolders: ReadonlyArray<FolderTarget>;
  readonly target: SessionTarget | undefined;
  readonly onChange: (target: SessionTarget) => void;
  readonly onWorktreesChanged: () => Promise<void>;
};

export const HomeTargetPickers = (props: Props): React.ReactElement => {
  const { client, rootDir } = useAppContext();
  const insets = useSafeAreaInsets();
  const [sheet, setSheet] = React.useState<SheetKind | undefined>(undefined);
  const [search, setSearch] = React.useState("");
  const [branches, setBranches] = React.useState<ReadonlyArray<string>>([]);
  const [loadingBranches, setLoadingBranches] = React.useState(false);
  const [newWorktreeName, setNewWorktreeName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>(undefined);

  const openSheet = (next: SheetKind): void => {
    setSearch("");
    setError(undefined);
    setSheet(next);
  };

  const closeSheet = (): void => {
    setSheet(undefined);
    setNewWorktreeName("");
    setError(undefined);
  };

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

  React.useEffect(() => {
    if (sheet?.step !== "branch" || props.target?.kind !== "repo") return;
    const target = props.target;
    const main =
      props.scanned.find((r) => r.repo === target.repo)?.worktrees.find((w) => w.isMain) ??
      target.worktree;
    setLoadingBranches(true);
    void listLocalBranches(client, main.path)
      .then((names) => {
        const current = target.branch;
        const ordered =
          current.length > 0 && !names.includes(current) ? [current, ...names] : names;
        setBranches(ordered);
      })
      .finally(() => setLoadingBranches(false));
  }, [sheet, props.target, props.scanned, client]);

  const pickRepo = (repo: ScannedRepo): void => {
    const main = repo.worktrees.find((w) => w.isMain) ?? repo.worktrees[0];
    if (main === undefined) return;
    void (async () => {
      const branch = (await readCurrentBranch(client, main.path)) ?? "main";
      props.onChange({ kind: "repo", repo: repo.repo, worktree: main, branch });
      closeSheet();
    })();
  };

  const pickFolder = (folder: FolderTarget): void => {
    props.onChange(folder);
    closeSheet();
  };

  const pickWorktree = (wt: ScannedWorktree): void => {
    if (props.target?.kind !== "repo") return;
    const previous = props.target;
    void (async () => {
      const branch = (await readCurrentBranch(client, wt.path)) ?? previous.branch;
      props.onChange({ kind: "repo", repo: previous.repo, worktree: wt, branch });
      closeSheet();
    })();
  };

  const pickBranch = (branch: string): void => {
    if (props.target?.kind !== "repo") return;
    props.onChange({ ...props.target, branch });
    closeSheet();
  };

  const createNew = async (): Promise<void> => {
    if (props.target?.kind !== "repo") return;
    const target = props.target;
    const repo = props.scanned.find((r) => r.repo === target.repo);
    const main = repo?.worktrees.find((w) => w.isMain) ?? target.worktree;
    const name = newWorktreeName.trim() || randomSlug();
    setBusy(true);
    setError(undefined);
    try {
      const path = await createWorktree(client, rootDir, target.repo, main.path, name);
      await props.onWorktreesChanged();
      props.onChange({
        kind: "repo",
        repo: target.repo,
        worktree: { name, path, isMain: false },
        branch: name,
      });
      closeSheet();
    } catch {
      setError(`Couldn't create worktree "${name}".`);
    } finally {
      setBusy(false);
    }
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

  const q = search.trim().toLowerCase();
  const filteredRepos = props.scanned.filter((r) => r.repo.toLowerCase().includes(q));
  const filteredFolders = props.otherFolders.filter((f) => f.name.toLowerCase().includes(q));
  const worktrees = (() => {
    if (props.target?.kind !== "repo") return [] as ReadonlyArray<ScannedWorktree>;
    const target = props.target;
    return props.scanned.find((r) => r.repo === target.repo)?.worktrees ?? [target.worktree];
  })();
  const filteredWorktrees = worktrees.filter((wt) => worktreeLabel(wt).toLowerCase().includes(q));
  const filteredBranches = branches.filter((b) => b.toLowerCase().includes(q));

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Pill label={repoLabel} onPress={() => openSheet({ step: "repo" })} />
        <Pill
          label={worktreePill}
          disabled={props.target?.kind !== "repo"}
          onPress={() => openSheet({ step: "worktree" })}
        />
        <Pill
          label={branchPill}
          disabled={props.target?.kind !== "repo"}
          onPress={() => openSheet({ step: "branch" })}
        />
      </View>

      <Modal visible={sheet !== undefined} animationType="slide" transparent onRequestClose={closeSheet}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={closeSheet} />
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.handle} />
          <View style={styles.sheetHeader}>
            <Pressable onPress={closeSheet} hitSlop={12} style={styles.closeBtn}>
              <Feather name="x" size={18} color={colors.label} />
            </Pressable>
            <Text style={styles.sheetTitle}>
              {sheet?.step === "repo"
                ? "Repo"
                : sheet?.step === "worktree"
                  ? "Worktree"
                  : sheet?.step === "newWorktree"
                    ? "New worktree"
                    : "Branch"}
            </Text>
            <View style={styles.closeBtn} />
          </View>

          {error !== undefined ? <Text style={styles.error}>{error}</Text> : null}

          {sheet?.step === "newWorktree" ? (
            <View style={styles.newWorktree}>
              <TextInput
                style={styles.searchInput}
                placeholder="Worktree name (optional)"
                placeholderTextColor={colors.placeholderText}
                value={newWorktreeName}
                onChangeText={setNewWorktreeName}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!busy}
                autoFocus
              />
              <Pressable style={styles.createBtn} disabled={busy} onPress={() => void createNew()}>
                <Text style={styles.createBtnText}>{busy ? "Creating…" : "Create"}</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <View style={styles.searchRow}>
                <Feather name="search" size={16} color={colors.secondaryLabel} />
                <TextInput
                  style={styles.searchField}
                  placeholder={
                    sheet?.step === "repo"
                      ? "Search repos…"
                      : sheet?.step === "worktree"
                        ? "Search worktrees…"
                        : "Search branches…"
                  }
                  placeholderTextColor={colors.placeholderText}
                  value={search}
                  onChangeText={setSearch}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>

              {sheet?.step === "repo" ? (
                <FlatList
                  data={[
                    ...filteredRepos.map((r) => ({ kind: "repo" as const, repo: r })),
                    ...(filteredFolders.length > 0
                      ? [{ kind: "heading" as const, title: "Other folders" }]
                      : []),
                    ...filteredFolders.map((f) => ({ kind: "folder" as const, folder: f })),
                  ]}
                  keyExtractor={(item, i) =>
                    item.kind === "heading"
                      ? `h-${item.title}`
                      : item.kind === "repo"
                        ? `r-${item.repo.repo}`
                        : `f-${item.folder.path}-${i}`
                  }
                  style={styles.list}
                  keyboardShouldPersistTaps="handled"
                  ListEmptyComponent={<Text style={styles.empty}>No matches.</Text>}
                  renderItem={({ item }) => {
                    if (item.kind === "heading") {
                      return <Text style={styles.sectionHeading}>{item.title}</Text>;
                    }
                    if (item.kind === "folder") {
                      const active =
                        props.target?.kind === "folder" && props.target.path === item.folder.path;
                      return (
                        <OptionRow
                          label={item.folder.name}
                          active={active}
                          onPress={() => pickFolder(item.folder)}
                        />
                      );
                    }
                    const active =
                      props.target?.kind === "repo" && props.target.repo === item.repo.repo;
                    return (
                      <OptionRow
                        label={item.repo.repo}
                        active={active}
                        onPress={() => pickRepo(item.repo)}
                      />
                    );
                  }}
                />
              ) : null}

              {sheet?.step === "worktree" ? (
                <FlatList
                  data={[
                    ...filteredWorktrees.map((wt) => ({ kind: "wt" as const, wt })),
                    { kind: "create" as const },
                  ]}
                  keyExtractor={(item, i) => (item.kind === "create" ? "create" : item.wt.path + i)}
                  style={styles.list}
                  keyboardShouldPersistTaps="handled"
                  ListEmptyComponent={<Text style={styles.empty}>No matches.</Text>}
                  renderItem={({ item }) => {
                    if (item.kind === "create") {
                      return (
                        <OptionRow
                          label="Create new…"
                          active={false}
                          icon="plus"
                          onPress={() => openSheet({ step: "newWorktree" })}
                        />
                      );
                    }
                    const active =
                      props.target?.kind === "repo" && props.target.worktree.path === item.wt.path;
                    return (
                      <OptionRow
                        label={worktreeLabel(item.wt)}
                        active={active}
                        onPress={() => pickWorktree(item.wt)}
                      />
                    );
                  }}
                />
              ) : null}

              {sheet?.step === "branch" ? (
                loadingBranches ? (
                  <ActivityIndicator style={styles.spinner} color={colors.secondaryLabel} />
                ) : (
                  <FlatList
                    data={filteredBranches}
                    keyExtractor={(b) => b}
                    style={styles.list}
                    keyboardShouldPersistTaps="handled"
                    ListEmptyComponent={<Text style={styles.empty}>No branches found.</Text>}
                    renderItem={({ item: branch }) => {
                      const active =
                        props.target?.kind === "repo" && props.target.branch === branch;
                      return (
                        <OptionRow label={branch} active={active} onPress={() => pickBranch(branch)} />
                      );
                    }}
                  />
                )
              ) : null}
            </>
          )}
        </View>
        </View>
      </Modal>
    </View>
  );
};

const Pill = (props: {
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
}): React.ReactElement => (
  <Pressable
    style={[styles.pill, props.disabled === true && styles.pillDisabled]}
    disabled={props.disabled}
    onPress={props.onPress}
  >
    <Text style={styles.pillText} numberOfLines={1}>
      {props.label}
    </Text>
    <Feather name="chevron-down" size={13} color={colors.secondaryLabel} />
  </Pressable>
);

const OptionRow = (props: {
  readonly label: string;
  readonly active: boolean;
  readonly onPress: () => void;
  readonly icon?: "folder" | "plus";
}): React.ReactElement => (
  <Pressable
    style={[styles.option, props.active && styles.optionActive]}
    onPress={props.onPress}
  >
    {props.icon === "plus" ? (
      <Feather name="plus" size={17} color={colors.tint} />
    ) : (
      <SystemIcon name="folder" size={17} color={colors.secondaryLabel} />
    )}
    <Text style={[styles.optionLabel, props.icon === "plus" && styles.optionCreate]} numberOfLines={1}>
      {props.label}
    </Text>
    {props.active ? <Feather name="check" size={16} color={colors.tint} /> : null}
  </Pressable>
);

const styles = StyleSheet.create({
  wrap: {
    marginBottom: 6,
  },
  row: {
    flexDirection: "row",
    gap: 6,
  },
  pill: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.fillBackground,
  },
  pillDisabled: {
    opacity: 0.4,
  },
  pillText: {
    flex: 1,
    color: colors.label,
    fontSize: 13,
    fontWeight: "600",
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  modalRoot: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.cardBackground,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: "70%",
    paddingTop: 8,
  },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.separator,
    marginBottom: 8,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  closeBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetTitle: {
    flex: 1,
    textAlign: "center",
    color: colors.label,
    fontSize: 17,
    fontWeight: "600",
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 12,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.fillBackground,
  },
  searchField: {
    flex: 1,
    color: colors.label,
    fontSize: 16,
    padding: 0,
  },
  searchInput: {
    marginHorizontal: 12,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: colors.fillBackground,
    color: colors.label,
    fontSize: 16,
  },
  list: {
    flexGrow: 0,
  },
  sectionHeading: {
    color: colors.secondaryLabel,
    fontSize: 13,
    fontWeight: "600",
    marginTop: 12,
    marginBottom: 4,
    marginHorizontal: 16,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  optionActive: {
    backgroundColor: colors.accentTint,
  },
  optionLabel: {
    flex: 1,
    color: colors.label,
    fontSize: 16,
  },
  optionCreate: {
    color: colors.tint,
    fontWeight: "600",
  },
  empty: {
    color: colors.secondaryLabel,
    padding: 16,
  },
  error: {
    color: colors.destructive,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  newWorktree: {
    paddingBottom: 8,
  },
  createBtn: {
    marginHorizontal: 12,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: colors.tint,
    alignItems: "center",
  },
  createBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  spinner: {
    marginVertical: 24,
  },
});
