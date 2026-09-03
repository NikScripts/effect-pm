/**
 * Full Settings — workspace organization (where repos live, where new
 * worktrees are created, which worktree opens by default), session
 * permission defaults, and server connection. Mirrors the web Settings
 * information architecture in an iOS grouped-list layout.
 *
 * @internal
 */
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as React from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppContext } from "./AppContext";
import { colors } from "./colors";
import { getLastScanAt, rescan } from "./repoScanCache";
import type { RootStackParamList } from "./RootNavigator";
import {
  getDefaultPermissionModeSync,
  primeDefaultPermissionMode,
  type PermissionMode,
} from "./sessionPermissions";
import {
  DEFAULT_WORKTREE_TEMPLATE,
  getDefaultPermissionMode,
  getDefaultWorktreePreference,
  getWorktreeTemplate,
  setDefaultPermissionMode,
  setDefaultWorktreePreference,
  setWorktreeTemplate,
  type DefaultWorktreePreference,
} from "./settings";
import { resolveWorktreePath } from "./worktree";
import { SystemIcon } from "./SystemIcon";

type Props = NativeStackScreenProps<RootStackParamList, "Settings">;

const timeAgo = (ms: number): string => {
  const seconds = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

export const SettingsScreen = (props: Props): React.ReactElement => {
  const insets = useSafeAreaInsets();
  const { client, address, rootDir, onChangeRootDir, onChangeServer } = useAppContext();

  const [rootDirDraft, setRootDirDraft] = React.useState(rootDir);
  const [templateDraft, setTemplateDraft] = React.useState(DEFAULT_WORKTREE_TEMPLATE);
  const [worktreePref, setWorktreePref] = React.useState<DefaultWorktreePreference>("main");
  const [defaultMode, setDefaultMode] = React.useState<PermissionMode>(getDefaultPermissionModeSync);
  const [lastScanAt, setLastScanAt] = React.useState<number | undefined>(undefined);
  const [scanning, setScanning] = React.useState(false);
  const [scanError, setScanError] = React.useState<string | undefined>(undefined);

  React.useEffect(() => {
    setRootDirDraft(rootDir);
  }, [rootDir]);

  React.useEffect(() => {
    void (async () => {
      const [template, pref, mode, scannedAt] = await Promise.all([
        getWorktreeTemplate(),
        getDefaultWorktreePreference(),
        getDefaultPermissionMode(),
        getLastScanAt(),
      ]);
      setTemplateDraft(template);
      setWorktreePref(pref);
      setDefaultMode(mode);
      setLastScanAt(scannedAt);
    })();
  }, []);

  const saveRootDir = (): void => {
    const trimmed = rootDirDraft.trim();
    if (trimmed.length === 0 || trimmed === rootDir) {
      setRootDirDraft(rootDir);
      return;
    }
    onChangeRootDir(trimmed);
  };

  const saveTemplate = (): void => {
    const trimmed = templateDraft.trim();
    const next = trimmed.length === 0 ? DEFAULT_WORKTREE_TEMPLATE : trimmed;
    setTemplateDraft(next);
    void setWorktreeTemplate(next);
  };

  const chooseWorktreePref = (pref: DefaultWorktreePreference): void => {
    setWorktreePref(pref);
    void setDefaultWorktreePreference(pref);
  };

  const chooseDefault = (mode: PermissionMode): void => {
    setDefaultMode(mode);
    primeDefaultPermissionMode(mode);
    void setDefaultPermissionMode(mode);
  };

  const runRescan = async (): Promise<void> => {
    setScanning(true);
    setScanError(undefined);
    try {
      await rescan(client, rootDir);
      setLastScanAt(await getLastScanAt());
    } catch (err) {
      setScanError(err instanceof Error ? err.message : "Rescan failed.");
    } finally {
      setScanning(false);
    }
  };

  const previewPath = resolveWorktreePath(
    rootDirDraft.trim() || rootDir,
    "Hyperlink",
    "feature-branch",
    templateDraft.trim() || DEFAULT_WORKTREE_TEMPLATE,
  );

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.backButton} onPress={() => props.navigation.goBack()} accessibilityLabel="Back">
          <SystemIcon name="chevron.left" size={20} color={colors.tint} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <Text style={[styles.sectionLabel, styles.sectionLabelFirst]}>Workspace</Text>
        <View style={styles.card}>
          <Text style={styles.fieldLabel}>Root folder</Text>
          <Text style={styles.hint}>
            Where we look for repos. A repo’s main checkout is whatever directory under here already
            owns the real .git — we don’t move or create that; we find it.
          </Text>
          <TextInput
            style={styles.input}
            value={rootDirDraft}
            onChangeText={setRootDirDraft}
            onBlur={saveRootDir}
            onSubmitEditing={saveRootDir}
            placeholder="/Users/you/Coding"
            placeholderTextColor={colors.placeholderText}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.fieldLabel}>Main vs linked worktrees</Text>
          <Text style={styles.hint}>
            Main is the primary checkout (e.g. {"{root}"}/Hyperlink or {"{root}"}/packages/effect-pm).
            Linked worktrees — what “Create new…” adds — are extra checkouts of that same repo, and
            only those follow the path template below.
          </Text>
        </View>

        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Repo scan</Text>
              <Text style={styles.hint}>
                {lastScanAt === undefined ? "Never scanned." : `Last scanned ${timeAgo(lastScanAt)}.`}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.actionChip, scanning && styles.actionChipDisabled]}
              onPress={() => void runRescan()}
              disabled={scanning}
              activeOpacity={0.6}
            >
              {scanning ? (
                <ActivityIndicator size="small" color={colors.tint} />
              ) : (
                <Text style={styles.actionChipText}>Rescan</Text>
              )}
            </TouchableOpacity>
          </View>
          {scanError !== undefined ? <Text style={styles.errorText}>{scanError}</Text> : null}
        </View>

        <Text style={styles.sectionLabel}>Linked worktrees</Text>
        <View style={styles.card}>
          <Text style={styles.fieldLabel}>Path template</Text>
          <Text style={styles.hint}>
            Used only when creating a linked worktree. Placeholders: {"{root}"}, {"{repo}"}, {"{name}"}.
            Does not relocate the main checkout.
          </Text>
          <TextInput
            style={styles.input}
            value={templateDraft}
            onChangeText={setTemplateDraft}
            onBlur={saveTemplate}
            onSubmitEditing={saveTemplate}
            placeholder={DEFAULT_WORKTREE_TEMPLATE}
            placeholderTextColor={colors.placeholderText}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
          />
          <Text style={styles.previewLabel}>Preview</Text>
          <Text style={styles.previewPath} numberOfLines={2} ellipsizeMode="head">
            {previewPath}
          </Text>
        </View>

        <Text style={styles.sectionLabel}>When opening a repo</Text>
        <View style={styles.card}>
          <Text style={styles.hint}>Which worktree the composer selects after you pick a repo.</Text>
          {(
            [
              { value: "main", title: "Main checkout", detail: "Always the primary worktree" },
              { value: "last", title: "Last used", detail: "Remember per repo" },
            ] as const
          ).map((option, index) => (
            <TouchableOpacity
              key={option.value}
              style={[styles.optionRow, index > 0 && styles.optionRowBorder]}
              activeOpacity={0.6}
              onPress={() => chooseWorktreePref(option.value)}
            >
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{option.title}</Text>
                <Text style={styles.hint}>{option.detail}</Text>
              </View>
              {worktreePref === option.value ? (
                <SystemIcon name="checkmark" size={15} color={colors.tint} />
              ) : null}
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionLabel}>New sessions start with</Text>
        <View style={styles.card}>
          {(
            [
              { value: "full", title: "Allow all" },
              { value: "ask", title: "Ask before each action" },
            ] as const
          ).map((option, index) => (
            <TouchableOpacity
              key={option.value}
              style={[styles.optionRow, index > 0 && styles.optionRowBorder]}
              activeOpacity={0.6}
              onPress={() => chooseDefault(option.value)}
            >
              <Text style={styles.rowTitle}>{option.title}</Text>
              {defaultMode === option.value ? (
                <SystemIcon name="checkmark" size={15} color={colors.tint} />
              ) : null}
            </TouchableOpacity>
          ))}
          <Text style={[styles.hint, styles.optionFooter]}>
            Each session can still be switched from its own menu; that choice lasts until the app restarts.
          </Text>
        </View>

        <Text style={styles.sectionLabel}>Server</Text>
        <View style={styles.card}>
          <Text style={styles.fieldLabel}>Address</Text>
          <Text style={styles.serverAddress} numberOfLines={1} ellipsizeMode="middle">
            {address}
          </Text>
          <TouchableOpacity style={styles.destructiveRow} activeOpacity={0.6} onPress={onChangeServer}>
            <Text style={styles.destructiveText}>Change server…</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
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
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  sectionLabel: {
    color: colors.secondaryLabel,
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginTop: 28,
    marginBottom: 8,
    marginHorizontal: 4,
  },
  sectionLabelFirst: {
    marginTop: 16,
  },
  card: {
    backgroundColor: colors.cardBackground,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
    gap: 8,
  },
  fieldLabel: {
    color: colors.label,
    fontSize: 15,
    fontWeight: "600",
  },
  hint: {
    color: colors.secondaryLabel,
    fontSize: 13,
    lineHeight: 18,
  },
  input: {
    marginTop: 2,
    color: colors.label,
    fontSize: 15,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: colors.fillBackground,
  },
  previewLabel: {
    color: colors.secondaryLabel,
    fontSize: 12,
    fontWeight: "600",
    marginTop: 4,
  },
  previewPath: {
    color: colors.secondaryLabel,
    fontSize: 13,
    fontFamily: "Menlo",
  },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    color: colors.label,
    fontSize: 15,
    fontWeight: "500",
  },
  actionChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.accentTint,
    minWidth: 72,
    alignItems: "center",
  },
  actionChipDisabled: {
    opacity: 0.6,
  },
  actionChipText: {
    color: colors.tint,
    fontSize: 14,
    fontWeight: "600",
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 10,
  },
  optionRowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  optionFooter: {
    marginTop: 2,
  },
  serverAddress: {
    color: colors.label,
    fontSize: 15,
  },
  destructiveRow: {
    paddingTop: 6,
    paddingBottom: 2,
  },
  destructiveText: {
    color: colors.destructive,
    fontSize: 15,
    fontWeight: "500",
  },
  errorText: {
    color: colors.destructive,
    fontSize: 13,
  },
});
