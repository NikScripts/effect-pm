import { describe, expect, it } from "vitest";

describe("installSafeAreaResumeFix", () => {
  it("forces a reflow (display toggled off then back) only when the page becomes visible", async () => {
    const listeners: Array<() => void> = [];
    let visibilityState = "hidden";
    const displayValues: Array<string> = [];

    globalThis.document = {
      addEventListener: (event: string, handler: () => void) => {
        if (event === "visibilitychange") listeners.push(handler);
      },
      get visibilityState() {
        return visibilityState;
      },
      body: {
        style: {
          set display(value: string) {
            displayValues.push(value);
          },
        },
        get offsetHeight() {
          return 0;
        },
      },
    } as unknown as Document;

    const { installSafeAreaResumeFix } = await import("./safeAreaResumeFix");
    installSafeAreaResumeFix();

    visibilityState = "hidden";
    listeners.forEach((fn) => fn());
    expect(displayValues).toEqual([]);

    visibilityState = "visible";
    listeners.forEach((fn) => fn());
    expect(displayValues).toEqual(["none", ""]);
  });
});
