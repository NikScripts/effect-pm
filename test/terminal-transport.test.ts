import { describe, it } from "@effect/vitest";
import { terminalTransport, TerminalRpcGroup } from "../src/terminalTransport";

describe("terminalTransport", () => {
  it("exports rpc and serverLayer", () => {
    const api = terminalTransport;
    if (api.rpc !== TerminalRpcGroup) throw new Error("rpc mismatch");
    if (typeof api.serverLayer !== "function") throw new Error("serverLayer missing");
  });

  it("serverLayer returns a Layer", () => {
    const layer = terminalTransport.serverLayer();
    if (typeof layer !== "object") throw new Error("serverLayer did not return a Layer");
  });

  it("rpc group is defined", () => {
    if (typeof TerminalRpcGroup !== "object" && typeof TerminalRpcGroup !== "function") {
      throw new Error("TerminalRpcGroup not defined");
    }
  });
});
