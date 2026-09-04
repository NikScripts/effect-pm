/**
 * The full list of sessions for a repo's worktree (or the whole repo), reached
 * from a "See all N sessions" row on the repo screen. A plain native-header
 * list — no glass squircle here; that's the repo screen's job.
 *
 * @internal
 */
import type { Session } from "@opencode-ai/sdk";
import * as React from "react";
import { FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { ScrollViewMarker } from "react-native-screens/src/components/gamma/scroll-view-marker";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { WORKTREE_SETUP_PREFIX } from "./agentConstants";
import { useAppContext } from "./AppContext";
import { colors } from "./colors";
import { displayWorktree, groupByRepo, matchSession } from "./repoGrouping";
import type { ScannedRepo } from "./repoScan";
import { readWorkspace } from "./repoScanCache";
import type { RootStackParamList } from "./RootNavigator";
import { getCachedSessions, setCachedSessions } from "./sessionCache";
import { relativeTime } from "./time";

type Props = NativeStackScreenProps<RootStackParamList, "SessionList">;

export const SessionListScreen = (props: Props): React.ReactElement => {
  const { repo, worktree } = props.route.params;
  const { client } = useAppContext();
  const headerHeight = useHeaderHeight();

  const [sessions, setSessions] = React.useState<ReadonlyArray<Session>>([]);
  const [scanned, setScanned] = React.useState<ReadonlyArray<ScannedRepo>>([]);
  const [refreshing, setRefreshing] = React.useState(false);

  const load = React.useCallback(async (): Promise<void> => {
    const [list, scan] = await Promise.all([client.session.list(), readWorkspace()]);
    if (list.error === undefined && list.data !== undefined) {
      const visible = list.data.filter((s) => !s.title.startsWith(WORKTREE_SETUP_PREFIX));
      setSessions(visible);
      void setCachedSessions(visible);
    }
    if (scan !== undefined) setScanned(scan);
  }, [client]);

  React.useEffect(() => {
    void (async () => {
      const [cachedSessions, cachedScan] = await Promise.all([getCachedSessions(), readWorkspace()]);
      if (cachedSessions !== undefined) setSessions(cachedSessions);
      if (cachedScan !== undefined) setScanned(cachedScan);
      await load();
    })();
  }, [load]);

  const onRefresh = React.useCallback((): void => {
    setRefreshing(true);
    void load().finally(() => setRefreshing(false));
  }, [load]);

  const group = React.useMemo(() => groupByRepo(sessions, scanned).find((g) => g.repo === repo), [sessions, scanned, repo]);
  // `worktree === null` means the whole repo; otherwise just that worktree's.
  const listed = worktree === null ? (group?.sessions ?? []) : (group?.worktrees.get(worktree) ?? []);

  return (
    <ScrollViewMarker
      style={styles.root}
      scrollEdgeEffects={{ top: "soft", bottom: "soft" }}
    >
      <FlatList
        data={listed}
        keyExtractor={(session) => session.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.secondaryLabel} />}
        contentContainerStyle={{ paddingTop: headerHeight + 8, paddingBottom: 40 }}
        ListEmptyComponent={<Text style={styles.empty}>No sessions.</Text>}
        renderItem={({ item }) => {
          const wt = displayWorktree(matchSession(item.directory, scanned).worktree);
          return (
            <TouchableOpacity
              style={styles.card}
              activeOpacity={0.7}
              onPress={() => props.navigation.navigate("Chat", { sessionID: item.id })}
            >
              <Text
                style={styles.cardTitle}
                numberOfLines={2}
              >
                {item.title}
              </Text>
              {wt !== undefined ? <Text style={styles.badge}>{wt}</Text> : null}
              <Text style={styles.cardMeta}>{relativeTime(item.time.updated)}</Text>
            </TouchableOpacity>
          );
        }}
      />
    </ScrollViewMarker>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  empty: {
    color: colors.secondaryLabel,
    paddingHorizontal: 16,
  },
  card: {
    backgroundColor: colors.cardBackground,
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 10,
    gap: 6,
  },
  cardTitle: {
    color: colors.label,
    fontSize: 16,
    fontWeight: "500",
  },
  badge: {
    alignSelf: "flex-start",
    color: colors.tint,
    backgroundColor: colors.accentTint,
    fontSize: 12,
    fontWeight: "600",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: "hidden",
  },
  cardMeta: {
    color: colors.secondaryLabel,
    fontSize: 13,
  },
});
