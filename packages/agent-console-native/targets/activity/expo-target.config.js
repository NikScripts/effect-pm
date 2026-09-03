/**
 * The Live Activity / Dynamic Island target.
 *
 * `type: "widget"` is the extension kind that hosts both WidgetKit widgets and
 * ActivityKit Live Activities — they share one extension.
 *
 * The app group is what lets this extension read the server address and auth
 * that the app writes, so the Stop button can call the abort endpoint itself
 * instead of having to launch the app. It is mirrored from `ios.entitlements`
 * in app.json so the app and the extension can never drift apart.
 *
 * @type {import('@bacons/apple-targets/app.plugin').Config}
 */
module.exports = {
  type: "widget",
  name: "DoubleAgentActivity",
  displayName: "DoubleAgent",
  icon: "../../assets/icon.png",
  frameworks: ["SwiftUI", "WidgetKit", "ActivityKit", "AppIntents"],
};
