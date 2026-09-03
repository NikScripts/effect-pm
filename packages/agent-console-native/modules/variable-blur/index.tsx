/**
 * Progressive backdrop blur — blur radius ramps along one edge via private
 * `CAFilter.variableBlur`. iOS only; renders nothing elsewhere.
 *
 * @internal
 */
import { requireNativeView } from "expo";
import * as React from "react";
import { Platform, type ViewProps } from "react-native";

export type VariableBlurProps = ViewProps & {
  readonly blurRadius?: number;
  readonly direction?: "up" | "down";
};

const NativeView =
  Platform.OS === "ios" ? requireNativeView<VariableBlurProps>("VariableBlur") : null;

export const VariableBlur = (props: VariableBlurProps): React.ReactElement | null =>
  NativeView === null ? null : <NativeView {...props} />;
