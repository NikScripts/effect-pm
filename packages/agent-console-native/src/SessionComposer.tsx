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
 * always the same height, never collapsing.
 *
 * Animated via `heightAnim`/`opacityAnim` (React Native's `Animated` API),
 * not `LayoutAnimation` — `LayoutAnimation.configureNext` wraps the
 * *entire* native tree inside `GlassView` in one UIKit animation
 * transaction for the next commit, which was dragging +/send's `Host`
 * into it as an uninvolved bystander even though neither button's own
 * size/position style ever changed, causing their SwiftUI content to
 * settle late (the same underlying mechanism `SystemIcon`'s own comment
 * documents: "off-center icons kept recurring whenever something
 * elsewhere in the tree changed the surrounding layout timing"). Ruled
 * out first, before the fix below: switching to scoped `Animated.Value`s
 * (which only touch the specific view whose style prop is bound to them,
 * never wrapping siblings in a transaction) made *no observed
 * difference* — proof the problem wasn't which animation API was used at
 * all.
 *
 * `controlsRow`'s actual fix was structural: consolidate +/send into ONE
 * native `Host` (`controlsHost`) instead of two separate ones
 * (`chipHost`/`sendChipHost`) that RN's Yoga had to individually
 * size/reposition as flex siblings of `pickerSlot` on every render —
 * *that* per-render Yoga reflow, not the animation mechanism, was what
 * kept perturbing each `Host`'s geometry. `controlsHost` holds a native
 * `HStack` with a real SwiftUI `Spacer` between the two `Button`s (same
 * structure `SessionTopBar.tsx`'s nav bar already uses successfully) —
 * RN supplies exactly one explicit width (`controlsWidth`, computed from
 * the screen width the same way `SessionTopBar.tsx` computes its own
 * center piece, since a `Host` can't be given RN's `flex: 1`) and never
 * touches it again. `pickerSlot` (dynamic RN text, changes every
 * keystroke) is a plain sibling `View`, absolutely positioned over the
 * native `Spacer`'s own gap by matching insets (`CHIP_BUTTON_SIZE`/
 * `SEND_BUTTON_SIZE` + `CONTROLS_GAP`) — not a Yoga sibling *of the
 * `Host`* that could perturb its layout the way the two-`Host` version's
 * siblings did.
 *
 * +/send are real native SwiftUI `Button`s (background circle and SF
 * Symbol as one native element via `@expo/ui`, `buttonStyle("plain")` +
 * `background(color, shapes.circle())` for a flat solid/muted-tint fill
 * — no `glassEffect`, a flat look was chosen over glass here; `"plain"`
 * specifically, not `"bordered"`/`"borderedProminent"`, since those add
 * their own internal chrome padding that shrinks the visible circle
 * below whatever `frame()` says, a separate bug from the alignment one
 * above, live at the same time and easy to conflate with it). Auto's own
 * chevron stays on `Feather` for now — it's not wired to a real dropdown
 * yet, and folding it into `controlsHost`'s native structure is a
 * separate increment, not bundled in here.
 *
 * `pickerSlot` holds two always-mounted, absolutely-stacked Pressables —
 * the Auto model-picker and a single-line mirror of the `TextInput`'s own
 * value/placeholder — cross-faded by `opacityAnim`/`pointerEvents` on
 * `expanded`, never conditionally rendered. Tapping the mirror focuses
 * the real (currently 0-height) `TextInput` via a ref; the collapsed
 * bubble reads as one compact pill (`+`, mirrored text, send) without
 * ever being a decoy standing in for the real input the way the old
 * two-tree design was — the `TextInput` itself is what's collapsed, not
 * swapped out. Keeping both of `pickerSlot`'s Pressables always mounted
 * (just invisible via opacity, never zero-sized/unpainted) is also what
 * removes the need for the earlier `controlsReady` opacity-delay
 * workaround: that existed only because the old Auto row was clipped to
 * zero size while collapsed, so its icon was never actually painted until
 * reveal, and that never happens here.
 *
 * Model switching and the attachment ("+") button are stubs for now — real
 * `client.provider.list()` wiring is the next increment once this shell's
 * confirmed good, matching web's NewSessionPicker pattern.
 *
 * @internal
 */
import { Feather } from "@expo/vector-icons";
import { Button, HStack, Host, Spacer } from "@expo/ui/swift-ui";
import { background, buttonStyle, frame, imageScale, labelStyle, shapes, tint } from "@expo/ui/swift-ui/modifiers";
import { GlassView } from "expo-glass-effect";
import * as React from "react";
import { Animated, DynamicColorIOS, Easing, Pressable, StyleSheet, Text, TextInput, useColorScheme, useWindowDimensions, View } from "react-native";
import { colors } from "./colors";
import { COMPOSER_CHIP_SIZE, COMPOSER_SEND_CHIP_SIZE } from "./composerBarSpec";

// Comfortably under half the field's smallest (idle) rendered height, so
// the rounded corners never overlap/distort ("weird clipping") no matter
// which row arrangement is showing.
const FIELD_RADIUS = 30;
// Matches styles.root's paddingHorizontal and styles.field's padding —
// named here (not just inline in styles) because the controls Host below
// needs an explicit width computed from the actual screen width minus
// these same insets; a `Host` can't be given "flex: 1" the way an RN View
// can, so RN has to do this arithmetic itself, the same "compute it
// synchronously on the RN side" approach SessionTopBar.tsx already uses
// for its own center piece (its own comment: `frame({maxWidth: Infinity})`
// doesn't survive this bridge's JSON serialization).
const ROOT_HORIZONTAL_PADDING = 12;
const FIELD_PADDING = 10;
// Matches controlsRow's own gap and the native HStack's own `spacing`
// below — both need to agree, or the RN-side pickerSlot overlay (inset by
// this same value) won't actually land where the native Spacer's gap is.
const CONTROLS_GAP = 8;
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
// reads as worse than the extra speed is worth. Now an Animated.timing
// duration/easing pair, not a LayoutAnimation config — see header comment
// for why LayoutAnimation itself was the cause of +/send's delayed-
// alignment bug, independent of anything about their own styling.
const ANIMATION_DURATION = 180;
const ANIMATION_EASING = Easing.out(Easing.cubic);

// `buttonStyle("bordered"/"borderedProminent")` was genuinely a separate
// bug from the alignment-with-delay one (both were live at once, easy to
// conflate) — those styles add their own internal chrome padding around
// the label, which `frame()` doesn't control, so the visible circle came
// out smaller than the frame no matter what number the frame used (and
// forcing `controlSize("large")` then fought that padding from the other
// direction). `buttonStyle("plain")` is what the original, correctly-
// sized glassEffect version used — no padding, fills its frame exactly —
// with `background(color, shapes.circle())` painting the circle directly
// instead of relying on a styled button's own chrome.
const CHIP_BUTTON_SIZE = COMPOSER_CHIP_SIZE;
const SEND_BUTTON_SIZE = COMPOSER_SEND_CHIP_SIZE;

// Same systemBlue/systemGreen hues as colors.ts's accentTint/brandTint,
// defined locally (not bumping those shared tokens — brandTint is also
// used for the chat bubble elsewhere) and noticeably more opaque than
// either, since low-alpha read as too subtle to notice here.
const CHIP_FILL = DynamicColorIOS({ light: "rgba(0,122,255,0.4)", dark: "rgba(10,132,255,0.45)" });
const SEND_MUTED_FILL = DynamicColorIOS({ light: "rgba(52,199,89,0.4)", dark: "rgba(48,209,88,0.45)" });

const CHIP_BUTTON_MODIFIERS = [
  buttonStyle("plain"),
  labelStyle("iconOnly"),
  imageScale("small"),
  tint(colors.secondaryLabel),
  frame({ width: CHIP_BUTTON_SIZE, height: CHIP_BUTTON_SIZE }),
  // Muted blue — a secondary action, distinct from send's green.
  background(CHIP_FILL, shapes.circle()),
];

// Send has two states: solid `colors.brand` green when there's real text
// to send, a muted green fill when there isn't — same as before, just
// painted with `background()` instead of relying on `borderedProminent`/
// `bordered`'s own (padded) rendering. The icon goes back to manual
// white-on-solid vs secondaryLabel-on-muted, since `background()` doesn't
// auto-pick a contrasting label the way the built-in button styles did.
const sendButtonModifiers = (active: boolean) => [
  buttonStyle("plain"),
  labelStyle("iconOnly"),
  imageScale("medium"),
  tint(active ? "#FFFFFF" : colors.secondaryLabel),
  frame({ width: SEND_BUTTON_SIZE, height: SEND_BUTTON_SIZE }),
  background(active ? colors.brand : SEND_MUTED_FILL, shapes.circle()),
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
  // controlsHost's explicit width — see its comment in styles: a Host
  // can't be given RN's `flex: 1`, so this has to be computed the same
  // way SessionTopBar.tsx computes its own center piece's width.
  const { width: screenWidth } = useWindowDimensions();
  const controlsWidth = screenWidth - ROOT_HORIZONTAL_PADDING * 2 - FIELD_PADDING * 2;
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
  const onContentSizeChange = (height: number): void => {
    // Ignore the mount-time call, before any typing, with an unreliable
    // measurement — storing that made the field latch onto an inflated
    // height with no real content to justify it. Ignoring it entirely
    // while the field is empty (not just skipping the first call) is the
    // actual invariant that matters — an empty field has no content to
    // measure a real height from in the first place.
    if (text.length === 0) return;
    setContentHeight(height);
  };

  // inputSection's actual target height right now — 0 while collapsed,
  // otherwise the clamped content height. heightAnim/opacityAnim below
  // animate toward whatever this is on every render it changes, whatever
  // the reason (expand/collapse *or* typing more/fewer lines) — one
  // mechanism for both, not two.
  const targetHeight = expanded ? Math.min(Math.max(contentHeight, MIN_INPUT_HEIGHT), MAX_INPUT_HEIGHT) : 0;
  const heightAnim = React.useRef(new Animated.Value(0)).current;
  const opacityAnim = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.timing(heightAnim, {
      toValue: targetHeight,
      duration: ANIMATION_DURATION,
      easing: ANIMATION_EASING,
      // height isn't supported by the native driver — this whole
      // animation runs on the JS thread, same as LayoutAnimation did.
      useNativeDriver: false,
    }).start();
  }, [targetHeight, heightAnim]);

  React.useEffect(() => {
    Animated.timing(opacityAnim, {
      toValue: expanded ? 1 : 0,
      duration: ANIMATION_DURATION,
      easing: ANIMATION_EASING,
      useNativeDriver: false,
    }).start();
  }, [expanded, opacityAnim]);

  const onFocus = (): void => {
    setFocused(true);
  };

  const onBlur = (): void => {
    setFocused(false);
  };

  const send = async (): Promise<void> => {
    const value = text.trim();
    if (value.length === 0 || props.disabled) return;
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
          {/* inputSection — TextInput alone, grows upward. height/opacity
           * are Animated.Values (heightAnim/opacityAnim), not a static
           * collapsed style — see header comment for why (LayoutAnimation
           * was the cause of +/send's delayed-alignment bug). Never
           * unmounts, just animates to invisible/zero-sized.
           * `pointerEvents="none"` while collapsed so its hit box can't
           * intercept taps meant for the mirror below it. */}
          <Animated.View style={[styles.inputSection, { height: heightAnim, opacity: opacityAnim }]} pointerEvents={expanded ? "auto" : "none"}>
            <TextInput
              ref={inputRef}
              style={[
                styles.input,
                // Ignore `contentHeight` entirely while empty — belt and
                // suspenders alongside `onContentSizeChange`'s own guard
                // above, since even one stale stored measurement surviving
                // to render would mean the field never visibly shrinks back
                // down after a send. Deliberately not animated itself —
                // it's clipped by inputSection's own animated height, so
                // snapping this instantly underneath that clip still
                // reads as smooth from what's actually visible.
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
          </Animated.View>
          {/* controlsRow — always visible, never collapses. `paddingTop`
           * only exists to separate this row from the grown input above
           * it, so it's animated to 0 alongside inputSection's own
           * collapse (via the same opacityAnim) — otherwise it's dead
           * space sitting above the buttons with nothing above them to
           * separate from.
           *
           * controlsHost is the ONE native element for the whole row —
           * chip, a native Spacer, send, all inside one Host/HStack, the
           * same structure as SessionTopBar.tsx's nav bar. RN's Yoga only
           * ever sizes/positions this single Host (an explicit width, not
           * matchContents); it never has to individually reposition two
           * separate Hosts as flex siblings the way chipHost/sendChipHost
           * used to be. pickerSlot (dynamic RN text) is a plain sibling
           * View, absolutely positioned over the native Spacer's own gap
           * — not a Yoga sibling *of the Host* affecting its layout. */}
          <Animated.View style={[styles.controlsRow, { paddingTop: opacityAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 8] }) }]}>
            <Host style={[styles.controlsHost, { width: controlsWidth }]}>
              <HStack alignment="center" spacing={CONTROLS_GAP}>
                <Button label="Attach" systemImage="plus" modifiers={CHIP_BUTTON_MODIFIERS} />
                <Spacer />
                <Button label="Send" systemImage="arrow.up" onPress={() => void send()} modifiers={sendButtonModifiers(hasContent)} />
              </HStack>
            </Host>
            {/* pickerSlot — two always-mounted Pressables stacked on top of
             * each other (`slotContent`'s absolute positioning), cross-
             * faded by `opacityAnim` (inverted for the mirror). Neither is
             * ever zero-sized/unpainted, which is what removes the old
             * icon-settles-late race entirely instead of timing around
             * it. */}
            <View style={styles.pickerSlot}>
              <Animated.View style={[styles.slotContent, { opacity: opacityAnim }]} pointerEvents={expanded ? "auto" : "none"}>
                <Pressable style={[styles.slotItem, styles.autoContent]}>
                  <Text style={styles.autoText}>Auto</Text>
                  <Feather name="chevron-down" size={13} color={colors.secondaryLabel} />
                </Pressable>
              </Animated.View>
              {/* Mirrors the TextInput's own value/placeholder — tapping
               * it focuses the real (currently collapsed) TextInput
               * above via ref, since that TextInput has no touchable
               * area of its own while collapsed. */}
              <Animated.View
                style={[styles.slotContent, { opacity: opacityAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]}
                pointerEvents={expanded ? "none" : "auto"}
              >
                <Pressable style={styles.slotItem} onPress={() => inputRef.current?.focus()}>
                  <Text style={[styles.mirrorText, text.length === 0 && styles.mirrorPlaceholder]} numberOfLines={1}>
                    {text.length > 0 ? text : "Message"}
                  </Text>
                </Pressable>
              </Animated.View>
            </View>
          </Animated.View>
        </GlassView>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    paddingHorizontal: ROOT_HORIZONTAL_PADDING,
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
    padding: FIELD_PADDING,
    position: "relative",
  },
  inputSection: {
    overflow: "hidden",
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
    // Not a flex row anymore — `controlsHost` is the sole normal-flow
    // child; `pickerSlot` is absolutely positioned over it (see below),
    // not a Yoga sibling `controlsHost` has to coexist with. That's the
    // actual point of this structure: RN's Yoga only ever sizes/positions
    // one Host now, never two, so there's nothing for it to individually
    // reposition mid-render the way chipHost/sendChipHost used to be.
    position: "relative",
    // paddingTop is animated inline (opacityAnim interpolation) — no
    // static value here, base and "collapsed" are the same 0..8 range.
  },
  // Chip, native Spacer, send all in one native HStack — RN only supplies
  // this one explicit size (computed from the screen width, the same
  // "compute it synchronously on the RN side" approach SessionTopBar.tsx
  // uses for its own center piece), never `matchContents`. Height is
  // SEND_BUTTON_SIZE, the taller of the two buttons.
  controlsHost: {
    height: SEND_BUTTON_SIZE,
  },
  // Absolutely positioned over controlsHost's native Spacer region, not a
  // Yoga sibling of it — insets match CHIP_BUTTON_SIZE/SEND_BUTTON_SIZE
  // plus CONTROLS_GAP exactly, so this RN text overlay lines up with the
  // actual gap the native HStack's own `spacing` leaves between the two
  // buttons.
  pickerSlot: {
    position: "absolute",
    left: CHIP_BUTTON_SIZE + CONTROLS_GAP,
    right: SEND_BUTTON_SIZE + CONTROLS_GAP,
    top: 0,
    bottom: 0,
  },
  // Both of pickerSlot's children (Animated.Views) share this — purely
  // positioning, so they stack absolutely on top of each other and
  // cross-fading their opacity swaps them in place with no layout shift.
  // Layout of what's actually inside (row, centered, left-aligned) is
  // `slotItem`'s job, on the plain (non-animated) Pressable underneath.
  slotContent: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  slotItem: {
    flex: 1,
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
