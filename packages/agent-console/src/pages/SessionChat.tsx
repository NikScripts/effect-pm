import * as React from "react";
import { Composer } from "../components/Composer";
import { MessageBubble } from "../components/MessageBubble";
import { useSessionStream } from "../opencode/useSessionStream";
import { Link } from "../site";

export const SessionChat = (props: { readonly id: string }): React.ReactElement => {
  const { transcript, markBusy, clearBusy } = useSessionStream(props.id);
  const bottomRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [transcript.order.length]);

  return (
    <div className="session-chat">
      <header className="chat-header">
        <Link to={(u) => u.sessions()} className="back-link" aria-label="Back to sessions">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path
              d="M15 6l-6 6 6 6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Link>
      </header>
      <div className="transcript">
        {transcript.order.length === 0 ? (
          <div className="empty-chat">Ask a question, or ask it to make a change.</div>
        ) : (
          transcript.order.map((messageID) => {
            const message = transcript.messages.get(messageID);
            return message === undefined ? null : (
              <MessageBubble key={messageID} message={message} />
            );
          })
        )}
        {transcript.busy ? (
          <div className="typing">
            <span />
            <span />
            <span />
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>
      <Composer
        sessionID={props.id}
        disabled={transcript.busy}
        onSend={markBusy}
        onSendFailed={clearBusy}
      />
    </div>
  );
};
