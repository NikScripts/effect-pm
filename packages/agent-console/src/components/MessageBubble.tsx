import * as React from "react";
import type { TranscriptMessage } from "../opencode/useSessionStream";
import { Markdown } from "./Markdown";
import { ToolCallBubble } from "./ToolCallBubble";

/**
 * User = right-aligned tinted bubble; assistant = plain left-aligned text, no
 * bubble — the pattern ChatGPT/Claude's own web clients use, not a dev-tool log.
 *
 * Memoized: `useSessionStream`'s reducer only creates a new `TranscriptMessage`
 * object for the message an incoming event actually touched — every other
 * message keeps its previous object reference — so during a streaming
 * response this lets React skip re-rendering (and re-running Markdown/Shiki
 * on) every bubble except the one actually changing.
 */
const MessageBubbleImpl = (props: {
  readonly message: TranscriptMessage;
}): React.ReactElement => (
  <div className={`message message-${props.message.role}`}>
    <div className="bubble">
      {Array.from(props.message.parts.values()).map((part) =>
        part.type === "text" ? (
          <Markdown key={part.id} text={part.text} />
        ) : (
          <ToolCallBubble key={part.id} part={part} />
        ),
      )}
    </div>
  </div>
);
MessageBubbleImpl.displayName = "MessageBubble";

export const MessageBubble = React.memo(MessageBubbleImpl);
