import * as React from "react";
import type { TranscriptMessage } from "../opencode/useSessionStream";
import { Markdown } from "./Markdown";
import { ToolCallBubble } from "./ToolCallBubble";

export const MessageBubble = (props: {
  readonly message: TranscriptMessage;
}): React.ReactElement => (
  <div className={`message message-${props.message.role}`}>
    <div className="message-role">{props.message.role}</div>
    <div className="message-body">
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
