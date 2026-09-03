/**
 * Feathered top/bottom blur + light wash shared by Home and Chat.
 *
 * Directions are the working on-device pair — top=`down`, bottom=`up`.
 * Do not flip. When `busy`, the bottom wash tints system blue and pulses.
 *
 * @internal
 */
import * as React from "react";
import { Animated, DynamicColorIOS, Platform, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { VariableBlur } from "../modules/variable-blur";

const TOP_BLUR_RADIUS = 5;
const BOTTOM_BLUR_RADIUS = 3;
const TOP_BLUR_HEIGHT = 120;
const BOTTOM_BLUR_HEIGHT = 80;

const EDGE_LIGHT_STOPS = [
  DynamicColorIOS({ light: "rgba(255,255,255,0.55)", dark: "rgba(0,0,0,0.5)" }),
  DynamicColorIOS({ light: "rgba(255,255,255,0.28)", dark: "rgba(0,0,0,0.26)" }),
  DynamicColorIOS({ light: "rgba(255,255,255,0.1)", dark: "rgba(0,0,0,0.1)" }),
  "transparent",
] as const;

/** System blue at falling alpha — same #007AFF / #0A84FF pair as colors.accentTint. */
const EDGE_BUSY_STOPS = [
  DynamicColorIOS({ light: "rgba(0,122,255,0.42)", dark: "rgba(10,132,255,0.38)" }),
  DynamicColorIOS({ light: "rgba(0,122,255,0.22)", dark: "rgba(10,132,255,0.2)" }),
  DynamicColorIOS({ light: "rgba(0,122,255,0.08)", dark: "rgba(10,132,255,0.08)" }),
  "transparent",
] as const;

const EDGE_LOCATIONS = [0, 0.35, 0.7, 1] as const;

const BUSY_PULSE_MS = 900;

export const EdgeBlurBars = (props: {
  readonly bottomInset: number;
  readonly busy?: boolean;
}): React.ReactElement | null => {
  const pulse = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (!props.busy) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: BUSY_PULSE_MS, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: BUSY_PULSE_MS, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [props.busy, pulse]);

  if (Platform.OS !== "ios") return null;

  const busyOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.95] });

  return (
    <>
      <View style={[styles.edge, { top: 0, height: TOP_BLUR_HEIGHT }]} pointerEvents="none">
        <VariableBlur blurRadius={TOP_BLUR_RADIUS} direction="down" style={StyleSheet.absoluteFill} />
        <LinearGradient
          colors={[...EDGE_LIGHT_STOPS]}
          locations={[...EDGE_LOCATIONS]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </View>
      <View style={[styles.edge, { bottom: props.bottomInset, height: BOTTOM_BLUR_HEIGHT }]} pointerEvents="none">
        <VariableBlur blurRadius={BOTTOM_BLUR_RADIUS} direction="up" style={StyleSheet.absoluteFill} />
        <LinearGradient
          colors={[...EDGE_LIGHT_STOPS]}
          locations={[...EDGE_LOCATIONS]}
          start={{ x: 0.5, y: 1 }}
          end={{ x: 0.5, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
        {props.busy ? (
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: busyOpacity }]}>
            <LinearGradient
              colors={[...EDGE_BUSY_STOPS]}
              locations={[...EDGE_LOCATIONS]}
              start={{ x: 0.5, y: 1 }}
              end={{ x: 0.5, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        ) : null}
      </View>
    </>
  );
};

const styles = StyleSheet.create({
  edge: {
    position: "absolute",
    left: 0,
    right: 0,
  },
});
