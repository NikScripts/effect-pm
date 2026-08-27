/**
 * Home's nav bar — pinned to the top like a real iOS navigation bar (screen
 * content scrolls underneath it, it never scrolls away itself), rendered
 * with genuine SwiftUI via @expo/ui rather than approximated in RN: real SF
 * Symbols (`systemImage`) and real Liquid Glass. Sized via an explicit
 * `frame()` + `glassEffect()` rather than `buttonStyle('glass')` +
 * `controlSize()` — the latter only offers 5 discrete size presets with no
 * step between "too small" and "too big" for this bar; `glassEffect()` is a
 * plain view modifier that sizes off whatever frame you give it (the same
 * approach the earlier Liquid Glass spike proved out — a glass panel
 * live-sampling whatever's rendered behind it in the native view hierarchy,
 * there against animated background blobs, here against scrolling content).
 *
 * @internal
 */
import { Button, GlassEffectContainer, HStack, Host, Spacer } from "@expo/ui/swift-ui";
import { buttonStyle, frame, glassEffect, imageScale, labelStyle, padding, tint } from "@expo/ui/swift-ui/modifiers";
import * as React from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "./colors";

const BUTTON_SIZE = 44;
const BAR_CONTENT_HEIGHT = 56;

const buttonModifiers = () => [
  buttonStyle("plain"),
  labelStyle("iconOnly"),
  imageScale("medium"),
  tint(colors.label),
  frame({ width: BUTTON_SIZE, height: BUTTON_SIZE }),
  glassEffect({ glass: { variant: "regular", interactive: true }, shape: "circle" }),
];

export const useNavBarHeight = (): number => {
  const insets = useSafeAreaInsets();
  return insets.top + BAR_CONTENT_HEIGHT;
};

export const TopBar = (props: { readonly onSettings: () => void }): React.ReactElement => {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.root, { height: insets.top + BAR_CONTENT_HEIGHT }]} pointerEvents="box-none">
      <Host style={[styles.host, { height: BAR_CONTENT_HEIGHT }]}>
        <GlassEffectContainer spacing={8}>
          <HStack alignment="center" modifiers={[padding({ leading: 16, trailing: 16 })]}>
            <Button label="Settings" systemImage="gearshape" onPress={props.onSettings} modifiers={buttonModifiers()} />
            <Spacer />
            <HStack spacing={8}>
              <Button label="Search" systemImage="magnifyingglass" modifiers={buttonModifiers()} />
              <Button label="New repo or empty project" systemImage="folder.badge.plus" modifiers={buttonModifiers()} />
            </HStack>
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
