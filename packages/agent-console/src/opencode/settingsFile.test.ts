import { describe, expect, it, vi } from "vitest";

const createMock = vi.fn();
const shellMock = vi.fn();
const readMock = vi.fn();

vi.mock("./client", () => ({
  client: {
    session: { create: (...args: Array<unknown>) => createMock(...args), shell: (...args: Array<unknown>) => shellMock(...args) },
    file: { read: (...args: Array<unknown>) => readMock(...args) },
  },
}));

const toolPart = (output: string) => ({ type: "tool", state: { status: "completed", output } });

describe("settingsFile", () => {
  it("writes the settings file via a fixed-prefix shell command scoped to $HOME", async () => {
    createMock.mockResolvedValue({ data: { id: "ses_1" } });
    shellMock.mockResolvedValue({ data: { info: {}, parts: [toolPart("")] } });
    // $HOME resolution (homeDir.ts) shares the same mocked session.create/shell.
    createMock.mockResolvedValueOnce({ data: { id: "ses_home" } }).mockResolvedValueOnce({ data: { id: "ses_write" } });
    shellMock
      .mockResolvedValueOnce({ data: { info: {}, parts: [toolPart("/Users/nikolasstow\n")] } })
      .mockResolvedValueOnce({ data: { info: {}, parts: [toolPart("")] } });

    const { writeSettingsFile } = await import("./settingsFile");
    await writeSettingsFile({ rootDir: "/Users/nikolasstow/Coding", worktreeTemplate: "{root}/{repo}/worktrees/{name}" });

    const writeCall = shellMock.mock.calls[1]?.[0] as { body: { command: string } };
    expect(writeCall.body.command).toContain('mkdir -p "$HOME/.config/agent-console"');
    expect(writeCall.body.command).toContain('base64 -d > "$HOME/.config/agent-console/settings.json"');
    // Single line — no literal newlines, the exact thing that broke the
    // original heredoc-based version.
    expect(writeCall.body.command).not.toContain("\n");

    const base64Match = writeCall.body.command.match(/printf '%s' '([^']+)'/);
    const decoded = Buffer.from(base64Match?.[1] ?? "", "base64").toString("utf-8");
    expect(JSON.parse(decoded)).toEqual({ rootDir: "/Users/nikolasstow/Coding", worktreeTemplate: "{root}/{repo}/worktrees/{name}" });
  });

  it("reads and parses a previously-written settings file", async () => {
    readMock.mockResolvedValue({
      data: { type: "text", content: '{"rootDir":"/Users/nikolasstow/Coding","worktreeTemplate":"{root}/{repo}/worktrees/{name}"}' },
    });

    const { readSettingsFile } = await import("./settingsFile");
    const result = await readSettingsFile();

    expect(result).toEqual({ rootDir: "/Users/nikolasstow/Coding", worktreeTemplate: "{root}/{repo}/worktrees/{name}" });
  });

  it("returns undefined for a malformed settings file rather than throwing", async () => {
    readMock.mockResolvedValue({ data: { type: "text", content: "not json" } });

    const { readSettingsFile } = await import("./settingsFile");
    const result = await readSettingsFile();

    expect(result).toBeUndefined();
  });
});
