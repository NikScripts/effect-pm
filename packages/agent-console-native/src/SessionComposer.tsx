/**
 * The real, editable composer at the bottom of a chat session.
 *
 * One persistent element for its whole lifetime — a single `GlassView`
 * wrapping a `TextInput` that's always mounted, never a decoy tree swapped
 * for a real one. An earlier version split "idle" and "editing" into two
 * mutually exclusive component trees, matching HomeComposerBar's own decoy
 * pill when idle and swapping to a `TextInput` + a separate controls row
 * once focused/typed into. That produced a long run of native-bridge bugs
 * — `Host`'s SwiftUI content and `GlassView`'s glass material both turned
 * out to only reliably initialize once, on a component's genuine first
 * mount, with no clean signal or supported hook for "this instance got
 * reused, redo your setup." Every one of the earlier fixes (forcing a
 * fresh touch target with an explicit `Pressable`, delaying icon mounts
 * until layout settled, cycling `glassEffectStyle` through an intermediate
 * value, forcing a new React `key` on every reopen) was working around
 * that same root cause from a different angle — worth doing only because
 * the tree was swapping in the first place. With nothing ever unmounting,
 * none of it is needed: `GlassView`'s effect sets up exactly once, for
 * real, and stays set up for as long as the composer exists.
 *
 * "Idle" and "editing" are now two arrangements of the same content, not
 * two components — the `TextInput` alone on its own row, plus a controls
 * row (+ / Auto / send, grouped together) that's only rendered while
 * `expanded`, its height animated in/out via `LayoutAnimation` triggered
 * from the `TextInput`'s own `onFocus`/`onBlur` — the one mechanism
 * confirmed (against the exact commit where it worked, byte-for-byte)
 * to reliably drive that animation; `onContentSizeChange` alone isn't
 * enough. Tapping to open is just tapping into the `TextInput` directly;
 * there's no separate decoy touch target standing in for it anymore, so
 * there's nothing for that tap to race against.
 *
 * Model switching and the attachment ("+") button are stubs for now — real
 * `client.provider.list()` wiring is the next increment once this shell's
 * confirmed good, matching web's NewSessionPicker pattern.
 *
 * @internal
 */
import { GlassView } from "expo-glass-effect";
import * as React from "react";
import { LayoutAnimation, Pressable, StyleSheet, Text, TextInput, useColorScheme, View } from "react-native";
import { colors } from "./colors";
import { COMPOSER_CHIP_SIZE, COMPOSER_SEND_CHIP_SIZE } from "./composerBarSpec";
import { SystemIcon } from "./SystemIcon";

// Comfortably under half the field's smallest (idle) rendered height, so
// the rounded corners never overlap/distort ("weird clipping") no matter
// which row arrangement is showing.
const FIELD_RADIUS = 30;
const MIN_INPUT_HEIGHT = 24;
const MAX_INPUT_HEIGHT = 120;

// `LayoutAnimation.Presets.easeInEaseOut` runs 300ms — visibly slower than
// iOS's own keyboard show/hide animation (~250ms), so the Auto row/field
// height change was noticeably still finishing after the keyboard had
// already settled. `'keyboard'` is a real, distinct RN animation type
// (UIKit's own keyboard-curve constant, `Types.keyboard`), not a
// substitute for `easeInEaseOut` — using it at the keyboard's own duration
// is what actually keeps the two in sync, not just a shorter number.
const EXPAND_ANIMATION = {
  duration: 250,
  create: { type: "keyboard", property: "opacity" },
  update: { type: "keyboard" },
  delete: { type: "keyboard", property: "opacity" },
} as const;

export const SessionComposer = (props: {
  readonly onSend: (text: string) => Promise<void>;
  readonly disabled: boolean;
  /** Home-indicator safe-area inset — the caller knows whether the keyboard
   * is covering it (0) or not (the real inset), so this doesn't read insets
   * itself and risk double-counting against the keyboard height. */
  readonly bottomInset: number;
}): React.ReactElement => {
  const scheme = useColorScheme();
  const [text, setText] = React.useState("");
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [focused, setFocused] = React.useState(false);
  const expanded = focused || text.length > 0;
  // iOS multiline TextInput's own intrinsic-size reporting to Yoga doesn't
  // reliably account for its own padding — measuring the actual content
  // height directly (the standard RN pattern for auto-growing text inputs)
  // sidesteps that measurement gap entirely instead of guessing at it.
  const [contentHeight, setContentHeight] = React.useState(MIN_INPUT_HEIGHT);
  // Bisected against the exact working commit: starting the controls row
  // permanently visible (never zero on the very first render, whether its
  // height was "auto" or an explicit number) broke the field — stuck
  // showing its expanded size from the moment the screen opens. Starting
  // it collapsed and revealing it once, right after mount, keeps the
  // field's actual *first* native layout pass identical to the working
  // version (small, row at zero) while still landing on "always visible"
  // within a fraction of a second — it just never collapses again after.
  const [controlsRevealed, setControlsRevealed] = React.useState(false);

  React.useEffect(() => {
    const frame = requestAnimationFrame(() => {
      LayoutAnimation.configureNext(EXPAND_ANIMATION);
      setControlsRevealed(true);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const onFocus = (): void => {
    LayoutAnimation.configureNext(EXPAND_ANIMATION);
    setFocused(true);
  };

  const onBlur = (): void => {
    // Only animate the collapse when it's actually about to happen — typed
    // text keeps `expanded` true across a blur, so there's no layout change
    // to animate in that case.
    if (text.length === 0) LayoutAnimation.configureNext(EXPAND_ANIMATION);
    setFocused(false);
  };

  const send = async (): Promise<void> => {
    const value = text.trim();
    if (value.length === 0 || props.disabled) return;
    setText("");
    setError(undefined);
    try {
      await props.onSend(value);
    } catch {
      setError("Message failed to send — is the OpenCode server running?");
    }
  };

  return (
    <View style={[styles.root, { paddingBottom: Math.max(props.bottomInset, 8) }]}>
      {error !== undefined ? <Text style={styles.error}>{error}</Text> : null}
      {/* The squircle clip lives on this plain wrapping View via RN's
       * standard `borderCurve` handling, not on GlassView directly —
       * confirmed the hard way in the two-tree version: GlassView's own
       * custom `setBorderCurve` setter broke the glass effect outright,
       * while plain RN clipping on a wrapper never did. */}
      <View style={styles.fieldClip}>
        <GlassView style={styles.field} glassEffectStyle="regular" colorScheme={scheme === "dark" ? "dark" : "light"}>
          <TextInput
            style={[styles.input, { height: Math.min(Math.max(contentHeight, MIN_INPUT_HEIGHT), MAX_INPUT_HEIGHT) }]}
            value={text}
            onChangeText={setText}
            onContentSizeChange={(e) => setContentHeight(e.nativeEvent.contentSize.height)}
            editable={!props.disabled}
            placeholder="Message"
            placeholderTextColor={colors.placeholderText}
            multiline
            submitBehavior="blurAndSubmit"
            onSubmitEditing={() => void send()}
            onFocus={onFocus}
            onBlur={onBlur}
          />
          {/* `controlsRevealed`, not `expanded` — see its own comment
           * above for why. Same `!x && autoRowCollapsed` mechanism as the
           * working commit, just driven by a flag that starts false and
           * flips true once, shortly after mount, instead of one that
           * toggles with focus. */}
          <View style={[styles.autoRow, !controlsRevealed && styles.autoRowCollapsed]}>
            <Pressable style={styles.chip}>
              <SystemIcon name="plus" size={14} color={colors.secondaryLabel} />
            </Pressable>
            <Pressable style={styles.autoButton}>
              <Text style={styles.autoText}>Auto</Text>
              <SystemIcon name="chevron.down" size={9} color={colors.secondaryLabel} />
            </Pressable>
            <View style={styles.controlsSpacer} />
            <Pressable style={styles.sendChip} onPress={() => void send()}>
              <SystemIcon name="arrow.up" size={15} color={colors.secondaryLabel} />
            </Pressable>
          </View>
        </GlassView>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  error: {
    color: colors.destructive,
    fontSize: 13,
    marginBottom: 6,
    paddingHorizontal: 4,
  },
  fieldClip: {
    borderRadius: FIELD_RADIUS,
    // Plain `borderRadius` alone renders iOS's standard circular-arc
    // corner, not Apple's "continuous" curve (the actual squircle every
    // native rounded-rect/capsule — including Liquid Glass's own shapes —
    // uses).
    borderCurve: "continuous",
    overflow: "hidden",
  },
  field: {
    padding: 10,
    position: "relative",
  },
  input: {
    color: colors.label,
    fontSize: 16,
    // height is computed inline from `contentHeight` (see the TextInput
    // element itself) — no min/maxHeight here, that's handled by the
    // Math.min/Math.max clamp around MIN_INPUT_HEIGHT/MAX_INPUT_HEIGHT.
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  autoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingTop: 4,
    overflow: "hidden",
  },
  autoRowCollapsed: {
    height: 0,
    paddingTop: 0,
  },
  controlsSpacer: {
    flex: 1,
  },
  chip: {
    width: COMPOSER_CHIP_SIZE,
    height: COMPOSER_CHIP_SIZE,
    borderRadius: COMPOSER_CHIP_SIZE / 2,
    backgroundColor: colors.fillBackground,
    alignItems: "center",
    justifyContent: "center",
  },
  sendChip: {
    width: COMPOSER_SEND_CHIP_SIZE,
    height: COMPOSER_SEND_CHIP_SIZE,
    borderRadius: COMPOSER_SEND_CHIP_SIZE / 2,
    backgroundColor: colors.fillBackground,
    alignItems: "center",
    justifyContent: "center",
  },
  autoButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 2,
    paddingVertical: 4,
  },
  autoText: {
    color: colors.secondaryLabel,
    fontSize: 13,
    fontWeight: "500",
  },
});
