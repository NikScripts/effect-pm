import { expect, it } from "vitest";
import * as Node from "../src/Node";

// same key, one more transport — the derived handle merges the endpoints.
class Droplet extends Node.Tag<Droplet>()("wp/rt/droplet", { http: "http://d:7/rpc" }) {}
class DropletWs extends Droplet.pipe(Node.withProtocol({ ws: "ws://d:7/rpc" })) {}

it("withProtocol keeps the key and merges the transport set", () => {
  expect(DropletWs.key).toBe("wp/rt/droplet"); // SAME identity
  expect(DropletWs.endpoints).toEqual({
    Http: { url: "http://d:7/rpc" },
    WebSocket: { url: "ws://d:7/rpc" },
  });
  // base is unchanged (one endpoint)
  expect(Droplet.endpoints).toEqual({ Http: { url: "http://d:7/rpc" } });
});
