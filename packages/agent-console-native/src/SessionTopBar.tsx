/**
 * A session's own nav bar — three separate glass pieces (back button, a wide
 * center piece with the title + live connection status, a right-side "more"
 * button) grouped in one `GlassEffectContainer`, the same proven recipe
 * Home's own `TopBar.tsx` uses (real SwiftUI via `@expo/ui`, not
 * `expo-glass-effect`'s `GlassView` — that component is what caused
 * SessionComposer's whole run of sizing/timing bugs today; this bar
 * deliberately stays on the mechanism that hasn't shown those problems).
 *
 * The center piece is given an explicit width computed from the screen
 * width, not SwiftUI's own flexible-width sizing (`frame({maxWidth:
 * Infinity})` doesn't survive this bridge's JSON serialization, and every
 * "let native figure out the size" attempt elsewhere in this composer today
 * turned out unreliable) — same "compute it synchronously on the RN side"
 * approach that fixed the composer's decoy touch target and controls row.
 *
 * The center piece isn't wrapped in a `Button` — it's not tappable yet; a
 * future session-details view (context usage, etc.) is the plan, but that's
 * a separate increment. The "more" button is a stub the same way
 * SessionComposer's "+"/Auto buttons are: rendered, not yet wired to
 * anything, because what belongs in that menu isn't decided yet.
 *
 * `connected` comes from `useSessionStream`'s own `/global/event` reconnect
 * loop — real state, not a synthesized always-on badge.
 *
 * @internal
 */
import { Button, GlassEffectContainer, HStack, Host, Image, Spacer, Text as UIText } from "@expo/ui/swift-ui";
import { buttonStyle, font, foregroundStyle, frame, glassEffect, imageScale, labelStyle, lineLimit, padding, tint } from "@expo/ui/swift-ui/modifiers";
import * as React from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "./colors";

const BUTTON_SIZE = 44;
const BAR_CONTENT_HEIGHT = 56;
const HORIZONTAL_MARGIN = 20;
const PIECE_SPACING = 8;

const buttonModifiers = () => [
  buttonStyle("plain"),
  labelStyle("iconOnly"),
  imageScale("medium"),
  tint(colors.label),
  frame({ width: BUTTON_SIZE, height: BUTTON_SIZE }),
  glassEffect({ glass: { variant: "regular", interactive: true }, shape: "circle" }),
];

export const useSessionTopBarHeight = (): number => {
  const insets = useSafeAreaInsets();
  return insets.top + BAR_CONTENT_HEIGHT;
};

export const SessionTopBar = (props: {
  readonly title: string | undefined;
  readonly connected: boolean;
  readonly onBack: () => void;
}): React.ReactElement => {
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const centerWidth = screenWidth - HORIZONTAL_MARGIN * 2 - BUTTON_SIZE * 2 - PIECE_SPACING * 2;

  return (
    <View style={[styles.root, { height: insets.top + BAR_CONTENT_HEIGHT }]} pointerEvents="box-none">
      <Host style={[styles.host, { height: BAR_CONTENT_HEIGHT }]}>
        <GlassEffectContainer spacing={PIECE_SPACING}>
          <HStack alignment="center" spacing={PIECE_SPACING} modifiers={[padding({ leading: HORIZONTAL_MARGIN, trailing: HORIZONTAL_MARGIN })]}>
            <Button label="Back" systemImage="chevron.left" onPress={props.onBack} modifiers={buttonModifiers()} />
            <HStack
              alignment="center"
              modifiers={[
                frame({ width: centerWidth, height: BUTTON_SIZE }),
                padding({ horizontal: 16 }),
                glassEffect({ glass: { variant: "regular" }, shape: "capsule" }),
              ]}
            >
              <Spacer />
              <UIText modifiers={[font({ size: 15, weight: "semibold" }), foregroundStyle(colors.label), lineLimit(1)]}>{props.title ?? "Session"}</UIText>
              <Spacer />
              <Image systemName="circle.fill" size={7} color={props.connected ? colors.brand : colors.secondaryLabel} />
            </HStack>
            <Button label="More" systemImage="ellipsis" modifiers={buttonModifiers()} />
          </HStack>
        </GlassEffectContainer>
      </Host>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  host: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 12,
  },
});
