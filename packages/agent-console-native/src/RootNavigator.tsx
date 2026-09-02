/**
 * Real native push/pop navigation — `@react-navigation/native-stack` wraps
 * the actual `UINavigationController`, giving the exact same slide
 * transition (and swipe-back gesture) iOS itself uses, not a hand-rolled
 * approximation. Mounted once app-wide dependencies (client/rootDir) are
 * resolved — see App.tsx's own bootstrap flow for everything before that.
 *
 * @internal
 */
import { DarkTheme, DefaultTheme, NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import * as React from "react";
import { useColorScheme } from "react-native";
import { colors } from "./colors";
import { HomeScreen } from "./HomeScreen";
import { SessionChatScreen } from "./SessionChatScreen";
import { SettingsScreen } from "./SettingsScreen";

export type RootStackParamList = {
  Home: undefined;
  Chat: { sessionID: string };
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

/** react-navigation's `Theme` type requires plain string colors (it can't
 * accept `PlatformColor`, unlike a real RN `ViewStyle`), so this can't just
 * reuse colors.ts — these are Apple's own documented systemGroupedBackground/
 * secondarySystemGroupedBackground hex values, matched by mode. Needed so
 * the navigator's own background (visible during the swipe-back gesture,
 * separately from each screen's own `contentStyle`) doesn't show through as
 * a mismatched "second background" under our content. */
const LIGHT_THEME = { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: "#F2F2F7", card: "#FFFFFF" } };
const DARK_THEME = { ...DarkTheme, colors: { ...DarkTheme.colors, background: "#000000", card: "#1C1C1E" } };

export const RootNavigator = (): React.ReactElement => {
  const scheme = useColorScheme();
  return (
    <NavigationContainer theme={scheme === "dark" ? DARK_THEME : LIGHT_THEME}>
      <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
        {/* `scrollEdgeEffects` is deliberately NOT set here — each screen
         * applies it via `useScrollEdgeEffects` after mount instead. See
         * that hook for why a static option silently does nothing. */}
        {/* Native prop delivery is confirmed working — a `statusBarStyle`
         * probe reached RNSScreen's native side and came back with its own
         * Info.plist warning, so silent no-ops from `scrollEdgeEffects`
         * are that feature's own problem, not a stale binary.
         *
         * `UIScrollEdgeEffect` draws into the scroll view's safe-area inset
         * region, so the list also needs `contentInsetAdjustmentBehavior`
         * set — see HomeScreen's own note. */}
        <Stack.Screen name="Home" component={HomeScreen} options={{ scrollEdgeEffects: { top: "soft", bottom: "soft" } }} />
        <Stack.Screen name="Chat" component={SessionChatScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
};
