/**
 * Shown while the agent is working — three dots bouncing in sequence,
 * matching web's `.typing` (translateY + opacity pulse, 1.1s loop,
 * 150ms stagger per dot). Native equivalent built on `Animated` rather
 * than CSS keyframes.
 *
 * @internal
 */
import * as React from "react";
import { Animated, StyleSheet, View } from "react-native";
import { colors } from "./colors";

const CYCLE_MS = 550;
const STAGGER_MS = 150;

const Dot = (props: { readonly delay: number }): React.ReactElement => {
  const value = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, { toValue: 1, duration: CYCLE_MS, useNativeDriver: true }),
        Animated.timing(value, { toValue: 0, duration: CYCLE_MS, useNativeDriver: true }),
      ]),
    );
    const timer = setTimeout(() => loop.start(), props.delay);
    return () => {
      clearTimeout(timer);
      loop.stop();
    };
  }, [value, props.delay]);

  const translateY = value.interpolate({ inputRange: [0, 1], outputRange: [0, -4] });
  const opacity = value.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] });

  return <Animated.View style={[styles.dot, { transform: [{ translateY }], opacity }]} />;
};

export const TypingIndicator = (): React.ReactElement => (
  <View style={styles.root}>
    <Dot delay={0} />
    <Dot delay={STAGGER_MS} />
    <Dot delay={STAGGER_MS * 2} />
  </View>
);

const styles = StyleSheet.create({
  root: {
    flexDirection: "row",
    gap: 4,
    paddingVertical: 8,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.secondaryLabel,
  },
});
