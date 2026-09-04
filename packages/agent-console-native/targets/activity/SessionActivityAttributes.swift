import ActivityKit
import Foundation

/**
 The shape of a session's Live Activity.

 ⚠️ This type is duplicated verbatim in `modules/live-activity/ios/`. The app
 and the widget extension are separate compilation units and there is no shared
 framework between them, so both need their own copy. ActivityKit matches them
 by *structure*, not by module — if these two files drift, `Activity.request`
 starts failing at runtime rather than at compile time. Change both together.

 `ContentState` is what push updates carry, so it stays small and `Codable`.
 */
struct SessionActivityAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    /// "working" | "done" | "error"
    var status: String
    /// What the agent is doing right now, e.g. "editing Composer.tsx".
    var action: String
    /// Drives the lock screen's message counter.
    var messageCount: Int
    /// Start of the run, so the timer counts up on device rather than
    /// needing a push per second.
    var startedAt: Date
  }

  var sessionID: String
  var repo: String
  var worktree: String
  var title: String
}
