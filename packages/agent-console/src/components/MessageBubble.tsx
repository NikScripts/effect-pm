import * as React from "react";
import type { TranscriptMessage } from "../opencode/useSessionStream";
import { Markdown } from "./Markdown";
import { ToolCallBubble } from "./ToolCallBubble";

/**
 * User = right-aligned tinted bubble; assistant = plain left-aligned text, no
 * bubble — the pattern ChatGPT/Claude's own web clients use, not a dev-tool log.
 */
export const MessageBubble = (props: {
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
