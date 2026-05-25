import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseWorktreePorcelain,
  findWorktreeByBranch,
  getMainWorktree,
  gitExec,
  getWorktreeList,
} from "../git.js";
import { expandTilde } from "../validation.js";
import { validateBranchName } from "../validation.js";
import { createMockAPI } from "./helpers/mocks.js";
import type { WorktreeInfo } from "../types.js";

// ---------------------------------------------------------------------------
// parseWorktreePorcelain
// ---------------------------------------------------------------------------
describe("parseWorktreePorcelain", () => {
  it("parses valid porcelain output with 2 worktrees (main + linked)", () => {
    const output = [
      "worktree /home/user/project",
      "HEAD abc123def456",
      "branch refs/heads/main",
      "",
      "worktree /home/user/project/.git/worktrees/feature",
      "HEAD def789abc012",
      "branch refs/heads/feature",
    ].join("\n");

    const result = parseWorktreePorcelain(output);

    expect(result).toHaveLength(2);

    expect(result[0]!).toEqual({
      path: "/home/user/project",
      head: "abc123def456",
      branch: "refs/heads/main",
      branchName: "main",
    });

    expect(result[1]!).toEqual({
      path: "/home/user/project/.git/worktrees/feature",
      head: "def789abc012",
      branch: "refs/heads/feature",
      branchName: "feature",
    });
  });

  it("parses single worktree (main only)", () => {
    const output = [
      "worktree /home/user/project",
      "HEAD abc123def456",
      "branch refs/heads/main",
    ].join("\n");

    const result = parseWorktreePorcelain(output);

    expect(result).toHaveLength(1);
    expect(result[0]!).toEqual({
      path: "/home/user/project",
      head: "abc123def456",
      branch: "refs/heads/main",
      branchName: "main",
    });
  });

  it("handles detached HEAD (no branch line)", () => {
    const output = ["worktree /home/user/project", "HEAD abc123def456", "detached"].join("\n");

    const result = parseWorktreePorcelain(output);

    expect(result).toHaveLength(1);
    expect(result[0]!.branchName).toBe("detached");
    expect(result[0]!.branch).toBe("detached");
  });

  it("handles empty output → empty array", () => {
    expect(parseWorktreePorcelain("")).toEqual([]);
    expect(parseWorktreePorcelain("   ")).toEqual([]);
  });

  it("handles output with trailing newline", () => {
    const output = [
      "worktree /home/user/project",
      "HEAD abc123",
      "branch refs/heads/main",
      "",
    ].join("\n");

    const result = parseWorktreePorcelain(output);
    expect(result).toHaveLength(1);
    expect(result[0]!.branchName).toBe("main");
  });
});

// ---------------------------------------------------------------------------
// findWorktreeByBranch
// ---------------------------------------------------------------------------
describe("findWorktreeByBranch", () => {
  const worktrees: WorktreeInfo[] = [
    { path: "/repo", head: "aaa", branch: "refs/heads/main", branchName: "main" },
    {
      path: "/repo/.git/worktrees/feat",
      head: "bbb",
      branch: "refs/heads/feature",
      branchName: "feature",
    },
  ];

  it("found → returns worktree", () => {
    const result = findWorktreeByBranch(worktrees, "feature");
    expect(result).toBe(worktrees[1]);
  });

  it("not found → returns undefined", () => {
    const result = findWorktreeByBranch(worktrees, "nonexistent");
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getMainWorktree
// ---------------------------------------------------------------------------
describe("getMainWorktree", () => {
  it("returns first entry", () => {
    const worktrees: WorktreeInfo[] = [
      { path: "/repo", head: "aaa", branch: "refs/heads/main", branchName: "main" },
      {
        path: "/repo/.git/worktrees/feat",
        head: "bbb",
        branch: "refs/heads/feature",
        branchName: "feature",
      },
    ];
    expect(getMainWorktree(worktrees)).toBe(worktrees[0]);
  });

  it("empty array → returns undefined", () => {
    expect(getMainWorktree([])).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// validateBranchName
// ---------------------------------------------------------------------------
describe("validateBranchName", () => {
  it("valid names pass (returns null)", () => {
    expect(validateBranchName("feature")).toBeNull();
    expect(validateBranchName("my-feature")).toBeNull();
    expect(validateBranchName("fix/bug-123")).toBeNull();
    expect(validateBranchName("release_v2")).toBeNull();
  });

  it("fails: starts with '-'", () => {
    expect(validateBranchName("-bad")).toMatch(/cannot start with '-'/);
  });

  it("fails: contains '..'", () => {
    expect(validateBranchName("foo..bar")).toMatch(/invalid character/);
  });

  it("fails: contains '~'", () => {
    expect(validateBranchName("foo~bar")).toMatch(/invalid character/);
  });

  it("fails: is 'HEAD' (case-insensitive)", () => {
    expect(validateBranchName("HEAD")).toMatch(/cannot be 'HEAD'/);
  });

  it("fails: empty string", () => {
    expect(validateBranchName("")).toMatch(/cannot be empty/);
  });
});

// ---------------------------------------------------------------------------
// expandTilde
// ---------------------------------------------------------------------------
describe("expandTilde", () => {
  beforeEach(() => {
    vi.stubEnv("HOME", "/home/user");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("~ expands to HOME", () => {
    expect(expandTilde("~")).toBe("/home/user");
  });

  it("~/path expands", () => {
    expect(expandTilde("~/Documents")).toBe("/home/user/Documents");
  });

  it("non-tilde passthrough", () => {
    expect(expandTilde("/absolute/path")).toBe("/absolute/path");
    expect(expandTilde("relative/path")).toBe("relative/path");
  });

  it("returns input as-is when HOME is empty", () => {
    vi.stubEnv("HOME", "");
    expect(expandTilde("~/something")).toBe("~/something");
  });
});

// ---------------------------------------------------------------------------
// gitExec
// ---------------------------------------------------------------------------
describe("gitExec", () => {
  it("calls pi.exec with git and provided args", async () => {
    const { api, exec } = createMockAPI();
    const mockResult = { stdout: "output", stderr: "", code: 0, killed: false };
    exec.mockResolvedValue(mockResult);

    const result = await gitExec(api, ["status", "--porcelain"], "/repo");

    expect(exec).toHaveBeenCalledWith("git", ["status", "--porcelain"], { cwd: "/repo" });
    expect(result).toBe(mockResult);
  });
});

// ---------------------------------------------------------------------------
// getWorktreeList
// ---------------------------------------------------------------------------
describe("getWorktreeList", () => {
  it("returns parsed worktrees on success (code 0)", async () => {
    const { api, exec } = createMockAPI();
    const porcelainOutput = [
      "worktree /repo",
      "HEAD abc123",
      "branch refs/heads/main",
      "",
      "worktree /repo/.git/worktrees/feature",
      "HEAD def456",
      "branch refs/heads/feature",
    ].join("\n");
    exec.mockResolvedValue({ stdout: porcelainOutput, stderr: "", code: 0, killed: false });

    const result = await getWorktreeList(api, "/repo");

    expect(result).toHaveLength(2);
    expect(result[0]!.branchName).toBe("main");
    expect(result[1]!.branchName).toBe("feature");
  });

  it("returns empty array when git command fails (non-zero code)", async () => {
    const { api, exec } = createMockAPI();
    exec.mockResolvedValue({
      stdout: "",
      stderr: "fatal: not a git repository",
      code: 128,
      killed: false,
    });

    const result = await getWorktreeList(api, "/repo");

    expect(result).toEqual([]);
  });
});
