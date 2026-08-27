/**
 * Home's collapsed bottom bar — a tap target styled like a composer, not an
 * editable one. Tapping it opens the real new-session picker (repo →
 * worktree → model). Matches web's `.home-composer-bar` (itself modeled on
 * the iOS Cursor app's own bottom bar), rendered here with genuine Liquid
 * Glass instead of a flat `--bg-raised` color — one continuous glass pill
 * behind the whole row, same as the nav bar's per-button glass.
 *
 * The picker sheet itself isn't wired up yet — `onPress` is a stub for now,
 * this increment is just the collapsed bar's shape and position.
 *
 * @internal
 */
import { Button, HStack, Host, Image, Spacer, Text } from "@expo/ui/swift-ui";
import { backgroundOverlay, buttonStyle, clipShape, font, foregroundStyle, frame, glassEffect, padding } from "@expo/ui/swift-ui/modifiers";
import * as React from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "./colors";
import { COMPOSER_BAR_HEIGHT, COMPOSER_BAR_PADDING, COMPOSER_BAR_SPACING, COMPOSER_CHIP_SIZE, COMPOSER_SEND_CHIP_SIZE } from "./composerBarSpec";

const BAR_MARGIN = 12;

export const useComposerBarHeight = (): number => {
  const insets = useSafeAreaInsets();
  return COMPOSER_BAR_HEIGHT + BAR_MARGIN * 2 + insets.bottom;
};

export const HomeComposerBar = (props: { readonly onPress: () => void }): React.ReactElement => {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[styles.root, { paddingBottom: insets.bottom + BAR_MARGIN, height: COMPOSER_BAR_HEIGHT + BAR_MARGIN * 2 + insets.bottom }]}
      pointerEvents="box-none"
    >
      <Host matchContents={{ vertical: true }}>
        <Button onPress={props.onPress} modifiers={[buttonStyle("plain")]}>
          <HStack
            alignment="center"
            spacing={COMPOSER_BAR_SPACING}
            modifiers={[padding({ horizontal: COMPOSER_BAR_PADDING, vertical: COMPOSER_BAR_PADDING }), glassEffect({ glass: { variant: "regular" }, shape: "capsule" })]}
          >
            <Image
              systemName="plus"
              size={14}
              color={colors.secondaryLabel}
              modifiers={[
                frame({ width: COMPOSER_CHIP_SIZE, height: COMPOSER_CHIP_SIZE }),
                backgroundOverlay({ color: colors.fillBackground }),
                clipShape("circle"),
              ]}
            />
            <Text modifiers={[font({ size: 16 }), foregroundStyle(colors.secondaryLabel)]}>Plan, ask, build…</Text>
            <Spacer />
            <Image
              systemName="arrow.up"
              size={15}
              color={colors.secondaryLabel}
              modifiers={[
                frame({ width: COMPOSER_SEND_CHIP_SIZE, height: COMPOSER_SEND_CHIP_SIZE }),
                backgroundOverlay({ color: colors.fillBackground }),
                clipShape("circle"),
              ]}
            />
          </HStack>
        </Button>
      </Host>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: BAR_MARGIN,
    zIndex: 10,
    justifyContent: "flex-end",
  },
});
