import AppIntents
import Foundation

/**
 The Stop button inside the Live Activity.

 `LiveActivityIntent` runs in the extension's own process without foregrounding
 the app, which is the whole point — killing a runaway agent from the lock
 screen should not require unlocking and waiting for a JS bundle to boot.

 The server address is read from the shared app group, written by the app
 whenever it connects. If it is missing the intent fails quietly: there is no
 useful recovery from a widget, and the run can still be stopped in the app.
 */
@available(iOS 17.0, *)
struct StopAgentIntent: LiveActivityIntent {
  static var title: LocalizedStringResource = "Stop agent"
  static var description = IntentDescription("Aborts the running agent session.")
  /// Never open the app — the whole value here is stopping without doing that.
  static var openAppWhenRun: Bool = false

  @Parameter(title: "Session ID")
  var sessionID: String

  init() {}

  init(sessionID: String) {
    self.sessionID = sessionID
  }

  func perform() async throws -> some IntentResult {
    guard
      let defaults = UserDefaults(suiteName: AppGroup.identifier),
      let base = defaults.string(forKey: AppGroup.serverURLKey),
      let url = URL(string: "\(base)/session/\(sessionID)/abort")
    else {
      return .result()
    }

    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.timeoutInterval = 8
    if let password = defaults.string(forKey: AppGroup.serverPasswordKey), !password.isEmpty {
      request.setValue("Bearer \(password)", forHTTPHeaderField: "Authorization")
    }

    _ = try? await URLSession.shared.data(for: request)
    return .result()
  }
}

/// Keys shared between the app and this extension. Duplicated in
/// `modules/live-activity/ios/LiveActivityModule.swift` — see the note there.
enum AppGroup {
  static let identifier = "group.com.nikolasstow.agentconsolenative"
  static let serverURLKey = "serverURL"
  static let serverPasswordKey = "serverPassword"
}
