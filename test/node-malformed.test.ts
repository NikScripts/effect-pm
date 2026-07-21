import { expect, it } from "vitest";
import * as Node from "../src/Node";

it("Node.Tag with an empty key throws MalformedNode (loud at declaration)", () => {
  expect(() => Node.Tag<never>()("")).toThrow(Node.MalformedNode);
});

it("a well-formed node builds fine", () => {
  class Ok extends Node.Tag<Ok>()("mal/ok", { http: "http://h/rpc" }) {}
  expect(Ok.key).toBe("mal/ok");
});
