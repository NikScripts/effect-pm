import * as React from "react";
import { Composer } from "../components/Composer";
import { MessageBubble } from "../components/MessageBubble";
import { useSessionStream } from "../opencode/useSessionStream";
import { Link } from "../site";

export const SessionChat = (props: { readonly id: string }): React.ReactElement => {
  const { transcript, markBusy } = useSessionStream(props.id);
  const bottomRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [transcript.order.length]);

  return (
    <div className="session-chat">
      <header>
        <Link to={(u) => u.sessions()}>&larr; Sessions</Link>
      </header>
      <div className="transcript">
        {transcript.order.map((messageID) => {
          const message = transcript.messages.get(messageID);
          return message === undefined ? null : (
            <MessageBubble key={messageID} message={message} />
          );
        })}
        {transcript.busy ? <div className="typing">assistant is responding…</div> : null}
        <div ref={bottomRef} />
      </div>
      <Composer
        sessionID={props.id}
        disabled={transcript.busy}
        onSend={markBusy}
      />
    </div>
  );
};
