/**
 * The app's one header. It owns the scrolling area and a floating glass header,
 * and adapts to what it's given:
 *
 * - **No `title` → no pill.** With a title, the title rides in the standard
 *   glass pill; without one, the centre is empty.
 * - **No `expanded` → no expanding version.** With expanded content it's a tall
 *   glass squircle that collapses to the bar as you scroll (finger-tracked);
 *   without it, it's just the static bar.
 *
 * Collapse is Reanimated on the UI thread (the OS large-title can't host custom
 * glass), animating RN containers only so the real `expo-glass-effect` glass
 * keeps rendering. See docs/handoffs/double-agent-repo-screen-and-plugin-system.md.
 *
 * @internal
 */
import { GlassView } from "expo-glass-effect";
import * as React from "react";
import { Pressable, RefreshControl, StyleSheet, View } from "react-native";
import Animated, { Extrapolation, interpolate, runOnJS, useAnimatedReaction, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "./colors";
import { EdgeBlurBars } from "./EdgeBlurBars";
import { SystemIcon } from "./SystemIcon";

const BAR_CONTENT_HEIGHT = 44;
const SQUIRCLE_INSET = 12;
const BODY_TOP_GAP = 6;
const BODY_BOTTOM_PAD = 10;
const DEFAULT_BODY_HEIGHT = 250;
const GLASS_BUTTON = 44;
const BUTTON_ICON = 20;
const BAR_EDGE_INSET = 16;
/** Margins present only when expanded, animated to 0 on collapse. */
const TOP_MARGIN = 10;
const SIDE_MARGIN = 10;
/** Glass ease-in: solid, then a fast falloff. Fractions of the collapse
 * distance (scaled in-component); the inner-header margins reuse it. */
const GLASS_FADE_IN = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1];
const GLASS_FADE_OUT = [1, 1, 1, 0.99, 0.97, 0.9, 0.6, 0.2, 0];

export const GlassHeader = (props: {
  /** Title text — omit for no pill. */
  readonly title?: string;
  /** Back button (glass chevron) when provided. */
  readonly onBack?: () => void;
  /** Trailing 3-dot glass button when provided. */
  readonly onMenu?: () => void;
  /** Expanded body — omit for a static bar (no collapse). */
  readonly expanded?: React.ReactNode;
  /** Feathered top blur over the scrolling content (design default: on). */
  readonly topBlur?: boolean;
  readonly refreshing?: boolean;
  readonly onRefresh?: () => void;
  readonly contentBottomPad?: number;
  /** Scrolling content. */
  readonly children: React.ReactNode;
}): React.ReactElement => {
  const insets = useSafeAreaInsets();
  const hasExpanded = props.expanded !== undefined;
  const hasTitle = props.title !== undefined;
  const topBlur = props.topBlur ?? true;

  const [bodyHeight, setBodyHeight] = React.useState(DEFAULT_BODY_HEIGHT);
  // Measured once: the clip animates height, which re-fires onLayout with the
  // shrinking value — measuring only the first real layout keeps that from
  // corrupting the geometry and wedging it collapsed.
  const bodyMeasured = React.useRef(false);

  const collapsedH = insets.top + BAR_CONTENT_HEIGHT;
  const expandedH = hasExpanded ? collapsedH + TOP_MARGIN + BODY_TOP_GAP + bodyHeight + BODY_BOTTOM_PAD : collapsedH;
  const collapseDistance = Math.max(1, expandedH - collapsedH);
  const glassFadeInPx = GLASS_FADE_IN.map((f) => f * collapseDistance);

  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });

  const headerStyle = useAnimatedStyle(() => ({
    height: interpolate(scrollY.value, [0, collapseDistance], [expandedH, collapsedH], Extrapolation.CLAMP),
  }));
  const squircleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, glassFadeInPx, GLASS_FADE_OUT, Extrapolation.CLAMP),
  }));
  const bodyStyle = useAnimatedStyle(() => ({
    height: interpolate(scrollY.value, [0, collapseDistance], [bodyHeight, 0], Extrapolation.CLAMP),
    opacity: interpolate(scrollY.value, [0, collapseDistance * 0.3], [1, 0], Extrapolation.CLAMP),
  }));
  const innerHeaderStyle = useAnimatedStyle(() => {
    const expand = interpolate(scrollY.value, glassFadeInPx, GLASS_FADE_OUT, Extrapolation.CLAMP);
    return {
      transform: [{ translateY: TOP_MARGIN * expand }],
      paddingHorizontal: BAR_EDGE_INSET + SIDE_MARGIN * expand,
    };
  });

  // Pill glass shows when there's nothing to expand (static bar) or when
  // collapsed. Toggled via glassEffectStyle, never opacity.
  const [collapsed, setCollapsed] = React.useState(false);
  useAnimatedReaction(
    () => hasExpanded && scrollY.value > collapseDistance * 0.7,
    (isCollapsed, previous) => {
      if (isCollapsed !== previous) runOnJS(setCollapsed)(isCollapsed);
    },
  );
  const pillGlass = !hasExpanded || collapsed;

  return (
    <View style={styles.root}>
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        refreshControl={props.onRefresh !== undefined ? <RefreshControl refreshing={props.refreshing ?? false} onRefresh={props.onRefresh} tintColor={colors.secondaryLabel} /> : undefined}
        contentContainerStyle={{
          paddingTop: expandedH + 12,
          paddingBottom: (props.contentBottomPad ?? 0) + insets.bottom + 40,
        }}
      >
        {props.children}
      </Animated.ScrollView>

      {topBlur ? <EdgeBlurBars variant="top" /> : null}

      <Animated.View
        pointerEvents="box-none"
        style={[styles.header, hasExpanded ? headerStyle : { height: collapsedH }]}
      >
        {hasExpanded ? (
          <>
            <Animated.View
              pointerEvents="none"
              style={[styles.squircleWrap, { top: insets.top, left: SQUIRCLE_INSET, right: SQUIRCLE_INSET }, squircleStyle]}
            >
              <GlassView
                style={styles.squircleGlass}
                glassEffectStyle="regular"
              />
            </Animated.View>

            <Animated.View
              pointerEvents="box-none"
              style={[styles.body, { top: insets.top + BAR_CONTENT_HEIGHT + TOP_MARGIN + BODY_TOP_GAP, left: SQUIRCLE_INSET + 6, right: SQUIRCLE_INSET + 6 }, bodyStyle]}
            >
              <View
                onLayout={(event) => {
                  if (bodyMeasured.current) return;
                  const measured = event.nativeEvent.layout.height;
                  if (measured > 0) {
                    bodyMeasured.current = true;
                    setBodyHeight(measured);
                  }
                }}
              >
                {props.expanded}
              </View>
            </Animated.View>
          </>
        ) : null}

        <Animated.View style={[styles.innerHeader, { top: insets.top, height: BAR_CONTENT_HEIGHT }, hasExpanded ? innerHeaderStyle : { paddingHorizontal: BAR_EDGE_INSET }]}>
          {props.onBack !== undefined ? (
            <Pressable
              onPress={props.onBack}
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
          ) : (
            <View style={styles.glassButton} />
          )}

          {hasTitle ? (
            <View style={styles.namePillWrap}>
              <GlassView
                style={styles.namePillGlass}
                glassEffectStyle={{ style: pillGlass ? "regular" : "none", animate: true }}
              />
              <Animated.Text
                numberOfLines={1}
                style={styles.nameText}
              >
                {props.title}
              </Animated.Text>
            </View>
          ) : (
            <View />
          )}

          {props.onMenu !== undefined ? (
            <Pressable
              onPress={props.onMenu}
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
          ) : (
            <View style={styles.glassButton} />
          )}
        </Animated.View>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "transparent",
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
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
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
});
