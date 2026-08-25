import { describe, expect, it, vi } from "vitest";

// The vitest environment here is "node" (no DOM) — repoScanCache.ts/settings.ts
// use `localStorage` directly, same as they do in the real browser, so give
// this test run a minimal in-memory stand-in rather than pulling in jsdom.
const memoryStore = new Map<string, string>();
globalThis.localStorage = {
  getItem: (key) => memoryStore.get(key) ?? null,
  setItem: (key, value) => void memoryStore.set(key, value),
  removeItem: (key) => void memoryStore.delete(key),
  clear: () => memoryStore.clear(),
  key: (index) => Array.from(memoryStore.keys())[index] ?? null,
  get length() {
    return memoryStore.size;
  },
} satisfies Storage;

const scanReposMock = vi.fn();
vi.mock("./repoScan", () => ({ scanRepos: (...args: Array<unknown>) => scanReposMock(...args) }));

const { getCachedRepos, rescan } = await import("./repoScanCache");

const repo = { repo: "effect-pm", worktrees: [{ name: "(main)", path: "/root/effect-pm", isMain: true }] };

// Order matters here: getCachedRepos()'s in-memory cache is module state, set
// only once a scan actually runs — so the "ignores an old-version cache"
// case has to run first, before anything else in this file ever populates
// it, to exercise a genuinely cold read from localStorage.
describe("repoScanCache", () => {
  it("treats a persisted cache from an older scan-version as absent", () => {
    localStorage.setItem("agent-console:repoScan", JSON.stringify({ version: 1, repos: [repo] }));

    expect(getCachedRepos()).toBeUndefined();
  });

  it("round-trips a current-version cache through getCachedRepos after rescan", async () => {
    scanReposMock.mockResolvedValue([repo]);

    const fresh = await rescan("/root");
    expect(fresh).toEqual([repo]);
    expect(getCachedRepos()).toEqual([repo]);

    const stored = JSON.parse(localStorage.getItem("agent-console:repoScan") ?? "{}") as { version: number };
    expect(stored.version).toBe(3);
  });
});
