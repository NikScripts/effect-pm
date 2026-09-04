/**
 * The app's standard header title: the title text in its own Liquid Glass
 * capsule, rendered into a nav bar's `headerTitle` slot. This is part of the
 * app's design language — every header title is this pill (chat, session list,
 * and any future one). An optional trailing status dot supports the chat
 * session's live-connection indicator.
 *
 * Width is a fixed fraction of the screen rather than content-sized: `@expo/ui`
 * content-sized `Host`s resolve asynchronously via a native round-trip that
 * this codebase has repeatedly seen race with surrounding layout, and the nav
 * bar centers the slot between its items so the pill only has to stay narrow
 * enough never to reach them.
 *
 * @internal
 */
import { HStack, Host, Image, Spacer, Text as UIText } from "@expo/ui/swift-ui";
import { font, foregroundStyle, frame, glassEffect, lineLimit, padding } from "@expo/ui/swift-ui/modifiers";
import * as React from "react";
import { useWindowDimensions } from "react-native";
import { colors } from "./colors";

const PILL_WIDTH_RATIO = 0.5;
const PILL_HEIGHT = 44;

export const HeaderTitlePill = (props: {
  readonly title: string;
  /** Trailing status dot: omit for no dot. */
  readonly dot?: "connected" | "disconnected";
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
        <UIText modifiers={[font({ size: 15, weight: "semibold" }), foregroundStyle(colors.label), lineLimit(1)]}>{props.title}</UIText>
        <Spacer />
        {props.dot !== undefined ? <Image systemName="circle.fill" size={7} color={props.dot === "connected" ? colors.brand : colors.secondaryLabel} /> : null}
      </HStack>
    </Host>
  );
};
