/**
 * A session's header title — the session name plus a live connection dot,
 * in its own glass capsule — rendered into the real `UINavigationBar`'s
 * `headerTitle` slot.
 *
 * This was previously a floating overlay of three glass pieces (back,
 * title, more) drawn over the screen with `headerShown: false`. It moved
 * into the real header because iOS 26's scroll edge effect — the system
 * blur where content passes under the status bar — only renders where
 * scrolling content meets an actual bar, so a real header has to exist, and
 * a second floating bar above it wasted a bar's worth of space.
 *
 * Back and "more" are gone from here: back is the system's own back button
 * (free swipe-back and correct behavior), and "more" is a native header
 * item declared in RootNavigator. Both of those are bar *button items*,
 * which an iOS 26 nav bar glasses itself — giving them ours too nested a
 * second capsule inside the system's.
 *
 * The title is not a bar button item and gets no glass from the system, so
 * it keeps its own `glassEffect` capsule here. That's what the old overlay
 * had, and losing it when this moved into the header was a regression.
 *
 * Width is computed on the RN side rather than left to SwiftUI: `frame({
 * maxWidth: Infinity })` doesn't survive this bridge's JSON serialization,
 * and content-sized `Host`s resolve asynchronously via a native round-trip
 * that this codebase has repeatedly seen race with surrounding layout.
 *
 * `connected` comes from `useSessionStream`'s own `/global/event` reconnect
 * loop — real state, not a synthesized always-on badge.
 *
 * @internal
 */
import { HStack, Host, Image, Spacer, Text as UIText } from "@expo/ui/swift-ui";
import { font, foregroundStyle, frame, glassEffect, lineLimit, padding } from "@expo/ui/swift-ui/modifiers";
import * as React from "react";
import { useWindowDimensions } from "react-native";
import { colors } from "./colors";

/** Half the screen. The nav bar centers the title slot between its own
 * items, so the pill only has to be narrow enough never to reach them —
 * an allowance subtracted from the full width was guesswork and overlapped
 * the buttons. */
const PILL_WIDTH_RATIO = 0.5;
/** Matches the bar's own 44pt item height, so it sits on the same line
 * rather than reading as a short stub. */
const PILL_HEIGHT = 44;

export const SessionHeaderTitle = (props: {
  readonly title: string | undefined;
  readonly connected: boolean;
}): React.ReactElement => {
  const { width: screenWidth } = useWindowDimensions();
  const pillWidth = Math.round(screenWidth * PILL_WIDTH_RATIO);

  return (
    <Host style={{ width: pillWidth, height: PILL_HEIGHT }}>
      <HStack
        alignment="center"
        modifiers={[
          frame({ width: pillWidth, height: PILL_HEIGHT }),
          padding({ horizontal: 14 }),
          glassEffect({ glass: { variant: "regular" }, shape: "capsule" }),
        ]}
      >
        <Spacer />
        <UIText modifiers={[font({ size: 15, weight: "semibold" }), foregroundStyle(colors.label), lineLimit(1)]}>{props.title ?? "Session"}</UIText>
        <Spacer />
        <Image systemName="circle.fill" size={7} color={props.connected ? colors.brand : colors.secondaryLabel} />
      </HStack>
    </Host>
  );
};
