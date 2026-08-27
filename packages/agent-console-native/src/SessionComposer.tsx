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
 * The controls row (+ / Auto / send) is always visible and always at the
 * bottom, not gated by focus — the `TextInput` sits alone above it and
 * grows upward as more lines are typed, the standard chat-composer
 * arrangement. An earlier version tried to keep the idle state visually
 * identical to HomeComposerBar's decoy pill (+/text/send on one row,
 * nothing else until focused) — abandoned once it turned out to just mean
 * relearning where the buttons are depending on focus state. Tapping to
 * open is just tapping into the `TextInput` directly; there's no separate
 * decoy touch target standing in for it, so there's nothing for that tap
 * to race against.
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

// Comfortably under half the field's smallest possible rendered height
// (a single-line TextInput plus the fixed controls row), so the rounded
// corners never overlap/distort ("weird clipping").
const FIELD_RADIUS = 30;
// A fontSize:16 line needs roughly INPUT_LINE_HEIGHT of vertical room —
// MIN_INPUT_HEIGHT previously didn't account for that at all (24 total,
// smaller than line height + padding combined), too small to fit even one
// line of text once padding's subtracted. TextInput can't actually honor
// an explicit height smaller than what its own content needs, so it was
// very likely rendering at its own larger natural minimum regardless of
// this constant — which would explain the field looking permanently
// expanded independent of anything content-measurement-related, and the
// placeholder (probably clipped/squeezed in that too-small box) looking
// different from real typed text (which forces a correctly-sized render).
const INPUT_LINE_HEIGHT = 20;
const MIN_INPUT_HEIGHT = INPUT_LINE_HEIGHT + 16;
const MAX_INPUT_HEIGHT = 120;

// `LayoutAnimation.Presets.easeInEaseOut` runs 300ms — visibly slower than
// iOS's own keyboard show/hide animation (~250ms), so the field's height
// change was noticeably still finishing after the keyboard had already
// settled. `'keyboard'` is a real, distinct RN animation type
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
  // iOS multiline TextInput's own intrinsic-size reporting to Yoga doesn't
  // reliably account for its own padding — measuring the actual content
  // height directly (the standard RN pattern for auto-growing text inputs)
  // sidesteps that measurement gap entirely instead of guessing at it.
  const [contentHeight, setContentHeight] = React.useState(MIN_INPUT_HEIGHT);
  // `onContentSizeChange` can fire with an unreliable measurement before
  // real content justifies it (mount, before any typing; possibly more
  // than once while still settling) — storing that made the field latch
  // onto an inflated height and stay there, looking permanently expanded
  // regardless of how much text was actually typed. Skipping only the
  // very first call wasn't enough on its own; ignoring *every*
  // measurement that arrives while the field is still empty is the
  // actual invariant that matters — an empty field has no content to
  // measure a real height from in the first place.
  const onContentSizeChange = (height: number): void => {
    if (text.length === 0) return;
    LayoutAnimation.configureNext(EXPAND_ANIMATION);
    setContentHeight(height);
  };

  // Confirmed against the exact commit where this genuinely worked
  // (before the controls row moved to always-visible): a real
  // LayoutAnimation.configureNext call on focus/blur, not just on
  // onContentSizeChange. onContentSizeChange alone is not a reliable
  // trigger by itself — it can fire late, more than once, or with a
  // measurement that doesn't reflect the real change yet — so the field's
  // height change was landing unanimated even when `contentHeight` itself
  // was correct. Focus/blur are simple, guaranteed-to-fire-once events;
  // calling configureNext here too means there's always at least one
  // reliable trigger queued up for whatever layout change is about to
  // happen, on top of (not instead of) the content-driven one above.
  const onFocus = (): void => {
    LayoutAnimation.configureNext(EXPAND_ANIMATION);
  };

  const onBlur = (): void => {
    LayoutAnimation.configureNext(EXPAND_ANIMATION);
  };

  const send = async (): Promise<void> => {
    const value = text.trim();
    if (value.length === 0 || props.disabled) return;
    LayoutAnimation.configureNext(EXPAND_ANIMATION);
    setText("");
    setContentHeight(MIN_INPUT_HEIGHT);
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
            style={[
              styles.input,
              // Ignore `contentHeight` entirely while empty — belt and
              // suspenders alongside `onContentSizeChange`'s own guard
              // below, since even one stale stored measurement surviving
              // to render would mean the field never visibly shrinks back
              // down after a send.
              { height: text.length === 0 ? MIN_INPUT_HEIGHT : Math.min(Math.max(contentHeight, MIN_INPUT_HEIGHT), MAX_INPUT_HEIGHT) },
            ]}
            value={text}
            onChangeText={setText}
            onContentSizeChange={(e) => onContentSizeChange(e.nativeEvent.contentSize.height)}
            onFocus={onFocus}
            onBlur={onBlur}
            editable={!props.disabled}
            placeholder="Message"
            placeholderTextColor={colors.placeholderText}
            multiline
            // Return inserts a newline instead of sending — matching every
            // real chat app's multiline composer. `onSubmitEditing` never
            // fires in this mode, so there's no send-on-enter to wire up
            // here at all; sending is the send button's job alone.
            submitBehavior="newline"
          />
          <View style={styles.controlsRow}>
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
    // Explicit, not left to the platform default — MIN_INPUT_HEIGHT is
    // computed against this same constant, so the two can't drift apart.
    lineHeight: INPUT_LINE_HEIGHT,
    // height is computed inline from `contentHeight` (see the TextInput
    // element itself) — no min/maxHeight here, that's handled by the
    // Math.min/Math.max clamp around MIN_INPUT_HEIGHT/MAX_INPUT_HEIGHT.
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  // Always visible, always at the bottom — fixed, not gated by focus. The
  // TextInput above is the only thing that grows/shrinks.
  controlsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingTop: 4,
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
