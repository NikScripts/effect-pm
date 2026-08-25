import * as React from "react";
import { AGENT, client } from "../opencode/client";

export const Composer = (props: {
  readonly sessionID: string;
  readonly disabled: boolean;
  readonly onSend: () => void;
  readonly onSendFailed: () => void;
}): React.ReactElement => {
  const [text, setText] = React.useState("");
  const [error, setError] = React.useState<string | undefined>(undefined);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  // Auto-grow: mirrors ChatGPT/Claude's composer instead of a fixed-height box.
  // CSS `max-height` caps it; overflow scrolls inside the textarea past that.
  React.useLayoutEffect(() => {
    const el = textareaRef.current;
    if (el === null) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  const send = async (): Promise<void> => {
    const value = text.trim();
    if (value.length === 0 || props.disabled) return;
    setText("");
    setError(undefined);
    props.onSend();
    try {
      // No client-supplied `messageID` — confirmed hands-on that one breaks the
      // server's turn-completion tracking (see useSessionStream.ts's top comment).
      // Let the server assign every ID; role is read back off its own events.
      await client.session.promptAsync({
        path: { id: props.sessionID },
        body: {
          agent: AGENT,
          parts: [{ type: "text", text: value }],
        },
      });
    } catch {
      // Only `session.idle` normally clears the busy/disabled state — if the
      // request itself never reached the server, that event never arrives, so
      // the composer would otherwise stay stuck disabled with no way out.
      props.onSendFailed();
      setError("Message failed to send — is the OpenCode server running?");
    }
  };

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      {error !== undefined ? <div className="error-banner">{error}</div> : null}
      <div className="composer-field">
        <textarea
          ref={textareaRef}
          rows={1}
          value={text}
          disabled={props.disabled}
          placeholder="Ask about the codebase, or ask it to make a change…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button
          type="submit"
          className="send-button"
          aria-label="Send"
          disabled={props.disabled || text.trim().length === 0}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              d="M12 19V5M12 5l-6 6M12 5l6 6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </form>
  );
};
