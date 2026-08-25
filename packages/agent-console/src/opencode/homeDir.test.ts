import { beforeEach, describe, expect, it, vi } from "vitest";

const createMock = vi.fn();
const shellMock = vi.fn();

vi.mock("./client", () => ({
  client: { session: { create: (...args: Array<unknown>) => createMock(...args), shell: (...args: Array<unknown>) => shellMock(...args) } },
}));

const { expandHome } = await import("./homeDir");

const toolPart = (output: string) => ({ type: "tool", state: { status: "completed", output } });

describe("expandHome", () => {
  beforeEach(() => {
    createMock.mockReset();
    shellMock.mockReset();
  });

  it("leaves an absolute path untouched, without ever calling the shell", async () => {
    const result = await expandHome("/Users/nikolasstow/Coding");

    expect(result).toBe("/Users/nikolasstow/Coding");
    expect(createMock).not.toHaveBeenCalled();
  });

  // Order matters: $HOME resolution is cached at module scope for the
  // page's lifetime, so the "can't resolve" case has to run first, before
  // anything else in this file ever populates that cache.
  it("leaves the path unchanged if $HOME can't be resolved, rather than dropping it", async () => {
    createMock.mockResolvedValue({ data: undefined });

    const result = await expandHome("~/Coding");

    expect(result).toBe("~/Coding");
  });

  it("expands a `~/`-prefixed path against the server's real $HOME", async () => {
    createMock.mockResolvedValue({ data: { id: "ses_1" } });
    shellMock.mockResolvedValue({ data: { info: {}, parts: [toolPart("/Users/nikolasstow\n")] } });

    const result = await expandHome("~/Coding");

    expect(result).toBe("/Users/nikolasstow/Coding");
  });
});
