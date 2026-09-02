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
 * Two sections, not two components — an `inputSection` holding the
 * `TextInput` alone (grows upward with content, collapses to 0 height
 * *and* 0 opacity when idle) and a `controlsRow` that's always visible,
 * always the same height, never collapsing. `expanded` gates the input
 * section's collapse via `LayoutAnimation` triggered from the
 * `TextInput`'s own `onFocus`/`onBlur` — the one mechanism confirmed
 * (against the exact commit where it worked, byte-for-byte) to reliably
 * drive that animation; `onContentSizeChange` alone isn't enough.
 *
 * `controlsRow` is three parts: a fixed `+` button on the left, a fixed
 * send button on the right, and a flexible `pickerSlot` that absorbs
 * whatever space is left. Because +/send live in their own fixed-width
 * slots in a row whose height never depends on the `TextInput`, there's
 * no cross-axis alignment tension to fight (a shared `mainRow` with
 * `alignItems: "center"`/`"flex-end"` was tried — both are compromises,
 * since the `TextInput` was often that row's tallest, variable-height
 * child). `controlsRow`'s own `paddingTop` only exists to separate it
 * from the grown input above it, so it's zeroed out alongside
 * `inputSection`'s own collapse — otherwise it's dead space sitting above
 * the buttons with nothing above them to separate from.
 *
 * +/send are real native SwiftUI `Button`s (background circle, glass
 * effect, and SF Symbol all one native element via `@expo/ui`) — each in
 * its own `Host`, sized by an explicit `style` (`chipHost`/
 * `sendChipHost`), not `matchContents`. `glassEffect` is confirmed
 * load-bearing, not decorative: swapping it for `background(color,
 * shapes.circle())` — everything else held constant — broke the delayed-
 * alignment bug immediately (see `CHIP_BUTTON_MODIFIERS`'s own comment).
 * Flat/non-glass native buttons aren't achievable here without
 * reintroducing that bug; the attempt is saved as the `d49b883fc` WIP
 * commit on this branch, not lost. Auto's own chevron stays on `Feather`
 * (`@expo/vector-icons`) — it's not wired to a real dropdown yet, and was
 * never part of this native-button work.
 *
 * `pickerSlot` holds two always-mounted, absolutely-stacked Pressables —
 * the Auto model-picker and a single-line mirror of the `TextInput`'s own
 * value/placeholder — cross-faded by opacity/`pointerEvents` on
 * `expanded`, never conditionally rendered. Tapping the mirror focuses
 * the real (currently 0-height) `TextInput` via a ref; the collapsed
 * bubble reads as one compact pill (`+`, mirrored text, send) without
 * ever being a decoy standing in for the real input the way the old
 * two-tree design was — the `TextInput` itself is what's collapsed, not
 * swapped out.
 *
 * Model switching and the attachment ("+") button are stubs for now — real
 * `client.provider.list()` wiring is the next increment once this shell's
 * confirmed good, matching web's NewSessionPicker pattern.
 *
 * @internal
 */
import { Feather } from "@expo/vector-icons";
import { Button, Host } from "@expo/ui/swift-ui";
import { buttonStyle, foregroundStyle, frame, glassEffect, imageScale, labelStyle } from "@expo/ui/swift-ui/modifiers";
import { GlassView } from "expo-glass-effect";
import * as React from "react";
import { DynamicColorIOS, LayoutAnimation, Pressable, StyleSheet, Text, TextInput, useColorScheme, View } from "react-native";
import { colors } from "./colors";
import { COMPOSER_CHIP_SIZE, COMPOSER_SEND_CHIP_SIZE } from "./composerBarSpec";

// Comfortably under half the field's smallest (idle) rendered height, so
// the rounded corners never overlap/distort ("weird clipping") no matter
// which row arrangement is showing.
const FIELD_RADIUS = 30;
// A fontSize:16 line needs roughly INPUT_LINE_HEIGHT of vertical room —
// 24 alone (this constant's old value) is smaller than line height +
// padding combined, too small to fit even one line of text once padding
// is subtracted. TextInput can't actually honor an explicit height
// smaller than what its own content needs, so it renders at its own
// larger natural minimum regardless of what this constant says —
// independent of the row-visibility mechanism entirely, present from the
// moment the screen opens, before any focus or typing.
const INPUT_LINE_HEIGHT = 20;
const MIN_INPUT_HEIGHT = INPUT_LINE_HEIGHT + 16;
const MAX_INPUT_HEIGHT = 120;

// `LayoutAnimation.Presets.easeInEaseOut` runs 300ms — visibly slower than
// iOS's own keyboard show/hide animation (~250ms), so the Auto row/field
// height change was noticeably still finishing after the keyboard had
// already settled. `'keyboard'` is a real, distinct RN animation type
// (UIKit's own keyboard-curve constant, `Types.keyboard`), not a
// substitute for `easeInEaseOut`. 180ms trades exact keyboard sync (this
// now finishes *before* the keyboard instead of after) for a snappier
// feel — deliberate, not an oversight; go back toward 250 if the desync
// reads as worse than the extra speed is worth.
const EXPAND_ANIMATION = {
  duration: 180,
  create: { type: "keyboard", property: "opacity" },
  update: { type: "keyboard" },
  delete: { type: "keyboard", property: "opacity" },
} as const;

// Colors, computed by mixing toward a neutral rather than lowering alpha
// — this stays on `glassEffect` (the confirmed-safe mechanism, see
// CHIP_BUTTON_MODIFIERS's own comment) with a fully opaque tint.
//
// + is gray, mixed toward *black* — a dark-blue variant was tried and
// reverted (the fill still read as blue, not gray, regardless of the
// icon's own color). Green (send, muted/disabled state) mixes toward
// *white* — dialed back twice (0.65 too light, 0.45 still too light) to
// 0.32. This is a disabled state; explicit call already made to accept
// low icon contrast here in exchange for the actual pastel/muted look
// wanted, rather than let contrast math override it. Same systemGray/
// systemGreen base hues as colors.ts's brandTint (green only — gray has
// no equivalent shared token), defined locally rather than bumping that
// shared token (also used for the chat bubble elsewhere).
const mixRgb = (base: readonly [number, number, number], target: readonly [number, number, number], factor: number): string => {
  const [r, g, b] = base.map((channel, i) => Math.round(channel + (target[i] - channel) * factor));
  return `rgb(${r},${g},${b})`;
};
const SYSTEM_GRAY = { light: [142, 142, 147], dark: [142, 142, 147] } as const;
const SYSTEM_GREEN = { light: [52, 199, 89], dark: [48, 209, 88] } as const;
const WHITE: readonly [number, number, number] = [255, 255, 255];
const BLACK: readonly [number, number, number] = [0, 0, 0];
// + is a light gray fill with a dark gray icon (see CHIP_ICON below) —
// both fixed, not theme-adaptive, so the pairing holds in either theme.
const GRAY_LIGHTEN_FACTOR = 0.6;
const GRAY_DARKEN_FACTOR = 0.25;
const GREEN_MUTE_FACTOR = 0.32;
const CHIP_FILL = mixRgb(SYSTEM_GRAY.light, WHITE, GRAY_LIGHTEN_FACTOR);
const CHIP_ICON = mixRgb(SYSTEM_GRAY.light, BLACK, GRAY_DARKEN_FACTOR);
const SEND_MUTED_FILL = DynamicColorIOS({
  light: mixRgb(SYSTEM_GREEN.light, WHITE, GREEN_MUTE_FACTOR),
  dark: mixRgb(SYSTEM_GREEN.dark, WHITE, GREEN_MUTE_FACTOR),
});

// +/send's own background, glass effect, and icon — one native element,
// same recipe as SessionTopBar.tsx's back/more buttons.
//
// Confirmed by a real test, not assumption: swapping this `glassEffect`
// for `background(color, shapes.circle())` — everything else held
// constant (buttonStyle("plain"), separate chipHost/sendChipHost,
// LayoutAnimation, these same tint colors) — broke the delayed-alignment
// bug immediately. `glassEffect` itself (its material/backdrop-sampling
// layer, likely continuously re-compositing against whatever's behind it
// regardless of external state changes, unlike a statically-painted
// `background()` shape) is specifically what was preventing it, not
// incidental to some other change. Flat/non-glass native buttons aren't
// achievable via `background()` without reintroducing this bug — glass
// stays.
const CHIP_BUTTON_MODIFIERS = [
  buttonStyle("plain"),
  labelStyle("iconOnly"),
  imageScale("small"),
  frame({ width: COMPOSER_CHIP_SIZE, height: COMPOSER_CHIP_SIZE }),
  // Gray — a secondary action, distinct from send's green.
  glassEffect({ glass: { variant: "regular", interactive: true, tint: CHIP_FILL }, shape: "circle" }),
  // foregroundStyle LAST, after glassEffect — modifier order is
  // significant in SwiftUI, and with this before `glassEffect` the glass
  // treatment overrode it, leaving the glyph its default near-black no
  // matter what color was passed (both `tint` and `foregroundStyle` were
  // tried in that position and both rendered black). Dark gray, paired
  // with the light gray fill above.
  foregroundStyle(CHIP_ICON),
];

// Send has two states, not one fixed tint: solid `colors.brand` green
// when there's real text to send, muted green (SEND_MUTED_FILL) when
// there isn't, so it still reads as "this is the send button, just not
// armed yet" rather than going fully neutral. The icon itself stays white
// in both states — deliberately not flipping to a lower-contrast color
// when muted, unlike the fill.
const sendButtonModifiers = (active: boolean) => [
  buttonStyle("plain"),
  labelStyle("iconOnly"),
  imageScale("medium"),
  frame({ width: COMPOSER_SEND_CHIP_SIZE, height: COMPOSER_SEND_CHIP_SIZE }),
  glassEffect({
    glass: { variant: "regular", interactive: true, tint: active ? colors.brand : SEND_MUTED_FILL },
    shape: "circle",
  }),
  // Last, after glassEffect — see CHIP_BUTTON_MODIFIERS's own note on why
  // order matters here.
  foregroundStyle("#FFFFFF"),
];

export const SessionComposer = (props: {
  readonly onSend: (text: string) => Promise<void>;
  readonly disabled: boolean;
  /** Home-indicator safe-area inset — the caller knows whether the keyboard
   * is covering it (0) or not (the real inset), so this doesn't read insets
   * itself and risk double-counting against the keyboard height. */
  readonly bottomInset: number;
}): React.ReactElement => {
  const scheme = useColorScheme();
  const inputRef = React.useRef<TextInput>(null);
  const [text, setText] = React.useState("");
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [focused, setFocused] = React.useState(false);
  const expanded = focused || text.length > 0;
  const hasContent = text.trim().length > 0 && !props.disabled;
  // iOS multiline TextInput's own intrinsic-size reporting to Yoga doesn't
  // reliably account for its own padding — measuring the actual content
  // height directly (the standard RN pattern for auto-growing text inputs)
  // sidesteps that measurement gap entirely instead of guessing at it.
  const [contentHeight, setContentHeight] = React.useState(MIN_INPUT_HEIGHT);
  // onContentSizeChange fires once on mount, before any typing, with an
  // unreliable measurement — storing that made the field latch onto an
  // inflated height with no real content to justify it. Ignoring it
  // entirely while the field is empty (not just skipping the first call)
  // is the actual invariant that matters — an empty field has no content
  // to measure a real height from in the first place.
  const onContentSizeChange = (height: number): void => {
    if (text.length === 0) return;
    LayoutAnimation.configureNext(EXPAND_ANIMATION);
    setContentHeight(height);
  };

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
          {/* inputSection — TextInput alone, grows upward. Collapses to 0
           * height *and* 0 opacity when idle; never unmounts, just goes
           * invisible and zero-sized. `pointerEvents="none"` while
           * collapsed so its (zero-size anyway) hit box can't intercept
           * taps meant for the mirror below it. */}
          <View style={[styles.inputSection, !expanded && styles.inputSectionCollapsed]} pointerEvents={expanded ? "auto" : "none"}>
            <TextInput
              ref={inputRef}
              style={[
                styles.input,
                // Ignore `contentHeight` entirely while empty — belt and
                // suspenders alongside `onContentSizeChange`'s own guard
                // above, since even one stale stored measurement surviving
                // to render would mean the field never visibly shrinks back
                // down after a send.
                { height: text.length === 0 ? MIN_INPUT_HEIGHT : Math.min(Math.max(contentHeight, MIN_INPUT_HEIGHT), MAX_INPUT_HEIGHT) },
              ]}
              value={text}
              onChangeText={setText}
              onContentSizeChange={(e) => onContentSizeChange(e.nativeEvent.contentSize.height)}
              editable={!props.disabled}
              placeholder="Message"
              placeholderTextColor={colors.placeholderText}
              multiline
              submitBehavior="blurAndSubmit"
              onSubmitEditing={() => void send()}
              onFocus={onFocus}
              onBlur={onBlur}
            />
          </View>
          {/* controlsRow — always visible, never collapses. Three parts:
           * fixed `+` chip, flexible `pickerSlot`, fixed send chip. */}
          <View style={[styles.controlsRow, !expanded && styles.controlsRowCollapsed]}>
            <Host style={styles.chipHost}>
              <Button label="Attach" systemImage="plus" modifiers={CHIP_BUTTON_MODIFIERS} />
            </Host>
            {/* pickerSlot — two always-mounted Pressables stacked on top of
             * each other (`slotContent`'s absolute positioning), cross-
             * faded by opacity/pointerEvents on `expanded`. Neither is
             * ever zero-sized/unpainted, which is what removes the old
             * icon-settles-late race entirely instead of timing around
             * it. */}
            <View style={styles.pickerSlot}>
              <Pressable
                style={[styles.slotContent, styles.autoContent, { opacity: expanded ? 1 : 0 }]}
                pointerEvents={expanded ? "auto" : "none"}
              >
                <Text style={styles.autoText}>Auto</Text>
                <Feather name="chevron-down" size={13} color={colors.secondaryLabel} />
              </Pressable>
              {/* Mirrors the TextInput's own value/placeholder — tapping
               * it focuses the real (currently collapsed) TextInput
               * above via ref, since that TextInput has no touchable
               * area of its own while collapsed. */}
              <Pressable
                style={[styles.slotContent, { opacity: expanded ? 0 : 1 }]}
                pointerEvents={expanded ? "none" : "auto"}
                onPress={() => inputRef.current?.focus()}
              >
                <Text style={[styles.mirrorText, text.length === 0 && styles.mirrorPlaceholder]} numberOfLines={1}>
                  {text.length > 0 ? text : "Message"}
                </Text>
              </Pressable>
            </View>
            <Host style={styles.sendChipHost}>
              <Button label="Send" systemImage="arrow.up" onPress={() => void send()} modifiers={sendButtonModifiers(hasContent)} />
            </Host>
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
  inputSection: {
    overflow: "hidden",
  },
  inputSectionCollapsed: {
    height: 0,
    opacity: 0,
  },
  input: {
    // No explicit width — `field`'s default column-flex `alignItems:
    // "stretch"` already fills the TextInput to the container's width now
    // that it's the sole content of its own section.
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
  controlsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingTop: 8,
  },
  controlsRowCollapsed: {
    paddingTop: 0,
  },
  // No background/border-radius/alignment here anymore — the circle,
  // glass effect, and icon are all rendered natively by the Button inside
  // (see CHIP_BUTTON_MODIFIERS/sendButtonModifiers). This is purely the
  // fixed size RN reserves for the Host in the flex row.
  chipHost: {
    width: COMPOSER_CHIP_SIZE,
    height: COMPOSER_CHIP_SIZE,
  },
  sendChipHost: {
    width: COMPOSER_SEND_CHIP_SIZE,
    height: COMPOSER_SEND_CHIP_SIZE,
  },
  pickerSlot: {
    flex: 1,
    // Explicit height, not left to content — both overlay children are
    // absolutely positioned and need something concrete to fill, and a
    // fixed height here (independent of the TextInput) is what keeps
    // `controlsRow` itself a constant height regardless of how tall the
    // input grows.
    height: COMPOSER_CHIP_SIZE,
    position: "relative",
  },
  // Both of pickerSlot's children share this — absolutely stacked on top
  // of each other so cross-fading their opacity swaps them in place with
  // no layout shift, left-aligned within `pickerSlot`.
  slotContent: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
  },
  autoContent: {
    gap: 4,
  },
  autoText: {
    color: colors.secondaryLabel,
    fontSize: 13,
    fontWeight: "500",
  },
  mirrorText: {
    color: colors.label,
    fontSize: 16,
  },
  mirrorPlaceholder: {
    color: colors.placeholderText,
  },
});
