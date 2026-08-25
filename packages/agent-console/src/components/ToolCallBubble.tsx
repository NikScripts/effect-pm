/**
 * Renders one tool call inline in the transcript — read/edit/write/glob/grep/etc.
 * `ToolPart.input`/`.output` are loosely typed (`Record<string, unknown>` / plain
 * string) by the SDK, so this reads defensively rather than assuming a schema.
 *
 * Every call is a native `<details>` disclosure (tap the header to toggle) —
 * edits/writes/patches start open (that's the actual content worth reading, the
 * diff), everything else starts collapsed once its output passes a line count
 * (mainly `read`, which otherwise dumps a whole file into the transcript).
 *
 * @internal
 */
import * as React from "react";
import type { ToolPart } from "@opencode-ai/sdk";
import { useDebouncedHighlight } from "./useDebouncedHighlight";

const EDIT_FAMILY = new Set(["edit", "write", "patch"]);
const COLLAPSE_LINE_THRESHOLD = 12;

const filePathOf = (input: Record<string, unknown>): string | undefined => {
  for (const key of ["filePath", "file_path", "path"]) {
    const value = input[key];
    if (typeof value === "string") return value;
  }
  return undefined;
};

const langFromPath = (path: string | undefined): string => {
  const ext = path?.split(".").pop();
  return ext ?? "text";
};

const HighlightedOutput = (props: {
  readonly text: string;
  readonly lang: string;
}): React.ReactElement => {
  const html = useDebouncedHighlight(props.text, props.lang);

  if (html === undefined) {
    return <pre className="tool-output">{props.text}</pre>;
  }
  // shiki output is escaped token spans, not raw source, so this is the standard safe pattern.
  return <div className="code-block" dangerouslySetInnerHTML={{ __html: html }} />;
};

const ToolCallBubbleImpl = (props: {
  readonly part: ToolPart;
}): React.ReactElement => {
  const { part } = props;
  const path = filePathOf(part.state.input);
  const isEditFamily = EDIT_FAMILY.has(part.tool);
  const lineCount =
    part.state.status === "completed" ? part.state.output.split("\n").length : 0;
  const startOpen =
    part.state.status !== "completed" ||
    isEditFamily ||
    lineCount <= COLLAPSE_LINE_THRESHOLD;

  const body = (() => {
    switch (part.state.status) {
      case "pending":
        return null;
      case "running":
        return <div className="tool-status">running…</div>;
      case "completed":
        return (
          <HighlightedOutput
            text={part.state.output}
            lang={langFromPath(path)}
          />
        );
      case "error":
        return <pre className="tool-output tool-error">{part.state.error}</pre>;
    }
  })();

  return (
    <details className={`tool-call tool-${part.state.status}`} open={startOpen}>
      <summary className="tool-header">
        <span className="tool-name">{part.tool}</span>
        {path !== undefined ? <span className="tool-path">{path}</span> : null}
        {part.state.status === "completed" && !isEditFamily ? (
          <span className="tool-meta">{lineCount} lines</span>
        ) : null}
      </summary>
      {body}
    </details>
  );
};
ToolCallBubbleImpl.displayName = "ToolCallBubble";

export const ToolCallBubble = React.memo(ToolCallBubbleImpl);
