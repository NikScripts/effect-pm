import ActivityKit
import ExpoModulesCore
import Foundation

/**
 Starts, updates and ends a session's Live Activity.

 One activity per session, tracked by session id rather than by the opaque
 activity id, so the JS side never has to hold a handle across a reload — a
 Metro refresh would otherwise orphan a running activity with no way to end it.

 Activities are not updated while the app is suspended. The elapsed timer runs
 on-device from `startedAt`, so a backgrounded activity keeps counting
 correctly; what it cannot do is notice the run finishing. `staleDate` covers
 that: iOS dims the activity once it passes, so a run that ended while the app
 was closed reads as stale rather than as still working. Ending it precisely
 requires an ActivityKit push, which needs raw APNs rather than Expo's push
 service — see `pushToken`, which exposes what that would need.
 */
public class LiveActivityModule: Module {
  /// Live activities time out server-side long before iOS's own 8-hour limit
  /// matters here; a run that has not been updated in this long is almost
  /// certainly over.
  private static let staleAfter: TimeInterval = 15 * 60

  public func definition() -> ModuleDefinition {
    Name("LiveActivity")

    Function("isSupported") { () -> Bool in
      guard #available(iOS 16.2, *) else { return false }
      return ActivityAuthorizationInfo().areActivitiesEnabled
    }

    AsyncFunction("start") { (sessionID: String, repo: String, worktree: String, title: String, action: String) -> String? in
      guard #available(iOS 16.2, *) else { return nil }
      guard ActivityAuthorizationInfo().areActivitiesEnabled else { return nil }

      // Never run two for one session: a second `request` would stack a
      // duplicate in the island with no way to tell them apart.
      if let existing = Self.activity(for: sessionID) {
        return existing.id
      }

      let attributes = SessionActivityAttributes(
        sessionID: sessionID,
        repo: repo,
        worktree: worktree,
        title: title
      )
      let state = SessionActivityAttributes.ContentState(
        status: "working",
        action: action,
        messageCount: 0,
        startedAt: Date()
      )

      do {
        let activity = try Activity.request(
          attributes: attributes,
          content: ActivityContent(state: state, staleDate: Date().addingTimeInterval(Self.staleAfter)),
          pushType: nil
        )
        return activity.id
      } catch {
        throw Exception(name: "LiveActivityStartFailed", description: String(describing: error))
      }
    }

    AsyncFunction("update") { (sessionID: String, status: String, action: String, messageCount: Int) -> Bool in
      guard #available(iOS 16.2, *), let activity = Self.activity(for: sessionID) else { return false }
      // `startedAt` is carried forward from the running activity so the
      // on-device timer is never reset by an update.
      let state = SessionActivityAttributes.ContentState(
        status: status,
        action: action,
        messageCount: messageCount,
        startedAt: activity.content.state.startedAt
      )
      await activity.update(
        ActivityContent(state: state, staleDate: Date().addingTimeInterval(Self.staleAfter))
      )
      return true
    }

    AsyncFunction("end") { (sessionID: String, status: String) -> Bool in
      guard #available(iOS 16.2, *), let activity = Self.activity(for: sessionID) else { return false }
      let state = SessionActivityAttributes.ContentState(
        status: status,
        action: status == "error" ? "Failed" : "Finished",
        messageCount: activity.content.state.messageCount,
        startedAt: activity.content.state.startedAt
      )
      // Left on screen briefly rather than dismissed outright: the whole point
      // is to be seen without opening the app.
      await activity.end(ActivityContent(state: state, staleDate: nil), dismissalPolicy: .after(Date().addingTimeInterval(30)))
      return true
    }

    /// Ends every activity this app owns. Used on a clean start so a Metro
    /// reload cannot leave one running with nothing tracking it.
    AsyncFunction("endAll") { () -> Int in
      guard #available(iOS 16.2, *) else { return 0 }
      var ended = 0
      for activity in Activity<SessionActivityAttributes>.activities {
        await activity.end(nil, dismissalPolicy: .immediate)
        ended += 1
      }
      return ended
    }
  }

  @available(iOS 16.2, *)
  private static func activity(for sessionID: String) -> Activity<SessionActivityAttributes>? {
    Activity<SessionActivityAttributes>.activities.first { $0.attributes.sessionID == sessionID }
  }
}
