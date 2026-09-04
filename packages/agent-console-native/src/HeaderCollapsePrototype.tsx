/**
 * THROWAWAY PROTOTYPE — not the real repo screen. Its only job is to prove,
 * on-device, that a finger-tracked collapsing glass header feels native and
 * that the glass de-materializes cleanly under the finger. See
 * docs/handoffs/double-agent-repo-screen-and-plugin-system.md §2.2–2.4.
 *
 * Why this shape (researched against the installed versions, 2026-09):
 * - The OS large-title collapse (`headerLargeTitle`) is TEXT ONLY — it does
 *   not accept a custom React component and a custom `headerTitle` doesn't
 *   animate with the collapse. So the native bar can't carry our glass
 *   squircle; we drive the collapse ourselves.
 * - We drive it with Reanimated on the UI thread (finger-tracked, 120fps),
 *   animating the RN *containers* (height / opacity), never the SwiftUI glass
 *   internals — so there is no per-frame work crossing the @expo/ui bridge.
 *   The glass stays real `expo-glass-effect` `GlassView` throughout.
 *
 * The one thing this prototype exists to answer: HOW the squircle glass goes
 * transparent under the finger. `expo-glass-effect`'s docs warn that changing
 * glass via `opacity` can cause rendering issues, so three candidates are
 * lined up (see SQUIRCLE_FADE below) — swap between them on-device and keep
 * whichever looks right.
 *
 * @internal
 */
import { GlassView } from "expo-glass-effect";
import * as React from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Animated, { Extrapolation, interpolate, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { SFSymbol } from "sf-symbols-typescript";
import { colors } from "./colors";
import type { RootStackParamList } from "./RootNavigator";
import { SystemIcon } from "./SystemIcon";

type Props = NativeStackScreenProps<RootStackParamList, "HeaderPrototype">;

/** The pinned inner-header row height — matches SessionHeaderTitle's 44pt pill
 * and the chat bar's item line, so the collapsed end-state lines up. */
const BAR_CONTENT_HEIGHT = 44;
/** How much taller the expanded squircle is than the collapsed bar — the body
 * (menu / favorites / plugins) lives in this band. Scrolling this far fully
 * collapses the header. */
const EXPANDED_EXTRA = 300;
/** Horizontal inset of the squircle from the screen edges. */
const SQUIRCLE_INSET = 10;
/** Glass back/3-dot circles — sized to match the app's native bar items. */
const GLASS_BUTTON = 44;
const BUTTON_ICON = 20;
/** Inset of the inner-header row from the screen edges — where the chat bar's
 * own items sit, so the collapsed state lines up with it. */
const BAR_EDGE_INSET = 16;

/**
 * Glass-opacity easing for the squircle fading out — solid for the first
 * stretch of the scroll, then ramping off fast (100·100·100·99·97·90·60·20·0).
 * Precomputed to px against EXPANDED_EXTRA so the worklet only reads number
 * arrays. This curve is ONLY for the glass; the body uses a faster, near-linear
 * fade (see bodyStyle) so the hidden content disappears sooner.
 */
const GLASS_FADE_IN_PX = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1].map((f) => f * EXPANDED_EXTRA);
const GLASS_FADE_OUT = [1, 1, 1, 0.99, 0.97, 0.9, 0.6, 0.2, 0];

/**
 * How the squircle glass de-materializes — flip this on-device to compare,
 * this choice is the whole point of the prototype.
 * - false (default): animate the opacity of the RN View WRAPPING the GlassView
 *   (parent compositing, not the glass's own opacity prop). Smooth and
 *   continuous if it doesn't artifact.
 * - true: slide the glass up out of the clipped header instead of fading —
 *   dodges expo-glass-effect's opacity warning entirely.
 * (A third option, animating `glassEffectStyle` regular→clear, is discrete, so
 *  it can't track the finger continuously — left out here on purpose.)
 */
const SQUIRCLE_FADE_BY_TRANSLATE = false;

export const HeaderCollapsePrototype = (props: Props): React.ReactElement => {
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();

  const collapsedH = insets.top + BAR_CONTENT_HEIGHT;
  const expandedH = collapsedH + EXPANDED_EXTRA;
  // Scrolling `EXPANDED_EXTRA` points takes p from 0 (expanded) to 1 (collapsed).
  const collapseDistance = EXPANDED_EXTRA;
  const pillWidth = Math.round(screenWidth * 0.5);

  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });

  // Header shrinks from expandedH to collapsedH. overflow:hidden on the
  // container clips the body away as it shrinks; the inner-header row is
  // pinned at top:insets.top and never moves.
  const headerStyle = useAnimatedStyle(() => ({
    height: interpolate(scrollY.value, [0, collapseDistance], [expandedH, collapsedH], Extrapolation.CLAMP),
  }));

  // The squircle glass de-materializing — the candidate under test.
  const squircleStyle = useAnimatedStyle(() => {
    if (SQUIRCLE_FADE_BY_TRANSLATE) {
      return {
        transform: [{ translateY: interpolate(scrollY.value, [0, collapseDistance], [0, -EXPANDED_EXTRA], Extrapolation.CLAMP) }],
      };
    }
    return {
      // Solid first, then ramps off fast — see GLASS_FADE_OUT.
      opacity: interpolate(scrollY.value, GLASS_FADE_IN_PX, GLASS_FADE_OUT, Extrapolation.CLAMP),
    };
  });

  // The hidden content (menu / favorites / plugins) disappears FAST and nearly
  // linear — gone by ~30% of the collapse, not eased like the glass.
  const bodyStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, collapseDistance * 0.3], [1, 0], Extrapolation.CLAMP),
  }));

  // The name's own glass capsule fades IN as it collapses — 0 while expanded
  // (the squircle is the surface), 1 when collapsed (it becomes the chat pill).
  const nameGlassStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [collapseDistance * 0.2, collapseDistance], [0, 1], Extrapolation.CLAMP),
  }));

  return (
    <View style={styles.root}>
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{
          paddingTop: expandedH + 8,
          paddingBottom: insets.bottom + 40,
        }}
      >
        {DUMMY_ROWS.map((label) => (
          <View
            key={label}
            style={styles.contentRow}
          >
            <Text style={styles.contentRowText}>{label}</Text>
          </View>
        ))}
      </Animated.ScrollView>

      {/* Pinned, collapsing header. */}
      <Animated.View
        pointerEvents="box-none"
        style={[styles.header, headerStyle]}
      >
        {/* The squircle glass surface. */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.squircleWrap,
            { top: insets.top, left: SQUIRCLE_INSET, right: SQUIRCLE_INSET },
            squircleStyle,
          ]}
        >
          <GlassView
            style={styles.squircleGlass}
            glassEffectStyle="regular"
          />
        </Animated.View>

        {/* Body — the repo Menu as a real iOS grouped list, sitting on the
         * glass (hairline-separated rows, SF icon · label · chevron). */}
        <Animated.View
          pointerEvents="box-none"
          style={[
            styles.body,
            { top: insets.top + BAR_CONTENT_HEIGHT + 8, left: SQUIRCLE_INSET + 6, right: SQUIRCLE_INSET + 6 },
            bodyStyle,
          ]}
        >
          {MENU_ITEMS.map((item, index) => (
            <Pressable
              key={item.label}
              style={styles.menuRow}
              onPress={() => {}}
            >
              {index > 0 ? <View style={styles.menuSeparator} /> : null}
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

        {/* Inner-header row: back · name · 3-dot. Pinned at top:insets.top, so
         * it does not move through the collapse. This is the row that must end
         * up matching the chat top bar. */}
        <View
          style={[styles.innerHeader, { top: insets.top, height: BAR_CONTENT_HEIGHT }]}
        >
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

          {/* Center: name over a glass capsule that fades in on collapse, so at
           * p=1 it reads as the chat header's title pill (name + connection
           * dot, 44pt capsule). */}
          <View style={{ width: pillWidth, height: BAR_CONTENT_HEIGHT }}>
            <Animated.View style={[StyleSheet.absoluteFill, nameGlassStyle]}>
              <GlassView
                style={styles.namePill}
                glassEffectStyle="regular"
              />
            </Animated.View>
            <View style={styles.nameTextWrap}>
              <View style={styles.nameSpacer} />
              <Text
                numberOfLines={1}
                style={styles.nameText}
              >
                effect-pm
              </Text>
              <View style={styles.nameSpacer} />
              <View style={styles.connectionDot} />
            </View>
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
        </View>
      </Animated.View>
    </View>
  );
};

const DUMMY_ROWS = Array.from({ length: 30 }, (_, i) => `Scroll content row ${i + 1}`);
const MENU_ITEMS: ReadonlyArray<{ readonly label: string; readonly icon: SFSymbol }> = [
  { label: "Files", icon: "folder" },
  { label: "Docs", icon: "book" },
  { label: "Commits", icon: "arrow.triangle.branch" },
  { label: "Pull Requests", icon: "arrow.triangle.merge" },
];

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    // No overflow:hidden — it would clip the squircle's drop shadow at the
    // bottom edge (an ancestor clip masks a descendant's shadow on iOS). The
    // squircle shrinks via its own animated height and the body fades on
    // opacity, so nothing here needs clipping.
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
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 13,
    paddingHorizontal: 10,
  },
  menuSeparator: {
    position: "absolute",
    top: 0,
    // Leading inset past the icon column, iOS-list style.
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
    left: BAR_EDGE_INSET,
    right: BAR_EDGE_INSET,
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
  namePill: {
    flex: 1,
    borderRadius: BAR_CONTENT_HEIGHT / 2,
  },
  nameTextWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
  },
  nameSpacer: {
    flex: 1,
  },
  nameText: {
    color: colors.label,
    fontSize: 15,
    fontWeight: "600",
  },
  connectionDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    marginLeft: 6,
    backgroundColor: colors.brand,
  },
  contentRow: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  contentRowText: {
    color: colors.label,
    fontSize: 16,
  },
});
