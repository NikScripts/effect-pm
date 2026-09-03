/**
 * Home — "Recent" (most-recent sessions across every repo/worktree
 * combined) + a Workspaces list below (repos with real git identity),
 * with non-git folders broken out into their own "Other folders" section.
 * Matches packages/agent-console's Home.tsx information architecture and
 * visual language (card styling, workspace row styling, section headings).
 *
 * @internal
 */
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as React from "react";
import type { Session } from "@opencode-ai/sdk";
import { FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollViewMarker } from "react-native-screens/src/components/gamma/scroll-view-marker";
import { WORKTREE_SETUP_PREFIX } from "./agentConstants";
import { useAppContext } from "./AppContext";
import { AGENT } from "./client";
import { colors } from "./colors";
import { Composer } from "./Composer";
import { EdgeBlurBars } from "./EdgeBlurBars";
import {
  HomeTargetPickers,
  sessionDirectory,
  type FolderTarget,
  type SessionTarget,
} from "./HomeTargetPickers";
import type { ModelOption } from "./models";
import { displayWorktree, groupByRepo, matchSession, type RepoGroup } from "./repoGrouping";
import type { RootStackParamList } from "./RootNavigator";
import type { ScannedRepo } from "./repoScan";
import { isStale, readWorkspace, refreshWorkspace } from "./repoScanCache";
import { getCachedSessions, setCachedSessions } from "./sessionCache";
import { SystemIcon } from "./SystemIcon";
import { useKeyboardHeight } from "./useKeyboardHeight";

type Props = NativeStackScreenProps<RootStackParamList, "Home">;

const RECENT_COUNT = 4;

const relativeTime = (ms: number): string => {
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

type Row =
  | { readonly kind: "heading"; readonly title: string }
  | { readonly kind: "session"; readonly session: Session; readonly repo: string; readonly worktree: string | undefined }
  | { readonly kind: "repo"; readonly group: RepoGroup };

export const HomeScreen = (props: Props): React.ReactElement => {
  const { client, rootDir } = useAppContext();
  const [sessions, setSessions] = React.useState<ReadonlyArray<Session>>([]);
  const [scanned, setScanned] = React.useState<ReadonlyArray<ScannedRepo>>([]);
  const [target, setTarget] = React.useState<SessionTarget | undefined>(undefined);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [sending, setSending] = React.useState(false);

  const loadSessions = React.useCallback(async (): Promise<void> => {
    const { data, error: fetchError } = await client.session.list();
    if (fetchError !== undefined || data === undefined) {
      setError("Couldn't reach the OpenCode server.");
      return;
    }
    const visible = data.filter((s) => !s.title.startsWith(WORKTREE_SETUP_PREFIX));
    setSessions(visible);
    void setCachedSessions(visible);
  }, [client]);

  const loadScan = React.useCallback(
    async (force: boolean): Promise<void> => {
      const stale = force || (await isStale());
      if (!stale) {
        const cached = await readWorkspace();
        if (cached !== undefined) setScanned(cached);
        return;
      }
      try {
        setScanned(await refreshWorkspace(client, rootDir));
        setError(undefined);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't scan for repos.");
      }
    },
    [client, rootDir],
  );

  const refreshWorktrees = React.useCallback(async (): Promise<void> => {
    try {
      setScanned(await refreshWorkspace(client, rootDir));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't scan for repos.");
    }
  }, [client, rootDir]);

  React.useEffect(() => {
    (async () => {
      const [cachedSessions, cachedScan] = await Promise.all([getCachedSessions(), readWorkspace()]);
      if (cachedSessions !== undefined) setSessions(cachedSessions);
      if (cachedScan !== undefined) setScanned(cachedScan);
      setLoading(false);
      await Promise.all([loadSessions(), loadScan(cachedScan === undefined)]);
    })();
  }, [loadSessions, loadScan, client, rootDir]);

  const onSend = async (text: string, model: ModelOption | undefined): Promise<void> => {
    if (target === undefined || sending) return;
    setSending(true);
    try {
      const directory = sessionDirectory(target);
      const { data } = await client.session.create({ query: { directory } });
      if (data === undefined) throw new Error("no session");
      await client.session.promptAsync({
        path: { id: data.id },
        body: {
          agent: AGENT,
          parts: [{ type: "text", text }],
          model:
            model === undefined
              ? undefined
              : { providerID: model.providerID, modelID: model.modelID },
        },
      });
      props.navigation.navigate("Chat", { sessionID: data.id });
      void loadSessions();
    } finally {
      setSending(false);
    }
  };

  const onRefresh = (): void => {
    setRefreshing(true);
    Promise.all([loadSessions(), loadScan(true)]).finally(() => setRefreshing(false));
  };

  const sortedByRecent = [...sessions].sort((a, b) => b.time.updated - a.time.updated);
  const recent = sortedByRecent.slice(0, RECENT_COUNT);
  const groups = groupByRepo(sessions, scanned);
  const knownGroups = groups.filter((g) => g.isKnownRepo);
  const otherGroups = groups.filter((g) => !g.isKnownRepo);

  // Picker "Other folders" = session dirs that aren't known repos (same
  // classification as the Home list). Not a filesystem walk of root.
  const sessionFolders = React.useMemo(
    (): ReadonlyArray<FolderTarget> =>
      otherGroups.flatMap((group) => {
        const session = group.sessions[0];
        if (session === undefined) return [];
        return [{ kind: "folder" as const, name: group.repo, path: session.directory }];
      }),
    [otherGroups],
  );

  const activityByName = React.useMemo((): ReadonlyMap<string, number> => {
    const map = new Map<string, number>();
    for (const group of groups) map.set(group.repo, group.mostRecentUpdate);
    return map;
  }, [groups]);

  const rows: Array<Row> = [
    ...(recent.length > 0 ? [{ kind: "heading", title: "Recent" } as const] : []),
    ...recent.map((session) => {
      const { repo, worktree } = matchSession(session.directory, scanned);
      return { kind: "session", session, repo, worktree: displayWorktree(worktree) } as const;
    }),
    ...(knownGroups.length > 0 ? [{ kind: "heading", title: "Workspaces" } as const] : []),
    ...knownGroups.map((group) => ({ kind: "repo", group }) as const),
    ...(otherGroups.length > 0 ? [{ kind: "heading", title: "Other folders" } as const] : []),
    ...otherGroups.map((group) => ({ kind: "repo", group }) as const),
  ];

  // The header is transparent, so content sits under it and has to pad
  // itself by the header's real height rather than a hand-rolled constant.
  const navBarHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  // Measured, not a fixed height — the composer grows with multi-line
  // input, and it floats over the list (absolute) so the glass has
  // content behind it, meaning the list has to reserve the space itself.
  // Same approach as SessionChatScreen's own composer.
  const [composerHeight, setComposerHeight] = React.useState(0);

  return (
    <View style={styles.root}>
      {/* ScrollViewMarker resolves the scroll view from its own direct
        * subtree, instead of the screen-level `scrollEdgeEffects` option,
        * which relies on RNSScrollViewFinder walking `subviews[0]` down
        * from the screen root and silently no-ops if it lands anywhere
        * else. That screen-level route produced nothing here across every
        * variation tried, so this marks the list explicitly. */}
      <ScrollViewMarker style={styles.list} scrollEdgeEffects={{ top: "soft", bottom: "soft" }}>
      <FlatList
        style={styles.list}
        data={rows}
        keyExtractor={(row, i) => (row.kind === "heading" ? `h-${row.title}` : row.kind === "session" ? row.session.id : `r-${row.group.repo}-${i}`)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.secondaryLabel} />}
        ListHeaderComponent={
          loading ? (
            <Text style={styles.hint}>Loading…</Text>
          ) : sessions.length === 0 && error === undefined ? (
            <Text style={styles.hint}>No sessions yet.</Text>
          ) : error !== undefined ? (
            <Text style={styles.error}>{error}</Text>
          ) : null
        }
        renderItem={({ item, index }) => {
          if (item.kind === "heading") {
            return <Text style={[styles.heading, index === 0 && styles.headingFirst]}>{item.title}</Text>;
          }
          if (item.kind === "session") {
            return (
              <TouchableOpacity style={styles.card} activeOpacity={0.7} onPress={() => props.navigation.navigate("Chat", { sessionID: item.session.id })}>
                <Text style={styles.cardTitle} numberOfLines={2}>
                  {item.session.title}
                </Text>
                <View style={styles.badgeRow}>
                  <Text style={styles.badge}>{item.repo}</Text>
                  {item.worktree !== undefined ? <Text style={[styles.badge, styles.badgeAccent]}>{item.worktree}</Text> : null}
                </View>
                <Text style={styles.cardMeta}>{relativeTime(item.session.time.updated)}</Text>
              </TouchableOpacity>
            );
          }
          const sessionCount = item.group.sessions.length;
          const worktreeCount = item.group.worktrees.size;
          const mostRecentTitle = item.group.sessions[0]?.title;
          const metaParts = [
            `${sessionCount} session${sessionCount === 1 ? "" : "s"}`,
            ...(worktreeCount > 1 ? [`${worktreeCount} worktrees`] : []),
            relativeTime(item.group.mostRecentUpdate),
          ];
          return (
            <TouchableOpacity style={styles.card} activeOpacity={0.7}>
              <View style={styles.repoCardHeader}>
                <SystemIcon
                  name={item.group.isKnownRepo ? "shippingbox" : "folder"}
                  size={16}
                  color={colors.secondaryLabel}
                />
                <Text style={[styles.cardTitle, styles.repoCardTitle]} numberOfLines={1}>
                  {item.group.repo}
                </Text>
                <SystemIcon name="chevron.right" size={14} color={colors.secondaryLabel} />
              </View>
              {mostRecentTitle !== undefined ? (
                <Text style={styles.repoCardSubtitle} numberOfLines={1}>
                  {mostRecentTitle}
                </Text>
              ) : null}
              <Text style={styles.cardMeta}>{metaParts.join(" · ")}</Text>
            </TouchableOpacity>
          );
        }}
        contentContainerStyle={[styles.content, { paddingTop: navBarHeight, paddingBottom: composerHeight + keyboardHeight + 16 }]}
      />
      </ScrollViewMarker>
      <EdgeBlurBars bottomInset={keyboardHeight} />
      <View style={[styles.composerFloat, { bottom: keyboardHeight }]} onLayout={(e) => setComposerHeight(e.nativeEvent.layout.height)}>
        <Composer
          onSend={onSend}
          disabled={sending || target === undefined}
          bottomInset={keyboardHeight > 0 ? 0 : insets.bottom}
          placeholder="Plan, ask, build…"
          topSection={
            <HomeTargetPickers
              scanned={scanned}
              otherFolders={sessionFolders}
              activityByName={activityByName}
              target={target}
              onChange={setTarget}
              onWorkspaceChanged={refreshWorktrees}
            />
          }
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  list: {
    flex: 1,
  },
  composerFloat: {
    position: "absolute",
    left: 0,
    right: 0,
    // `bottom` is set inline from keyboardHeight — see the element itself.
  },
  content: {
    paddingBottom: 32,
  },
  hint: {
    color: colors.secondaryLabel,
    paddingHorizontal: 16,
  },
  error: {
    color: colors.destructive,
    paddingHorizontal: 16,
  },
  heading: {
    color: colors.secondaryLabel,
    fontSize: 15,
    fontWeight: "400",
    marginTop: 22,
    marginBottom: 10,
    marginHorizontal: 16,
  },
  headingFirst: {
    marginTop: 4,
  },
  card: {
    marginHorizontal: 12,
    marginBottom: 10,
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.cardBackground,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
  },
  cardTitle: {
    color: colors.label,
    fontSize: 17,
    fontWeight: "600",
  },
  badgeRow: {
    flexDirection: "row",
    gap: 6,
    marginTop: 8,
  },
  badge: {
    color: colors.secondaryLabel,
    fontSize: 11,
    fontWeight: "600",
    backgroundColor: colors.fillBackground,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: "hidden",
  },
  badgeAccent: {
    color: colors.tint,
    backgroundColor: colors.accentTint,
  },
  cardMeta: {
    color: colors.secondaryLabel,
    fontSize: 11,
    marginTop: 8,
  },
  repoCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  repoCardTitle: {
    flex: 1,
  },
  repoCardSubtitle: {
    color: colors.secondaryLabel,
    fontSize: 14,
    marginTop: 6,
  },
});
