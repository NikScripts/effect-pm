/**
 * Composer model selector — SwiftUI `Menu` of connected providers/models.
 * Label is the model name (or “Model” while loading); not “Auto” (Cursor’s
 * routing feature, which we don’t replicate). Section titles use the
 * server’s provider `name` as-is — no client-side title-casing.
 *
 * @internal
 */
import { Feather } from "@expo/vector-icons";
import { Host, Menu, RNHostView, Section, Toggle } from "@expo/ui/swift-ui";
import { buttonStyle, menuIndicator, menuStyle } from "@expo/ui/swift-ui/modifiers";
import * as React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors } from "./colors";
import { COMPOSER_CHIP_SIZE } from "./composerBarSpec";
import { modelKey, type ModelOption } from "./models";

const MENU_MODIFIERS = [menuStyle("button"), buttonStyle("plain"), menuIndicator("hidden")] as const;

type Props = {
  readonly models: ReadonlyArray<ModelOption>;
  readonly selected: ModelOption | undefined;
  readonly onChange: (model: ModelOption) => void;
};

type ProviderGroup = {
  readonly providerID: string;
  readonly title: string;
  readonly models: ReadonlyArray<ModelOption>;
};

export const ModelPicker = (props: Props): React.ReactElement => {
  const label = props.selected?.name ?? (props.models.length === 0 ? "Model…" : "Model");

  const groups = React.useMemo((): ReadonlyArray<ProviderGroup> => {
    const map = new Map<string, { title: string; models: Array<ModelOption> }>();
    for (const model of props.models) {
      const existing = map.get(model.providerID);
      if (existing === undefined) {
        map.set(model.providerID, { title: model.providerName, models: [model] });
      } else {
        existing.models.push(model);
      }
    }
    return Array.from(map.entries()).map(([providerID, group]) => ({
      providerID,
      title: group.title,
      models: group.models,
    }));
  }, [props.models]);

  return (
    <Host style={styles.host} matchContents={{ vertical: true }} ignoreSafeArea="all">
      <Menu
        label={
          <RNHostView matchContents>
            <View style={styles.label}>
              <Text style={styles.labelText} numberOfLines={1} ellipsizeMode="middle">
                {label}
              </Text>
              <Feather name="chevron-down" size={13} color={colors.secondaryLabel} />
            </View>
          </RNHostView>
        }
        modifiers={[...MENU_MODIFIERS]}
      >
        {groups.map((group) => (
          <Section key={group.providerID} title={group.title}>
            {group.models.map((model) => {
              const active =
                props.selected !== undefined && modelKey(props.selected) === modelKey(model);
              return (
                <Toggle
                  key={modelKey(model)}
                  label={model.name}
                  isOn={active}
                  onIsOnChange={(on) => {
                    if (on) props.onChange(model);
                  }}
                />
              );
            })}
          </Section>
        ))}
      </Menu>
    </Host>
  );
};

const styles = StyleSheet.create({
  host: {
    height: COMPOSER_CHIP_SIZE,
    maxWidth: "100%",
    alignSelf: "flex-start",
  },
  label: {
    height: COMPOSER_CHIP_SIZE,
    maxWidth: 220,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingRight: 4,
  },
  labelText: {
    flexShrink: 1,
    color: colors.secondaryLabel,
    fontSize: 13,
    fontWeight: "500",
  },
});
