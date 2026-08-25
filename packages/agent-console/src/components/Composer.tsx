import * as React from "react";
import { AGENT, client } from "../opencode/client";

export const Composer = (props: {
  readonly sessionID: string;
  readonly disabled: boolean;
  readonly onSend: () => void;
}): React.ReactElement => {
  const [text, setText] = React.useState("");

  const send = async (): Promise<void> => {
    const value = text.trim();
    if (value.length === 0 || props.disabled) return;
    setText("");
    props.onSend();
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
  };

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <textarea
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
      <button type="submit" disabled={props.disabled || text.trim().length === 0}>
        Send
      </button>
    </form>
  );
};
