import { expect, it } from "vitest";
import * as Node from "../src/Node";

// The merge folded integration's advertise `onConflict` policy through the multi-protocol
// construction path (assembleNode / ShorthandTarget / withProtocol) and unified the extraction into
// one helper. These pin the resulting behaviour so the two features stay orthogonal.

it("the { http, ws } shorthand carries an explicit onConflict alongside both endpoints", () => {
  class Dual extends Node.Tag<Dual>()("policy/dual", {
    http: "http://d/rpc",
    ws: "ws://d/rpc",
    onConflict: "reject",
  }) {}
  expect(Dual.onConflict).toBe("reject");
  expect(Dual.endpoints).toEqual({
    Http: { url: "http://d/rpc" },
    WebSocket: { url: "ws://d/rpc" },
  });
});

it("a shorthand node with no explicit policy defaults to inherit (ordinary node)", () => {
  class Plain extends Node.Tag<Plain>()("policy/plain", {
    http: "http://p/rpc",
    ws: "ws://p/rpc",
  }) {}
  expect(Plain.onConflict).toBe("inherit");
});

it("withProtocol keeps the base node's advertise policy on the derived same-identity handle", () => {
  class Base extends Node.Tag<Base>()("policy/base", {
    http: "http://b/rpc",
    onConflict: "askIncumbent",
  }) {}
  class Widened extends Base.pipe(Node.withProtocol({ ws: "ws://b/rpc" })) {}
  expect(Widened.onConflict).toBe("askIncumbent");
  // and the transport set widened
  expect(Widened.endpoints).toEqual({
    Http: { url: "http://b/rpc" },
    WebSocket: { url: "ws://b/rpc" },
  });
});

it("Lookup defaults to the concrete livenessReplace policy, never inherit", () => {
  class L extends Node.Tag<L>()("policy/lookup", { path: "/tmp/l.sock" }).pipe(Node.asLookup) {}
  expect(L.onConflict).toBe("livenessReplace");
  expect(Node.isLookupNode(L)).toBe(true);
});

it("Lookup honours an explicit resolved policy", () => {
  class L extends Node.Tag<L>()("policy/lookup-ask", {
    path: "/tmp/l.sock",
    onConflict: "askIncumbent",
  }).pipe(Node.asLookup) {}
  expect(L.onConflict).toBe("askIncumbent");
});

it("Lookup accepts the multi-protocol shorthand (uniform with Tag) and stays livenessReplace", () => {
  class L extends Node.Tag<L>()("policy/lookup-dual", {
    http: "http://l/rpc",
    ws: "ws://l/rpc",
  }).pipe(Node.asLookup) {}
  expect(L.endpoints).toEqual({
    Http: { url: "http://l/rpc" },
    WebSocket: { url: "ws://l/rpc" },
  });
  expect(L.onConflict).toBe("livenessReplace");
  expect(Node.isLookupNode(L)).toBe(true);
});
