import { describe, expect, it } from "vitest";
import type { Session } from "@opencode-ai/sdk";
import { groupByRepo, matchSession, NO_WORKTREE } from "./repoGrouping";
import type { ScannedRepo } from "./repoScan";

const session = (id: string, directory: string, updated: number): Session =>
  ({
    id,
    projectID: "proj",
    directory,
    title: id,
    version: "1",
    time: { created: updated, updated },
  }) as Session;

const ROOT = "/Users/nik/Coding";

const scan = (...repos: ReadonlyArray<ScannedRepo>): ReadonlyArray<ScannedRepo> => repos;

describe("matchSession", () => {
  it("matches a session directory against a scanned worktree's real path", () => {
    const scanned = scan({
      repo: "Hyperlink",
      worktrees: [
        { name: "(main)", path: `${ROOT}/Hyperlink`, isMain: true },
        { name: "epsilon", path: `${ROOT}/Hyperlink/worktrees/epsilon`, isMain: false },
      ],
    });
    expect(matchSession(`${ROOT}/Hyperlink/worktrees/epsilon`, scanned)).toEqual({
      repo: "Hyperlink",
      worktree: "epsilon",
    });
  });

  it("matches a nested path under the worktree", () => {
    const scanned = scan({
      repo: "Hyperlink",
      worktrees: [{ name: "epsilon", path: `${ROOT}/Hyperlink/worktrees/epsilon`, isMain: false }],
    });
    expect(matchSession(`${ROOT}/Hyperlink/worktrees/epsilon/packages/agent-console`, scanned)).toEqual({
      repo: "Hyperlink",
      worktree: "epsilon",
    });
  });

  it("prefers the longest (most specific) matching worktree path", () => {
    const scanned = scan({
      repo: "Hyperlink",
      worktrees: [
        { name: "(main)", path: ROOT, isMain: true },
        { name: "epsilon", path: `${ROOT}/Hyperlink/worktrees/epsilon`, isMain: false },
      ],
    });
    expect(matchSession(`${ROOT}/Hyperlink/worktrees/epsilon`, scanned).worktree).toBe("epsilon");
  });

  it("falls back to the directory's own basename when no scanned worktree matches", () => {
    expect(matchSession("/somewhere/else/project", [])).toEqual({
      repo: "project",
      worktree: NO_WORKTREE,
    });
  });
});

describe("groupByRepo", () => {
  it("groups sessions by repo and worktree, sorted by most recent activity", () => {
    const scanned = scan(
      {
        repo: "Hyperlink",
        worktrees: [
          { name: "epsilon", path: `${ROOT}/Hyperlink/worktrees/epsilon`, isMain: false },
          { name: "delta", path: `${ROOT}/Hyperlink/worktrees/delta`, isMain: false },
        ],
      },
      { repo: "wow-sports", worktrees: [{ name: "(main)", path: `${ROOT}/wow-sports`, isMain: true }] },
    );
    const sessions = [
      session("a", `${ROOT}/Hyperlink/worktrees/epsilon`, 100),
      session("b", `${ROOT}/Hyperlink/worktrees/delta`, 200),
      session("c", `${ROOT}/wow-sports`, 300),
    ];

    const groups = groupByRepo(sessions, scanned);

    expect(groups.map((g) => g.repo)).toEqual(["wow-sports", "Hyperlink"]);
    const hyperlink = groups.find((g) => g.repo === "Hyperlink")!;
    expect(hyperlink.sessions.map((s) => s.id)).toEqual(["b", "a"]);
    expect([...hyperlink.worktrees.keys()].sort()).toEqual(["delta", "epsilon"]);
  });

  it("marks a fallback bucket (no git identity at all) as not a known repo", () => {
    const scanned = scan({
      repo: "Hyperlink",
      worktrees: [{ name: "(main)", path: `${ROOT}/Hyperlink`, isMain: true }],
    });
    const sessions = [
      session("a", `${ROOT}/Hyperlink`, 100),
      session("b", `${ROOT}/plain-folder-no-git`, 200),
    ];

    const groups = groupByRepo(sessions, scanned);

    expect(groups.find((g) => g.repo === "Hyperlink")?.isKnownRepo).toBe(true);
    expect(groups.find((g) => g.repo === "plain-folder-no-git")?.isKnownRepo).toBe(false);
  });
});
