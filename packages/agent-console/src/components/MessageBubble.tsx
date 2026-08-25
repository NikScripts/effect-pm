import * as React from "react";
import type { TranscriptMessage } from "../opencode/useSessionStream";
import { Markdown } from "./Markdown";

export const MessageBubble = (props: {
  readonly message: TranscriptMessage;
}): React.ReactElement => {
  const text = Array.from(props.message.parts.values())
    .map((part) => part.text)
    .join("");
  return (
    <div className={`message message-${props.message.role}`}>
      <div className="message-role">{props.message.role}</div>
      <div className="message-body">
        <Markdown text={text} />
      </div>
    </div>
  );
};
