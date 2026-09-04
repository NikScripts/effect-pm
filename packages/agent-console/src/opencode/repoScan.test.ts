import { describe, expect, it, vi } from "vitest";

const listMock = vi.fn();
const readMock = vi.fn();

vi.mock("./client", () => ({
  client: { file: { list: (...args: Array<unknown>) => listMock(...args), read: (...args: Array<unknown>) => readMock(...args) } },
}));

const { RepoScanError, scanRepos } = await import("./repoScan");

type Entry = { readonly name: string; readonly type: "file" | "directory" };

const dir = (name: string): Entry => ({ name, type: "directory" });
const file = (name: string): Entry => ({ name, type: "file" });

describe("scanRepos", () => {
  it("throws instead of silently returning an empty scan when rootDir itself can't be listed", async () => {
    // Reproduces a real, confirmed failure: a literal `~/Coding` root dir
    // (the file API doesn't shell-expand `~`) 500s. Before this was fixed,
    // that error was swallowed and scanRepos just returned `[]` —
    // indistinguishable from "scanned fine, no repos here".
    listMock.mockImplementation(() => Promise.reject(new Error("500 UnknownError")));

    await expect(scanRepos("~/Coding")).rejects.toThrow(RepoScanError);
  });

  it("throws even when the SDK resolves an HTTP error instead of rejecting", async () => {
    // The real shape, confirmed hands-on: the generated SDK client does NOT
    // throw on a non-2xx response by default (throwOnError defaults to
    // false) — it resolves normally with `data: undefined, error: {...}`.
    // A version of this fix that only wrapped `list()` in try/catch missed
    // this entirely: no exception was ever thrown, so `data ?? []` silently
    // produced an empty (not failed) scan for a genuinely unreachable root.
    listMock.mockResolvedValue({
      data: undefined,
      error: { name: "UnknownError", data: { message: "Unexpected server error. Check server logs for details." } },
    });

    await expect(scanRepos("/nope")).rejects.toThrow(RepoScanError);
  });

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

  it("names the repo from its origin remote, not the main checkout folder's (possibly stale) name", async () => {
    // Ground truth this reproduces: this repo's main checkout folder is
    // still named `effect-pm` — a pre-rename leftover — but its origin
    // remote is github.com/nikolasstow/Hyperlink. The folder name is not
    // the repo's identity; the remote is.
    listMock.mockImplementation(({ query }: { query: { directory: string; path: string } }) => {
      if (query.directory === "/root" && query.path === ".") return { data: [dir("effect-pm")] };
      if (query.directory === "/root" && query.path === "effect-pm") return { data: [dir(".git")] };
      if (query.directory === "/root/effect-pm" && query.path === ".git/worktrees") return Promise.reject(new Error("ENOENT"));
      return { data: [] };
    });
    readMock.mockImplementation(({ query }: { query: { directory: string; path: string } }) => {
      if (query.directory === "/root/effect-pm" && query.path === ".git/config") {
        return {
          data: {
            type: "text",
            content:
              '[remote "origin"]\n\turl = https://github.com/nikolasstow/Hyperlink.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n[branch "main"]\n\tremote = origin\n',
          },
        };
      }
      return { data: undefined };
    });

    const repos = await scanRepos("/root");

    expect(repos).toEqual([{ repo: "Hyperlink", worktrees: [{ name: "(main)", path: "/root/effect-pm", isMain: true }] }]);
  });

  it("falls back to the folder name when a repo has no origin remote configured", async () => {
    listMock.mockImplementation(({ query }: { query: { directory: string; path: string } }) => {
      if (query.directory === "/root" && query.path === ".") return { data: [dir("local-only")] };
      if (query.directory === "/root" && query.path === "local-only") return { data: [dir(".git")] };
      if (query.directory === "/root/local-only" && query.path === ".git/worktrees") return Promise.reject(new Error("ENOENT"));
      return { data: [] };
    });
    readMock.mockImplementation(({ query }: { query: { directory: string; path: string } }) => {
      if (query.directory === "/root/local-only" && query.path === ".git/config") {
        return { data: { type: "text", content: '[core]\n\trepositoryformatversion = 0\n' } };
      }
      return { data: undefined };
    });

    const repos = await scanRepos("/root");

    expect(repos).toEqual([{ repo: "local-only", worktrees: [{ name: "(main)", path: "/root/local-only", isMain: true }] }]);
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
