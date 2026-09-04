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
import { Pressable, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Animated, { Extrapolation, interpolate, runOnJS, useAnimatedReaction, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { SFSymbol } from "sf-symbols-typescript";
import { WORKTREE_SETUP_PREFIX } from "./agentConstants";
import { useAppContext } from "./AppContext";
import { colors } from "./colors";
import { displayWorktree, groupByRepo, matchSession } from "./repoGrouping";
import type { ScannedRepo } from "./repoScan";
import { readWorkspace } from "./repoScanCache";
import type { RootStackParamList } from "./RootNavigator";
import { getCachedSessions, setCachedSessions } from "./sessionCache";
import { SystemIcon } from "./SystemIcon";

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

const relativeTime = (ms: number): string => {
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

export const RepoScreen = (props: Props): React.ReactElement => {
  const { name, dir, isRepo } = props.route.params;
  const { client } = useAppContext();
  const insets = useSafeAreaInsets();

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

  // This repo/workspace's own sessions, via the shared grouping logic.
  const group = React.useMemo(() => groupByRepo(sessions, scanned).find((g) => g.repo === name), [sessions, scanned, name]);
  const repoSessions = group?.sessions ?? [];
  const worktreeCount = group?.worktrees.size ?? 0;
  const menu = isRepo ? REPO_MENU : WORKSPACE_MENU;

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

  const bodyStyle = useAnimatedStyle(() => ({
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
          paddingTop: expandedH + 24,
          paddingBottom: insets.bottom + 40,
        }}
      >
        <Text style={styles.sectionHeading}>Sessions</Text>
        {repoSessions.length === 0 ? (
          <Text style={styles.empty}>No sessions in this {isRepo ? "repo" : "workspace"} yet.</Text>
        ) : (
          repoSessions.map((session) => {
            const worktree = displayWorktree(matchSession(session.directory, scanned).worktree);
            return (
              <TouchableOpacity
                key={session.id}
                style={styles.card}
                activeOpacity={0.7}
                onPress={() => props.navigation.navigate("Chat", { sessionID: session.id })}
              >
                <Text
                  style={styles.cardTitle}
                  numberOfLines={2}
                >
                  {session.title}
                </Text>
                {worktree !== undefined ? <Text style={styles.badge}>{worktree}</Text> : null}
                <Text style={styles.cardMeta}>{relativeTime(session.time.updated)}</Text>
              </TouchableOpacity>
            );
          })
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
          onLayout={(event) => setBodyHeight(event.nativeEvent.layout.height)}
          style={[
            styles.body,
            { top: insets.top + BAR_CONTENT_HEIGHT + TOP_MARGIN + BODY_TOP_GAP, left: SQUIRCLE_INSET + 6, right: SQUIRCLE_INSET + 6 },
            bodyStyle,
          ]}
        >
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
  },
  info: {
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 14,
    gap: 5,
  },
  infoMeta: {
    color: colors.secondaryLabel,
    fontSize: 13,
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
  sectionHeading: {
    color: colors.secondaryLabel,
    fontSize: 15,
    marginTop: 4,
    marginBottom: 10,
    marginHorizontal: 16,
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
