import { ChevronLeft } from "lucide-react";
import * as React from "react";
import * as Router from "last-ts/Router";
import { Composer } from "../components/Composer";
import { DebugSafeArea } from "../components/DebugSafeArea";
import { MessageBubble } from "../components/MessageBubble";
import { client } from "../opencode/client";
import { useSessionStream } from "../opencode/useSessionStream";
import { urls } from "../site";
import { navigateWithTransition } from "../viewTransition";

export const SessionChat = (props: { readonly id: string }): React.ReactElement => {
  const router = Router.useRouter();
  const { transcript, markBusy, clearBusy } = useSessionStream(props.id);
  const [title, setTitle] = React.useState<string | undefined>(undefined);
  const bottomRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [transcript.order.length]);

  React.useEffect(() => {
    setTitle(undefined);
    client.session
      .get({ path: { id: props.id } })
      .then(({ data }) => setTitle(data?.title))
      .catch(() => {
        // Non-critical — the header just shows the raw id as a fallback.
      });
  }, [props.id]);

  const goBack = (): void => {
    navigateWithTransition(() => router.go(urls.sessions()));
  };

  return (
    <div className="session-chat">
      <header className="chat-header" style={{ viewTransitionName: `session-${props.id}` }}>
        <button type="button" className="back-link" aria-label="Back to sessions" onClick={goBack}>
          <ChevronLeft size={20} strokeWidth={2.2} aria-hidden="true" />
        </button>
        <span className="chat-title">{title ?? props.id}</span>
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
      <DebugSafeArea />
    </div>
  );
};
