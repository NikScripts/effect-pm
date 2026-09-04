import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

@main
struct DoubleAgentActivityBundle: WidgetBundle {
  var body: some Widget {
    SessionActivityWidget()
  }
}

/// Colors are resolved per status rather than hardcoded so "done" and "error"
/// read differently at a glance in the island's compact form, which is often
/// all that is visible.
private extension SessionActivityAttributes.ContentState {
  var isWorking: Bool { status == "working" }

  var tint: Color {
    switch status {
    case "done": return .green
    case "error": return .red
    default: return .accentColor
    }
  }

  var symbol: String {
    switch status {
    case "done": return "checkmark.circle.fill"
    case "error": return "exclamationmark.triangle.fill"
    default: return "sparkles"
    }
  }
}

struct SessionActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: SessionActivityAttributes.self) { context in
      LockScreenView(context: context)
        .activityBackgroundTint(Color.black.opacity(0.55))
        .activitySystemActionForegroundColor(.white)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Label(context.attributes.repo, systemImage: "folder")
            .font(.caption)
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }
        DynamicIslandExpandedRegion(.trailing) {
          ElapsedView(state: context.state)
            .font(.caption.monospacedDigit())
            .foregroundStyle(.secondary)
        }
        DynamicIslandExpandedRegion(.center) {
          Text(context.attributes.title)
            .font(.headline)
            .lineLimit(1)
        }
        DynamicIslandExpandedRegion(.bottom) {
          VStack(spacing: 8) {
            Text(context.state.action)
              .font(.caption)
              .foregroundStyle(.secondary)
              .lineLimit(1)

            if context.state.isWorking, #available(iOS 17.0, *) {
              Button(intent: StopAgentIntent(sessionID: context.attributes.sessionID)) {
                Label("Stop", systemImage: "stop.fill")
                  .font(.caption.weight(.semibold))
                  .frame(maxWidth: .infinity)
              }
              .buttonStyle(.bordered)
              .tint(.red)
            }
          }
        }
      } compactLeading: {
        Image(systemName: context.state.symbol)
          .foregroundStyle(context.state.tint)
      } compactTrailing: {
        ElapsedView(state: context.state)
          .font(.caption2.monospacedDigit())
          .foregroundStyle(context.state.tint)
      } minimal: {
        Image(systemName: context.state.symbol)
          .foregroundStyle(context.state.tint)
      }
      .keylineTint(context.state.tint)
    }
  }
}

/// A device-side timer. Pushing a new content state once per second would blow
/// through the ActivityKit update budget within a minute, so the start time is
/// pushed once and the countdown runs locally.
private struct ElapsedView: View {
  let state: SessionActivityAttributes.ContentState

  var body: some View {
    if state.isWorking {
      Text(state.startedAt, style: .timer)
    } else {
      Text(state.status == "done" ? "Done" : "Failed")
    }
  }
}

private struct LockScreenView: View {
  let context: ActivityViewContext<SessionActivityAttributes>

  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      Image(systemName: context.state.symbol)
        .font(.title3)
        .foregroundStyle(context.state.tint)

      VStack(alignment: .leading, spacing: 3) {
        Text(context.attributes.title)
          .font(.headline)
          .lineLimit(1)

        Text(context.state.action)
          .font(.subheadline)
          .foregroundStyle(.secondary)
          .lineLimit(2)

        Text("\(context.attributes.repo) · \(context.attributes.worktree)")
          .font(.caption2)
          .foregroundStyle(.tertiary)
          .lineLimit(1)
      }

      Spacer(minLength: 0)

      VStack(alignment: .trailing, spacing: 8) {
        ElapsedView(state: context.state)
          .font(.caption.monospacedDigit())
          .foregroundStyle(.secondary)

        if context.state.isWorking, #available(iOS 17.0, *) {
          Button(intent: StopAgentIntent(sessionID: context.attributes.sessionID)) {
            Label("Stop", systemImage: "stop.fill")
              .font(.caption2.weight(.semibold))
          }
          .buttonStyle(.bordered)
          .tint(.red)
        }
      }
    }
    .padding(16)
  }
}
