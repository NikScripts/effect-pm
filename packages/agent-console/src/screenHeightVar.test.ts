import { describe, expect, it } from "vitest";

describe("installScreenHeightVar", () => {
  it("sets --screen-height from window.screen.height, and keeps it updated on resize", async () => {
    const setProperties: Array<string> = [];
    const listeners: Record<string, Array<() => void>> = {};

    globalThis.document = {
      documentElement: {
        style: {
          setProperty: (_name: string, value: string) => setProperties.push(value),
        },
      },
    } as unknown as Document;

    let screenHeight = 932;
    globalThis.window = {
      screen: {
        get height() {
          return screenHeight;
        },
      },
      addEventListener: (event: string, handler: () => void) => {
        (listeners[event] ??= []).push(handler);
      },
    } as unknown as Window & typeof globalThis;

    const { installScreenHeightVar } = await import("./screenHeightVar");
    installScreenHeightVar();

    expect(setProperties).toEqual(["932px"]);

    screenHeight = 852;
    listeners.resize?.forEach((fn) => fn());
    expect(setProperties).toEqual(["932px", "852px"]);
  });
});
