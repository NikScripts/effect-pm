/**
 * Sheet for adding a repo (empty `git init` or clone) under the configured
 * main-checkout template. Clone probes `git ls-remote` so the user can
 * confirm remote metadata and pick a branch before writing anything.
 *
 * @internal
 */
import * as React from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppContext } from "./AppContext";
import { colors } from "./colors";
import {
  cloneRepo,
  initRepo,
  parseRemoteInput,
  previewRemote,
  searchGitHubRepos,
  type GitHubSearchHit,
  type RemotePreview,
} from "./repoCreate";
import { SystemIcon } from "./SystemIcon";

type Mode = "clone" | "create";

type Props = {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly onCreated: (repoName: string, mainPath: string) => void;
};

export const NewRepoSheet = (props: Props): React.ReactElement => {
  const insets = useSafeAreaInsets();
  const { client, rootDir } = useAppContext();
  const [mode, setMode] = React.useState<Mode>("clone");
  const [url, setUrl] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [hits, setHits] = React.useState<ReadonlyArray<GitHubSearchHit>>([]);
  const [searching, setSearching] = React.useState(false);
  const [name, setName] = React.useState("");
  const [preview, setPreview] = React.useState<RemotePreview | undefined>(undefined);
  const [branch, setBranch] = React.useState<string | undefined>(undefined);
  const [probing, setProbing] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>(undefined);

  React.useEffect(() => {
    if (!props.visible) return;
    setMode("clone");
    setUrl("");
    setSearch("");
    setHits([]);
    setName("");
    setPreview(undefined);
    setBranch(undefined);
    setError(undefined);
    setBusy(false);
    setProbing(false);
  }, [props.visible]);

  const runProbe = async (raw: string, nameOverride?: string): Promise<RemotePreview | undefined> => {
    setProbing(true);
    setError(undefined);
    try {
      const next = await previewRemote(client, rootDir, raw, nameOverride);
      setPreview(next);
      setName(nameOverride?.trim() || next.remote.name);
      setBranch(next.defaultBranch);
      setUrl(next.remote.url);
      return next;
    } catch (err) {
      setPreview(undefined);
      setError(err instanceof Error ? err.message : "Couldn't reach that remote.");
      return undefined;
    } finally {
      setProbing(false);
    }
  };

  const onBlurUrl = (): void => {
    if (parseRemoteInput(url) === undefined) return;
    void runProbe(url, name.trim() || undefined);
  };

  const onSearch = (): void => {
    const q = search.trim();
    if (q.length === 0) return;
    setSearching(true);
    setError(undefined);
    void searchGitHubRepos(client, rootDir, q)
      .then((results) => {
        setHits(results);
        if (results.length === 0) {
          setError("No GitHub results (is `gh` available and signed in on the OpenCode host?).");
        }
      })
      .catch((err: unknown) => {
        setHits([]);
        setError(err instanceof Error ? err.message : "Search failed.");
      })
      .finally(() => setSearching(false));
  };

  const submit = (): void => {
    const repoName = name.trim();
    if (repoName.length === 0) {
      setError("Give the repo a name.");
      return;
    }
    setBusy(true);
    setError(undefined);
    void (async () => {
      try {
        if (mode === "create") {
          const path = await initRepo(client, rootDir, repoName);
          props.onCreated(repoName, path);
          props.onClose();
          return;
        }
        let ready = preview;
        if (ready === undefined) {
          ready = await runProbe(url, repoName);
          if (ready === undefined) return;
        }
        const path = await cloneRepo(client, rootDir, ready.remote.url, repoName, branch);
        props.onCreated(repoName, path);
        props.onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't create the repo.");
      } finally {
        setBusy(false);
      }
    })();
  };

  const destinationPreview =
    preview !== undefined
      ? preview.destination.replace(/\/[^/]+$/, `/${name.trim() || preview.remote.name}`)
      : undefined;

  return (
    <Modal visible={props.visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={props.onClose}>
      <View style={[styles.root, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.header}>
          <Pressable onPress={props.onClose} hitSlop={12} accessibilityLabel="Close">
            <Text style={styles.headerAction}>Cancel</Text>
          </Pressable>
          <Text style={styles.headerTitle}>New repo</Text>
          <Pressable onPress={submit} disabled={busy || probing} hitSlop={12} accessibilityLabel="Create">
            <Text style={[styles.headerAction, styles.headerActionStrong, (busy || probing) && styles.disabled]}>
              {busy ? "…" : mode === "create" ? "Create" : preview === undefined ? "Look up" : "Clone"}
            </Text>
          </Pressable>
        </View>

        <View style={styles.modeRow}>
          {(["clone", "create"] as const).map((value) => (
            <Pressable
              key={value}
              style={[styles.modeChip, mode === value && styles.modeChipActive]}
              onPress={() => {
                setMode(value);
                setError(undefined);
              }}
            >
              <Text style={[styles.modeChipText, mode === value && styles.modeChipTextActive]}>
                {value === "clone" ? "Clone" : "Empty repo"}
              </Text>
            </Pressable>
          ))}
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {mode === "clone" ? (
            <>
              <Text style={styles.label}>GitHub search</Text>
              <View style={styles.searchRow}>
                <TextInput
                  style={[styles.input, styles.searchInput]}
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Find repos by name…"
                  placeholderTextColor={colors.placeholderText}
                  autoCapitalize="none"
                  autoCorrect={false}
                  onSubmitEditing={onSearch}
                />
                <Pressable style={styles.searchButton} onPress={onSearch} disabled={searching}>
                  {searching ? (
                    <ActivityIndicator color={colors.tint} />
                  ) : (
                    <SystemIcon name="magnifyingglass" size={16} color={colors.tint} />
                  )}
                </Pressable>
              </View>
              {hits.length > 0 ? (
                <View style={styles.hits}>
                  {hits.map((hit) => (
                    <Pressable
                      key={hit.fullName}
                      style={styles.hitRow}
                      onPress={() => {
                        const short = hit.fullName.split("/")[1] ?? hit.fullName;
                        setUrl(hit.url);
                        setName(short);
                        void runProbe(hit.url, short);
                      }}
                    >
                      <Text style={styles.hitTitle}>{hit.fullName}</Text>
                      {hit.description !== undefined ? (
                        <Text style={styles.hitDetail} numberOfLines={2}>
                          {hit.description}
                        </Text>
                      ) : null}
                    </Pressable>
                  ))}
                </View>
              ) : null}

              <Text style={styles.label}>Clone URL</Text>
              <Text style={styles.hint}>Paste a URL, SSH remote, or owner/repo.</Text>
              <TextInput
                style={styles.input}
                value={url}
                onChangeText={setUrl}
                onBlur={onBlurUrl}
                onSubmitEditing={onBlurUrl}
                placeholder="https://github.com/org/repo.git"
                placeholderTextColor={colors.placeholderText}
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
              />
              {probing ? <ActivityIndicator style={styles.probeSpinner} color={colors.tint} /> : null}

              {preview !== undefined ? (
                <View style={styles.previewCard}>
                  <Text style={styles.previewTitle}>Remote</Text>
                  <Text style={styles.previewLine}>
                    {preview.remote.host !== undefined ? `${preview.remote.host}/` : ""}
                    {preview.remote.owner !== undefined ? `${preview.remote.owner}/` : ""}
                    {preview.remote.name}
                  </Text>
                  <Text style={styles.previewMeta} numberOfLines={2} ellipsizeMode="head">
                    {preview.remote.url}
                  </Text>
                  {destinationPreview !== undefined ? (
                    <>
                      <Text style={[styles.previewTitle, styles.previewSpaced]}>Destination</Text>
                      <Text style={styles.previewMeta} numberOfLines={2} ellipsizeMode="head">
                        {destinationPreview}
                      </Text>
                    </>
                  ) : null}

                  <Text style={[styles.previewTitle, styles.previewSpaced]}>Branch</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.branchRow}>
                    {preview.branches.map((b) => (
                      <Pressable
                        key={b}
                        style={[styles.branchChip, branch === b && styles.branchChipActive]}
                        onPress={() => setBranch(b)}
                      >
                        <Text style={[styles.branchChipText, branch === b && styles.branchChipTextActive]}>{b}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              ) : null}
            </>
          ) : null}

          <Text style={styles.label}>Local name</Text>
          <Text style={styles.hint}>Folder name used in the path template under your root.</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="my-project"
            placeholderTextColor={colors.placeholderText}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
          />

          {error !== undefined ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
    paddingTop: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  headerTitle: {
    color: colors.label,
    fontSize: 17,
    fontWeight: "600",
  },
  headerAction: {
    color: colors.tint,
    fontSize: 17,
    minWidth: 64,
  },
  headerActionStrong: {
    fontWeight: "600",
    textAlign: "right",
  },
  disabled: {
    opacity: 0.4,
  },
  modeRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
  },
  modeChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.fillBackground,
  },
  modeChipActive: {
    backgroundColor: colors.accentTint,
  },
  modeChipText: {
    color: colors.secondaryLabel,
    fontSize: 14,
    fontWeight: "600",
  },
  modeChipTextActive: {
    color: colors.tint,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 40,
    gap: 8,
  },
  label: {
    color: colors.label,
    fontSize: 15,
    fontWeight: "600",
    marginTop: 10,
  },
  hint: {
    color: colors.secondaryLabel,
    fontSize: 13,
    lineHeight: 18,
  },
  input: {
    color: colors.label,
    fontSize: 15,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: colors.fillBackground,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  searchInput: {
    flex: 1,
  },
  searchButton: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accentTint,
  },
  hits: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    overflow: "hidden",
    backgroundColor: colors.cardBackground,
  },
  hitRow: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
    gap: 2,
  },
  hitTitle: {
    color: colors.label,
    fontSize: 15,
    fontWeight: "600",
  },
  hitDetail: {
    color: colors.secondaryLabel,
    fontSize: 13,
  },
  probeSpinner: {
    marginVertical: 8,
  },
  previewCard: {
    marginTop: 4,
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.cardBackground,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    gap: 4,
  },
  previewTitle: {
    color: colors.secondaryLabel,
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  previewSpaced: {
    marginTop: 10,
  },
  previewLine: {
    color: colors.label,
    fontSize: 16,
    fontWeight: "600",
  },
  previewMeta: {
    color: colors.secondaryLabel,
    fontSize: 13,
    fontFamily: "Menlo",
  },
  branchRow: {
    gap: 8,
    paddingVertical: 4,
  },
  branchChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.fillBackground,
  },
  branchChipActive: {
    backgroundColor: colors.accentTint,
  },
  branchChipText: {
    color: colors.secondaryLabel,
    fontSize: 13,
    fontWeight: "600",
  },
  branchChipTextActive: {
    color: colors.tint,
  },
  error: {
    color: colors.destructive,
    fontSize: 13,
    marginTop: 8,
  },
});
