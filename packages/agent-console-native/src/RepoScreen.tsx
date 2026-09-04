/**
 * The screen you get when you open a repo or workspace: a collapsing glass
 * header (squircle) holding the repo/workspace info + a menu of its views,
 * over a scrolling list of that repo's chat sessions.
 *
 * The collapse is finger-tracked on the UI thread (Reanimated) — the OS
 * large-title collapse can't host custom glass content, so we drive it
 * ourselves, animating RN containers (never the SwiftUI glass internals) so the
 * real `expo-glass-effect` GlassView keeps rendering throughout. See
 * docs/handoffs/double-agent-repo-screen-and-plugin-system.md.
 *
 * A "repo" is a git checkout (menu: Files · Docs · Commits · Pull Requests); a
 * "workspace" is a non-git session folder (menu: Files · Docs only).
 *
 * @internal
 */
import type { Session } from "@opencode-ai/sdk";
import { GlassView } from "expo-glass-effect";
import * as React from "react";
import { Pressable, RefreshControl, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from "react-native";
import type { ColorValue } from "react-native";
import Animated, { Extrapolation, interpolate, runOnJS, useAnimatedReaction, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { SFSymbol } from "sf-symbols-typescript";
import { WORKTREE_SETUP_PREFIX } from "./agentConstants";
import { useAppContext } from "./AppContext";
import { colors } from "./colors";
import { displayWorktree, groupByRepo, MAIN_WORKTREE, matchSession } from "./repoGrouping";
import type { ScannedRepo } from "./repoScan";
import { readWorkspace } from "./repoScanCache";
import type { RootStackParamList } from "./RootNavigator";
import { getCachedSessions, setCachedSessions } from "./sessionCache";
import { getSetupDate, loadReads } from "./sessionReads";
import { SystemIcon } from "./SystemIcon";
import { relativeTime } from "./time";

type Props = NativeStackScreenProps<RootStackParamList, "Repo">;

const BAR_CONTENT_HEIGHT = 44;
const SQUIRCLE_INSET = 12;
const BODY_TOP_GAP = 6;
const BODY_BOTTOM_PAD = 10;
const DEFAULT_BODY_HEIGHT = 250;
const GLASS_BUTTON = 44;
const BUTTON_ICON = 20;
const BAR_EDGE_INSET = 16;
/** Margins that exist ONLY when expanded — animated to 0 on collapse. */
const TOP_MARGIN = 10;
const SIDE_MARGIN = 10;

/** Glass ease-in: solid, then a fast falloff. Fractions of the collapse
 * distance, scaled to px in the component. The inner-header margins reuse this
 * exact curve so they track the glass. */
const GLASS_FADE_IN = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1];
const GLASS_FADE_OUT = [1, 1, 1, 0.99, 0.97, 0.9, 0.6, 0.2, 0];
/** false = fade the squircle wrapper's opacity; true = slide it out. */
const SQUIRCLE_FADE_BY_TRANSLATE = false;

type MenuItem = { readonly label: string; readonly icon: SFSymbol };
const REPO_MENU: ReadonlyArray<MenuItem> = [
  { label: "Files", icon: "folder" },
  { label: "Docs", icon: "book" },
  { label: "Commits", icon: "arrow.triangle.branch" },
  { label: "Pull Requests", icon: "arrow.triangle.merge" },
];
/** A workspace isn't a git checkout, so no Commits / PRs. */
const WORKSPACE_MENU: ReadonlyArray<MenuItem> = [
  { label: "Files", icon: "folder" },
  { label: "Docs", icon: "book" },
];

/**
 * Per-session indicator dot. `unread` is the plain secondary-colored dot; the
 * rest light up once a status source is wired (push notification `kind`:
 * idle → response, permission → question; `failure` has no source yet). Colors
 * kept in one place so the whole set stays coherent.
 */
export type SessionIndicatorKind = "unread" | "response" | "question" | "failure";
const INDICATOR_COLORS: Record<SessionIndicatorKind, ColorValue> = {
  unread: colors.themeSecondary,
  response: colors.brand,
  question: colors.warning,
  failure: colors.destructive,
};

/** A few most-recent sessions across all worktrees, up top for quick access. */
const RECENT_COUNT = 3;
/** Sessions shown per group before "See all" — scaled to screen height so a
 * phone shows ~3 and a tablet more. `height / DIVISOR`, clamped. */
const PER_GROUP_DIVISOR = 230;
const PER_GROUP_MIN = 3;
const PER_GROUP_MAX = 7;

export const RepoScreen = (props: Props): React.ReactElement => {
  const { name, dir, isRepo } = props.route.params;
  const { client } = useAppContext();
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  // Taller screen → more sessions per group.
  const perGroup = Math.max(PER_GROUP_MIN, Math.min(PER_GROUP_MAX, Math.floor(screenHeight / PER_GROUP_DIVISOR)));

  const [sessions, setSessions] = React.useState<ReadonlyArray<Session>>([]);
  const [scanned, setScanned] = React.useState<ReadonlyArray<ScannedRepo>>([]);
  const [refreshing, setRefreshing] = React.useState(false);
  const [reads, setReads] = React.useState<ReadonlyMap<string, number>>(new Map());
  // Sessions older than the app's setup date count as already-read. Default to
  // now so nothing flashes as unread before the real (earlier) date loads.
  const [setupDate, setSetupDate] = React.useState<number>(() => Date.now());

  // Reload read state whenever the screen refocuses (e.g. back from a chat that
  // just marked itself read), so Unread updates.
  useFocusEffect(
    React.useCallback(() => {
      void Promise.all([loadReads(), getSetupDate()]).then(([nextReads, date]) => {
        setReads(nextReads);
        setSetupDate(date);
      });
    }, []),
  );

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

  // This repo/workspace's own sessions, via the shared grouping logic.
  const group = React.useMemo(() => groupByRepo(sessions, scanned).find((g) => g.repo === name), [sessions, scanned, name]);
  const repoSessions = group?.sessions ?? [];
  const worktreeCount = group?.worktrees.size ?? 0;
  const menu = isRepo ? REPO_MENU : WORKSPACE_MENU;

  // Unread = updated since you last opened it AND since app setup (so a fresh
  // install doesn't treat every pre-existing session as unread).
  const isUnread = (session: Session): boolean => session.time.updated > Math.max(reads.get(session.id) ?? 0, setupDate);
  const recent = repoSessions.slice(0, RECENT_COUNT);
  const unread = repoSessions.filter(isUnread).slice(0, perGroup);
  const worktreeGroups: ReadonlyArray<readonly [string, ReadonlyArray<Session>]> = group ? [...group.worktrees.entries()] : [];
  // Group by worktree only when there's more than one; otherwise a flat list.
  const grouped = worktreeGroups.length > 1;

  // A section heading; `unreadCount` right-aligns an accent pill when > 0.
  const sectionHeader = (title: string, unreadCount = 0): React.ReactElement => (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionHeading}>{title}</Text>
      {unreadCount > 0 ? (
        <View style={styles.unreadPill}>
          <Text style={styles.unreadPillText}>{unreadCount}</Text>
        </View>
      ) : null}
    </View>
  );

  // `keyPrefix` keeps keys unique when a session shows in more than one section
  // (Unread + Recent + its worktree group).
  const sessionCard = (session: Session, showWorktree: boolean, keyPrefix: string): React.ReactElement => {
    const wt = showWorktree ? displayWorktree(matchSession(session.directory, scanned).worktree) : undefined;
    return (
      <TouchableOpacity
        key={`${keyPrefix}-${session.id}`}
        style={styles.card}
        activeOpacity={0.7}
        onPress={() => props.navigation.navigate("Chat", { sessionID: session.id })}
      >
        {isUnread(session) ? <View style={[styles.cardIndicator, { backgroundColor: INDICATOR_COLORS.unread }]} /> : null}
        <Text
          style={[styles.cardTitle, isUnread(session) && styles.cardTitleUnread]}
          numberOfLines={2}
        >
          {session.title}
        </Text>
        {wt !== undefined ? <Text style={styles.badge}>{wt}</Text> : null}
        <Text style={styles.cardMeta}>{relativeTime(session.time.updated)}</Text>
      </TouchableOpacity>
    );
  };

  const seeAllRow = (worktree: string | null, count: number, title: string): React.ReactElement => (
    <TouchableOpacity
      key={`all-${worktree ?? "repo"}`}
      style={styles.seeAll}
      activeOpacity={0.6}
      onPress={() => props.navigation.navigate("SessionList", { repo: name, worktree, title })}
    >
      <Text style={styles.seeAllText}>See all {count} sessions</Text>
      <SystemIcon
        name="chevron.forward"
        size={13}
        color={colors.secondaryLabel}
      />
    </TouchableOpacity>
  );

  const metaParts = [
    `${repoSessions.length} session${repoSessions.length === 1 ? "" : "s"}`,
    ...(isRepo && worktreeCount > 1 ? [`${worktreeCount} worktrees`] : []),
    ...(group !== undefined ? [relativeTime(group.mostRecentUpdate)] : []),
  ];

  // --- Collapse geometry -----------------------------------------------------
  const [bodyHeight, setBodyHeight] = React.useState(DEFAULT_BODY_HEIGHT);
  const collapsedH = insets.top + BAR_CONTENT_HEIGHT;
  const expandedH = collapsedH + TOP_MARGIN + BODY_TOP_GAP + bodyHeight + BODY_BOTTOM_PAD;
  const collapseDistance = expandedH - collapsedH;
  const glassFadeInPx = GLASS_FADE_IN.map((f) => f * collapseDistance);

  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });

  const headerStyle = useAnimatedStyle(() => ({
    height: interpolate(scrollY.value, [0, collapseDistance], [expandedH, collapsedH], Extrapolation.CLAMP),
  }));

  const squircleStyle = useAnimatedStyle(() => {
    if (SQUIRCLE_FADE_BY_TRANSLATE) {
      return { transform: [{ translateY: interpolate(scrollY.value, [0, collapseDistance], [0, -collapseDistance], Extrapolation.CLAMP) }] };
    }
    return { opacity: interpolate(scrollY.value, glassFadeInPx, GLASS_FADE_OUT, Extrapolation.CLAMP) };
  });

  // Clip the body to a shrinking height (overflow:hidden) so its content is cut
  // off at the glass edge as it collapses instead of spilling out. This is a
  // no-shadow layer, so clipping it doesn't touch the squircle's drop shadow.
  const bodyStyle = useAnimatedStyle(() => ({
    height: interpolate(scrollY.value, [0, collapseDistance], [bodyHeight, 0], Extrapolation.CLAMP),
    opacity: interpolate(scrollY.value, [0, collapseDistance * 0.3], [1, 0], Extrapolation.CLAMP),
  }));

  // Inner-header margins ride the SAME curve as the glass (solid, then falloff).
  const innerHeaderStyle = useAnimatedStyle(() => {
    const expand = interpolate(scrollY.value, glassFadeInPx, GLASS_FADE_OUT, Extrapolation.CLAMP);
    return {
      transform: [{ translateY: TOP_MARGIN * expand }],
      paddingHorizontal: BAR_EDGE_INSET + SIDE_MARGIN * expand,
    };
  });

  // Pill glass exists only when collapsed. Toggled via glassEffectStyle (with a
  // native animate), never opacity — animating a GlassView's opacity stops it
  // rendering glass.
  const [collapsed, setCollapsed] = React.useState(false);
  useAnimatedReaction(
    () => scrollY.value > collapseDistance * 0.7,
    (isCollapsed, previous) => {
      if (isCollapsed !== previous) runOnJS(setCollapsed)(isCollapsed);
    },
  );

  return (
    <View style={styles.root}>
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.secondaryLabel} />}
        contentContainerStyle={{
          paddingTop: expandedH + 12,
          paddingBottom: insets.bottom + 40,
        }}
      >
        {repoSessions.length === 0 ? (
          <Text style={styles.empty}>No sessions in this {isRepo ? "repo" : "workspace"} yet.</Text>
        ) : (
          <>
            {unread.length > 0 ? (
              <>
                {sectionHeader("Unread")}
                {unread.map((session) => sessionCard(session, true, "unread"))}
              </>
            ) : null}

            {grouped ? (
              <>
                {sectionHeader("Recent")}
                {recent.map((session) => sessionCard(session, true, "recent"))}
                {worktreeGroups.map(([worktree, worktreeSessions]) => {
                  const heading = displayWorktree(worktree) ?? (worktree === MAIN_WORKTREE ? "Main" : "Sessions");
                  return (
                    <React.Fragment key={worktree}>
                      {sectionHeader(heading, worktreeSessions.filter(isUnread).length)}
                      {worktreeSessions.slice(0, perGroup).map((session) => sessionCard(session, false, worktree))}
                      {worktreeSessions.length > perGroup ? seeAllRow(worktree, worktreeSessions.length, heading) : null}
                    </React.Fragment>
                  );
                })}
              </>
            ) : (
              <>
                {sectionHeader("Sessions", repoSessions.filter(isUnread).length)}
                {repoSessions.slice(0, perGroup).map((session) => sessionCard(session, false, "flat"))}
                {repoSessions.length > perGroup ? seeAllRow(null, repoSessions.length, "Sessions") : null}
              </>
            )}
          </>
        )}
      </Animated.ScrollView>

      {/* Collapsing glass header. */}
      <Animated.View
        pointerEvents="box-none"
        style={[styles.header, headerStyle]}
      >
        <Animated.View
          pointerEvents="none"
          style={[styles.squircleWrap, { top: insets.top, left: SQUIRCLE_INSET, right: SQUIRCLE_INSET }, squircleStyle]}
        >
          <GlassView
            style={styles.squircleGlass}
            glassEffectStyle="regular"
          />
        </Animated.View>

        {/* Body — repo/workspace info, then the menu. Measured so the glass box
         * hugs its contents. */}
        <Animated.View
          pointerEvents="box-none"
          style={[
            styles.body,
            { top: insets.top + BAR_CONTENT_HEIGHT + TOP_MARGIN + BODY_TOP_GAP, left: SQUIRCLE_INSET + 6, right: SQUIRCLE_INSET + 6 },
            bodyStyle,
          ]}
        >
          {/* Inner wrapper is measured (natural height) so the outer clip's
           * animated height doesn't feed back into the measurement. */}
          <View onLayout={(event) => setBodyHeight(event.nativeEvent.layout.height)}>
          <View style={styles.info}>
            <Text style={styles.infoMeta}>{metaParts.join(" · ")}</Text>
          </View>

          <View style={styles.menuSeparator} />

          {menu.map((item, index) => (
            <Pressable
              key={item.label}
              style={styles.menuRow}
              onPress={() => {}}
            >
              {index > 0 ? <View style={styles.rowSeparator} /> : null}
              <SystemIcon
                name={item.icon}
                size={20}
                color={colors.tint}
              />
              <Text style={styles.menuLabel}>{item.label}</Text>
              <SystemIcon
                name="chevron.forward"
                size={13}
                color={colors.secondaryLabel}
              />
            </Pressable>
          ))}
          </View>
        </Animated.View>

        {/* Inner-header: back · name · 3-dot. Margins present when expanded,
         * animating to the chat bar as it collapses. */}
        <Animated.View style={[styles.innerHeader, { top: insets.top, height: BAR_CONTENT_HEIGHT }, innerHeaderStyle]}>
          <Pressable
            onPress={() => props.navigation.goBack()}
            hitSlop={8}
          >
            <GlassView
              style={styles.glassButton}
              isInteractive
            >
              <SystemIcon
                name="chevron.backward"
                size={BUTTON_ICON}
                color={colors.label}
              />
            </GlassView>
          </Pressable>

          <View style={styles.namePillWrap}>
            <GlassView
              style={styles.namePillGlass}
              glassEffectStyle={{ style: collapsed ? "regular" : "none", animate: true }}
            />
            <Text
              numberOfLines={1}
              style={styles.nameText}
            >
              {name}
            </Text>
            <Text
              numberOfLines={1}
              ellipsizeMode="middle"
              style={styles.namePath}
            >
              {dir}
            </Text>
          </View>

          <Pressable
            onPress={() => {}}
            hitSlop={8}
          >
            <GlassView
              style={styles.glassButton}
              isInteractive
            >
              <SystemIcon
                name="ellipsis"
                size={BUTTON_ICON}
                color={colors.label}
              />
            </GlassView>
          </Pressable>
        </Animated.View>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
  },
  squircleWrap: {
    position: "absolute",
    bottom: 0,
  },
  squircleGlass: {
    flex: 1,
    borderRadius: 28,
  },
  body: {
    position: "absolute",
    paddingHorizontal: 6,
    overflow: "hidden",
  },
  info: {
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 14,
    gap: 5,
    alignItems: "center",
  },
  infoMeta: {
    color: colors.secondaryLabel,
    fontSize: 13,
    textAlign: "center",
  },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 13,
    paddingHorizontal: 10,
  },
  menuSeparator: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 10,
    backgroundColor: colors.separator,
  },
  rowSeparator: {
    position: "absolute",
    top: 0,
    left: 44,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.separator,
  },
  menuLabel: {
    flex: 1,
    color: colors.label,
    fontSize: 17,
  },
  innerHeader: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  glassButton: {
    width: GLASS_BUTTON,
    height: GLASS_BUTTON,
    borderRadius: GLASS_BUTTON / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  namePillWrap: {
    flexShrink: 1,
    borderRadius: BAR_CONTENT_HEIGHT / 2,
    paddingHorizontal: 16,
    paddingVertical: 5,
    alignItems: "center",
    justifyContent: "center",
    gap: 1,
  },
  namePillGlass: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: BAR_CONTENT_HEIGHT / 2,
  },
  nameText: {
    color: colors.label,
    fontSize: 15,
    fontWeight: "600",
  },
  namePath: {
    maxWidth: "100%",
    color: colors.secondaryLabel,
    fontSize: 11,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginHorizontal: 16,
    marginTop: 20,
    marginBottom: 10,
  },
  sectionHeading: {
    color: colors.label,
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  unreadPill: {
    minWidth: 22,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 11,
    backgroundColor: colors.themeSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  unreadPillText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  seeAll: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    marginHorizontal: 16,
    marginTop: 2,
    marginBottom: 6,
    paddingVertical: 9,
  },
  seeAllText: {
    color: colors.secondaryLabel,
    fontSize: 15,
    fontWeight: "600",
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
  cardIndicator: {
    position: "absolute",
    top: 16,
    right: 14,
    width: 9,
    height: 9,
    borderRadius: 4.5,
    // color set inline from INDICATOR_COLORS by kind
  },
  cardTitle: {
    color: colors.label,
    fontSize: 16,
    fontWeight: "500",
    paddingRight: 16,
  },
  cardTitleUnread: {
    fontWeight: "700",
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
