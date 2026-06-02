import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import {
  OpenTerminalSessionSchema,
  TerminalEventSchema,
  TerminalRpcGroup,
} from "../src";

describe("TerminalRpc", () => {
  it.live("decodes the open-session payload schema", () =>
    Effect.gen(function* () {
      const input = yield* Schema.decodeUnknownEffect(OpenTerminalSessionSchema)({
        groupId: "@test/Terminal",
        target: "shell",
        command: ["bash"],
        cols: 120,
        rows: 36,
        metadata: {
          actor: "nik",
          source: "dashboard",
        },
      });

      expect(input).toMatchObject({
        groupId: "@test/Terminal",
        target: "shell",
        command: ["bash"],
        cols: 120,
        rows: 36,
      });
    }),
  );

  it.live("decodes terminal output events", () =>
    Effect.gen(function* () {
      const event = yield* Schema.decodeUnknownEffect(TerminalEventSchema)({
        _tag: "Output",
        sessionId: "terminal-1",
        chunk: new Uint8Array([111, 107]),
      });

      expect(event).toEqual({
        _tag: "Output",
        sessionId: "terminal-1",
        chunk: new Uint8Array([111, 107]),
      });
    }),
  );

  it("declares the expected terminal RPC procedures", () => {
    expect([...TerminalRpcGroup.requests.keys()].sort()).toEqual([
      "Terminal.Close",
      "Terminal.Events",
      "Terminal.Input",
      "Terminal.Open",
      "Terminal.Resize",
    ]);
  });
});
