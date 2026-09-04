import ActivityKit
import Foundation

/**
 ⚠️ This type is duplicated verbatim in `targets/activity/`. The app and the
 widget extension are separate compilation units with no shared framework
 between them, so each needs its own copy. ActivityKit matches them by
 *structure*, not by module — if the two files drift, `Activity.request` fails
 at runtime rather than at compile time. Change both together.
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
