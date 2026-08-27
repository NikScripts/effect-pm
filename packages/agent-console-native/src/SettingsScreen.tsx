/**
 * Extracted from App.tsx's former inline JSX now that it's a real pushed
 * route rather than a hand-rolled state-machine step.
 *
 * @internal
 */
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as React from "react";
import { Button, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppContext } from "./AppContext";
import { colors } from "./colors";
import type { RootStackParamList } from "./RootNavigator";
import { SystemIcon } from "./SystemIcon";

type Props = NativeStackScreenProps<RootStackParamList, "Settings">;

export const SettingsScreen = (props: Props): React.ReactElement => {
  const insets = useSafeAreaInsets();
  const { address, rootDir, onChangeServer } = useAppContext();

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.backButton} onPress={() => props.navigation.goBack()} accessibilityLabel="Back">
          <SystemIcon name="chevron.left" size={20} color={colors.tint} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={styles.backButton} />
      </View>
      <View style={styles.content}>
        <Text style={styles.dimText}>Server: {address}</Text>
        <Text style={styles.dimText}>Root folder: {rootDir}</Text>
        <Button title="Change server" onPress={onChangeServer} />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 4,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    color: colors.label,
    fontSize: 17,
    fontWeight: "600",
    textAlign: "center",
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 24,
  },
  dimText: {
    color: colors.secondaryLabel,
    fontSize: 15,
    textAlign: "center",
  },
});
