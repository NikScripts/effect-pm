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
const GLASS_BUTTON = 36;

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
      opacity: interpolate(scrollY.value, [0, collapseDistance * 0.85], [1, 0], Extrapolation.CLAMP),
    };
  });

  // Body (menu / favorites / plugins) fades out well before full collapse, so
  // it's gone by the time the bar tightens up.
  const bodyStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, collapseDistance * 0.55], [1, 0], Extrapolation.CLAMP),
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

        {/* Body — dummy stand-ins for the Menu / Favorites / Plugins sections. */}
        <Animated.View
          pointerEvents="box-none"
          style={[
            styles.body,
            { top: insets.top + BAR_CONTENT_HEIGHT, left: SQUIRCLE_INSET + 8, right: SQUIRCLE_INSET + 8 },
            bodyStyle,
          ]}
        >
          {BODY_SECTIONS.map((section) => (
            <Text
              key={section}
              style={styles.bodySection}
            >
              {section}
            </Text>
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
                size={17}
                color={colors.label}
              />
            </GlassView>
          </Pressable>

          <View style={{ width: pillWidth, height: BAR_CONTENT_HEIGHT }}>
            <Animated.View style={[StyleSheet.absoluteFill, nameGlassStyle]}>
              <GlassView
                style={styles.namePill}
                glassEffectStyle="regular"
              />
            </Animated.View>
            <View style={styles.nameTextWrap}>
              <Text
                numberOfLines={1}
                style={styles.nameText}
              >
                effect-pm
              </Text>
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
                size={17}
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
const BODY_SECTIONS = ["Menu — Files · Docs · Commits · PRs", "Favorites", "Plugins (2)  ·  See all"];

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
    overflow: "hidden",
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
    gap: 14,
  },
  bodySection: {
    color: colors.secondaryLabel,
    fontSize: 15,
    fontWeight: "600",
  },
  innerHeader: {
    position: "absolute",
    left: SQUIRCLE_INSET + 8,
    right: SQUIRCLE_INSET + 8,
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
    alignItems: "center",
    justifyContent: "center",
  },
  nameText: {
    color: colors.label,
    fontSize: 15,
    fontWeight: "600",
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
