import { describe, expect, it, vi } from "vitest";

const listMock = vi.fn();
const readMock = vi.fn();

vi.mock("./client", () => ({
  client: { file: { list: (...args: Array<unknown>) => listMock(...args), read: (...args: Array<unknown>) => readMock(...args) } },
}));

const { scanRepos } = await import("./repoScan");

type Entry = { readonly name: string; readonly type: "file" | "directory" };

const dir = (name: string): Entry => ({ name, type: "directory" });
const file = (name: string): Entry => ({ name, type: "file" });

describe("scanRepos", () => {
  it("finds a repo whose main checkout has a `.git` directory with no linked worktrees", async () => {
    listMock.mockImplementation(({ query }: { query: { directory: string; path: string } }) => {
      if (query.directory === "/root" && query.path === ".") return { data: [dir("solo")] };
      if (query.directory === "/root" && query.path === "solo") return { data: [file("README.md"), dir(".git")] };
      if (query.directory === "/root/solo" && query.path === ".git/worktrees") return Promise.reject(new Error("ENOENT"));
      return { data: [] };
    });

    const repos = await scanRepos("/root");

    expect(repos).toEqual([{ repo: "solo", worktrees: [{ name: "(main)", path: "/root/solo", isMain: true }] }]);
  });

  it("resolves a linked worktree's `.git` FILE back to its main checkout, not the folder it's found in", async () => {
    listMock.mockImplementation(({ query }: { query: { directory: string; path: string } }) => {
      if (query.directory === "/root" && query.path === ".") return { data: [dir("main-checkout"), dir("elsewhere")] };
      if (query.directory === "/root" && query.path === "main-checkout") return { data: [dir(".git")] };
      if (query.directory === "/root" && query.path === "elsewhere") return { data: [file(".git")] };
      if (query.directory === "/root/main-checkout" && query.path === ".git/worktrees") {
        return { data: [dir("feature-x")] };
      }
      return { data: [] };
    });
    readMock.mockImplementation(({ query }: { query: { directory: string; path: string } }) => {
      if (query.directory === "/root/elsewhere" && query.path === ".git") {
        return { data: { type: "text", content: "gitdir: /root/main-checkout/.git/worktrees/feature-x\n" } };
      }
      if (query.directory === "/root/main-checkout" && query.path === ".git/worktrees/feature-x/gitdir") {
        return { data: { type: "text", content: "/root/elsewhere/.git\n" } };
      }
      return { data: undefined };
    });

    const repos = await scanRepos("/root");

    expect(repos).toEqual([
      {
        repo: "main-checkout",
        worktrees: [
          { name: "(main)", path: "/root/main-checkout", isMain: true },
          { name: "feature-x", path: "/root/elsewhere", isMain: false },
        ],
      },
    ]);
  });

  it("finds a checkout when `rootDir` itself is a linked worktree, not just its children", async () => {
    listMock.mockImplementation(({ query }: { query: { directory: string; path: string } }) => {
      if (query.directory === "/root/epsilon" && query.path === ".") return { data: [file(".git")] };
      if (query.directory === "/root/main-checkout" && query.path === ".git/worktrees") {
        return { data: [dir("epsilon")] };
      }
      return { data: [] };
    });
    readMock.mockImplementation(({ query }: { query: { directory: string; path: string } }) => {
      if (query.directory === "/root/epsilon" && query.path === ".git") {
        return { data: { type: "text", content: "gitdir: /root/main-checkout/.git/worktrees/epsilon\n" } };
      }
      if (query.directory === "/root/main-checkout" && query.path === ".git/worktrees/epsilon/gitdir") {
        return { data: { type: "text", content: "/root/epsilon/.git\n" } };
      }
      return { data: undefined };
    });

    const repos = await scanRepos("/root/epsilon");

    expect(repos).toEqual([
      {
        repo: "main-checkout",
        worktrees: [
          { name: "(main)", path: "/root/main-checkout", isMain: true },
          { name: "epsilon", path: "/root/epsilon", isMain: false },
        ],
      },
    ]);
  });

  it("doesn't mistake a submodule nested under a worktree's gitdir for the worktree entry itself", async () => {
    // A submodule checked out inside a linked worktree has a `.git` FILE whose
    // content is a *relative*, further-nested path like
    // `../../main/.git/worktrees/epsilon/modules/repos/effect` — it contains
    // the same `/.git/worktrees/` marker a real worktree pointer has, but
    // isn't one.
    listMock.mockImplementation(({ query }: { query: { directory: string; path: string } }) => {
      if (query.directory === "/root" && query.path === ".") return { data: [dir("epsilon")] };
      if (query.directory === "/root" && query.path === "epsilon") return { data: [dir(".git")] };
      if (query.directory === "/root/epsilon" && query.path === ".git/worktrees") return Promise.reject(new Error("ENOENT"));
      return { data: [] };
    });

    const repos = await scanRepos("/root");

    expect(repos).toEqual([{ repo: "epsilon", worktrees: [{ name: "(main)", path: "/root/epsilon", isMain: true }] }]);
  });

  it("rejects a relative gitdir pointer outright, even without the nested-submodule shape", async () => {
    listMock.mockImplementation(({ query }: { query: { directory: string; path: string } }) => {
      if (query.directory === "/root" && query.path === ".") return { data: [dir("odd")] };
      if (query.directory === "/root" && query.path === "odd") return { data: [file(".git")] };
      return { data: [] };
    });
    readMock.mockImplementation(({ query }: { query: { directory: string; path: string } }) => {
      if (query.directory === "/root/odd" && query.path === ".git") {
        return { data: { type: "text", content: "gitdir: ../main/.git/worktrees/odd\n" } };
      }
      return { data: undefined };
    });

    const repos = await scanRepos("/root");

    expect(repos).toEqual([]);
  });

  it("looks two levels deep for a `.git` entry", async () => {
    listMock.mockImplementation(({ query }: { query: { directory: string; path: string } }) => {
      if (query.directory === "/root" && query.path === ".") return { data: [dir("packages")] };
      if (query.directory === "/root" && query.path === "packages") return { data: [dir("nested-repo")] };
      if (query.directory === "/root" && query.path === "packages/nested-repo") return { data: [dir(".git")] };
      if (query.directory === "/root/packages/nested-repo" && query.path === ".git/worktrees") {
        return Promise.reject(new Error("ENOENT"));
      }
      return { data: [] };
    });

    const repos = await scanRepos("/root");

    expect(repos).toEqual([{ repo: "nested-repo", worktrees: [{ name: "(main)", path: "/root/packages/nested-repo", isMain: true }] }]);
  });
});
