import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Hoisted mocks (must be available at import time) ────────────────
const { gitExec, getWorktreeList, getMainWorktree } = vi.hoisted(() => ({
  gitExec: vi.fn(),
  getWorktreeList: vi.fn(),
  getMainWorktree: vi.fn(),
}));

const {
  getMainRepoPath,
  getCurrentBranch,
  setCurrentWorktreePath,
  getDefaultBranch,
  setMainRepoPath,
} = vi.hoisted(() => ({
  getMainRepoPath: vi.fn(),
  getCurrentBranch: vi.fn(),
  setCurrentWorktreePath: vi.fn(),
  getDefaultBranch: vi.fn(),
  setMainRepoPath: vi.fn(),
}));

const { readFileSync } = vi.hoisted(() => ({
  readFileSync: vi.fn(),
}));

const { spawnSync } = vi.hoisted(() => ({
  spawnSync: vi.fn(),
}));

// ── Module mocks ────────────────────────────────────────────────────
vi.mock("../git.js", () => ({
  gitExec,
  getWorktreeList,
  getMainWorktree,
}));

vi.mock("../state.js", () => ({
  getMainRepoPath,
  getCurrentBranch,
  setCurrentWorktreePath,
  getDefaultBranch,
  setMainRepoPath,
}));

vi.mock("node:fs", () => ({
  readFileSync,
}));

vi.mock("node:child_process", () => ({
  spawnSync,
}));

// ── Imports (after mocks registered) ────────────────────────────────
import {
  resolveBaseDir,
  switchCwd,
  detectMainRepo,
  hasUncommittedChanges,
  detectDefaultBranch,
  ensureMainRepo,
  autoCommitWithAIMessage,
} from "../worktree.js";
import { WORKTREE_CHANGE_TYPE } from "../types.js";
import { createMockAPI, createMockContext } from "./helpers/mocks.js";
import { MAIN_REPO, MAIN_BRANCH, FEATURE_BRANCH, FEATURE_PATH } from "./helpers/fixtures.js";

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Helper: create mock API with sendUserMessage
function createFullMockAPI() {
  const result = createMockAPI();
  (result.api as unknown as Record<string, unknown>).sendUserMessage = result.sendMessage;
  return result;
}

// ============================================================================
// resolveBaseDir
// ============================================================================
describe("resolveBaseDir", () => {
  it("returns default base dir when settings file doesn't exist", () => {
    readFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    const result = resolveBaseDir("/repo");
    expect(result).toBe("/repo/.git/worktrees/");
  });

  it("returns custom base dir from settings", () => {
    readFileSync.mockReturnValue(JSON.stringify({ worktrees: { baseDir: "/custom/path" } }));

    const result = resolveBaseDir("/repo");
    expect(result).toBe("/custom/path/");
  });

  it("returns default when settings JSON is invalid", () => {
    readFileSync.mockReturnValue("not json");

    const result = resolveBaseDir("/repo");
    expect(result).toBe("/repo/.git/worktrees/");
  });

  it("returns default when worktrees.baseDir is empty string", () => {
    readFileSync.mockReturnValue(JSON.stringify({ worktrees: { baseDir: "" } }));

    const result = resolveBaseDir("/repo");
    expect(result).toBe("/repo/.git/worktrees/");
  });

  it("resolves relative path against mainRepoPath", () => {
    readFileSync.mockReturnValue(JSON.stringify({ worktrees: { baseDir: "../worktrees/" } }));

    const result = resolveBaseDir("/repo");
    expect(result).toBe("/worktrees/");
  });

  it("adds trailing slash if missing", () => {
    readFileSync.mockReturnValue(JSON.stringify({ worktrees: { baseDir: "/absolute/path" } }));

    const result = resolveBaseDir("/repo");
    expect(result).toBe("/absolute/path/");
  });
});

// ============================================================================
// switchCwd
// ============================================================================
describe("switchCwd", () => {
  it("sends /cwd command with target path", () => {
    const { api, sendMessage } = createFullMockAPI();
    const ctx = createMockContext();
    const targetPath = FEATURE_PATH;

    getMainRepoPath.mockReturnValue(MAIN_REPO);
    getCurrentBranch.mockReturnValue(FEATURE_BRANCH);
    getDefaultBranch.mockReturnValue(MAIN_BRANCH);

    switchCwd(api, ctx, targetPath);

    expect(sendMessage).toHaveBeenCalledWith("/cwd " + targetPath);
  });

  it("sets current worktree path", () => {
    const { api } = createFullMockAPI();
    const ctx = createMockContext();
    const targetPath = FEATURE_PATH;

    getMainRepoPath.mockReturnValue(MAIN_REPO);
    getCurrentBranch.mockReturnValue(FEATURE_BRANCH);
    getDefaultBranch.mockReturnValue(MAIN_BRANCH);

    switchCwd(api, ctx, targetPath);

    expect(setCurrentWorktreePath).toHaveBeenCalledWith(targetPath);
  });

  it("appends entry with all fields including defaultBranch", () => {
    const { api, appendEntry } = createFullMockAPI();
    const ctx = createMockContext();
    const targetPath = FEATURE_PATH;

    getMainRepoPath.mockReturnValue(MAIN_REPO);
    getCurrentBranch.mockReturnValue(FEATURE_BRANCH);
    getDefaultBranch.mockReturnValue(MAIN_BRANCH);

    switchCwd(api, ctx, targetPath);

    expect(appendEntry).toHaveBeenCalledWith(WORKTREE_CHANGE_TYPE, {
      mainRepoPath: MAIN_REPO,
      currentWorktreePath: targetPath,
      currentBranch: FEATURE_BRANCH,
      defaultBranch: MAIN_BRANCH,
    });
  });
});

// ============================================================================
// detectMainRepo
// ============================================================================
describe("detectMainRepo", () => {
  it("returns main worktree path when worktrees exist", async () => {
    const { api } = createMockAPI();
    const mainWt = {
      path: MAIN_REPO,
      head: "abc",
      branch: "refs/heads/main",
      branchName: MAIN_BRANCH,
    };

    getWorktreeList.mockResolvedValue([mainWt]);
    getMainWorktree.mockReturnValue(mainWt);

    const result = await detectMainRepo(api, MAIN_REPO);

    expect(result).toBe(MAIN_REPO);
    expect(getWorktreeList).toHaveBeenCalledWith(api, MAIN_REPO);
  });

  it("returns null when worktree list is empty", async () => {
    const { api } = createMockAPI();

    getWorktreeList.mockResolvedValue([]);
    getMainWorktree.mockReturnValue(undefined);

    const result = await detectMainRepo(api, "/repo");

    expect(result).toBeNull();
  });
});

// ============================================================================
// hasUncommittedChanges
// ============================================================================
describe("hasUncommittedChanges", () => {
  it("returns true when status has output", async () => {
    const { api } = createMockAPI();
    gitExec.mockResolvedValue({ stdout: "M file.txt\n", stderr: "", code: 0, killed: false });

    const result = await hasUncommittedChanges(api, "/repo");

    expect(result).toBe(true);
    expect(gitExec).toHaveBeenCalledWith(api, ["status", "--porcelain"], "/repo");
  });

  it("returns false when status is clean", async () => {
    const { api } = createMockAPI();
    gitExec.mockResolvedValue({ stdout: "", stderr: "", code: 0, killed: false });

    const result = await hasUncommittedChanges(api, "/repo");

    expect(result).toBe(false);
  });
});

// ============================================================================
// detectDefaultBranch
// ============================================================================
describe("detectDefaultBranch", () => {
  it("detects from symbolic-ref", async () => {
    const { api } = createMockAPI();
    gitExec.mockResolvedValue({
      stdout: "refs/remotes/origin/main\n",
      stderr: "",
      code: 0,
      killed: false,
    });

    const result = await detectDefaultBranch(api, "/repo");

    expect(result).toBe("main");
  });

  it("detects 'develop' as default", async () => {
    const { api } = createMockAPI();
    gitExec.mockResolvedValue({
      stdout: "refs/remotes/origin/develop\n",
      stderr: "",
      code: 0,
      killed: false,
    });

    const result = await detectDefaultBranch(api, "/repo");

    expect(result).toBe("develop");
  });

  it("falls back to main worktree branch", async () => {
    const { api } = createMockAPI();
    // symbolic-ref fails
    gitExec.mockResolvedValue({
      stdout: "",
      stderr: "fatal: not a git repository",
      code: 128,
      killed: false,
    });
    // worktree list returns master
    getWorktreeList.mockResolvedValue([
      { path: "/repo", head: "abc", branch: "refs/heads/master", branchName: "master" },
    ]);
    getMainWorktree.mockReturnValue({
      path: "/repo",
      head: "abc",
      branch: "refs/heads/master",
      branchName: "master",
    });

    const result = await detectDefaultBranch(api, "/repo");

    expect(result).toBe("master");
  });

  it("final fallback to 'main'", async () => {
    const { api } = createMockAPI();
    // symbolic-ref fails
    gitExec.mockResolvedValue({
      stdout: "",
      stderr: "error",
      code: 1,
      killed: false,
    });
    // No worktrees
    getWorktreeList.mockResolvedValue([]);
    getMainWorktree.mockReturnValue(undefined);

    const result = await detectDefaultBranch(api, "/repo");

    expect(result).toBe("main");
  });

  it("falls back to 'main' when main worktree has detached head", async () => {
    const { api } = createMockAPI();
    // symbolic-ref fails
    gitExec.mockResolvedValue({
      stdout: "",
      stderr: "error",
      code: 1,
      killed: false,
    });
    // Main worktree is detached
    getWorktreeList.mockResolvedValue([
      { path: "/repo", head: "abc", branch: "detached", branchName: "detached" },
    ]);
    getMainWorktree.mockReturnValue({
      path: "/repo",
      head: "abc",
      branch: "detached",
      branchName: "detached",
    });

    const result = await detectDefaultBranch(api, "/repo");

    expect(result).toBe("main");
  });
});

// ============================================================================
// ensureMainRepo
// ============================================================================
describe("ensureMainRepo", () => {
  it("returns true when mainRepoPath is already known", async () => {
    const { api } = createMockAPI();
    const ctx = createMockContext();

    getMainRepoPath.mockReturnValue("/repo");

    const result = await ensureMainRepo(api, ctx);

    expect(result).toBe(true);
    // Should NOT try to detect
    expect(getWorktreeList).not.toHaveBeenCalled();
  });

  it("detects and sets mainRepoPath when unknown", async () => {
    const { api } = createMockAPI();
    const ctx = createMockContext();

    // Initially unknown
    getMainRepoPath.mockReturnValue("");
    // detectMainRepo returns a path
    getWorktreeList.mockResolvedValue([
      { path: "/detected-repo", head: "abc", branch: "refs/heads/main", branchName: "main" },
    ]);
    getMainWorktree.mockReturnValue({
      path: "/detected-repo",
      head: "abc",
      branch: "refs/heads/main",
      branchName: "main",
    });

    const result = await ensureMainRepo(api, ctx);

    expect(result).toBe(true);
    expect(setMainRepoPath).toHaveBeenCalledWith("/detected-repo");
  });

  it("returns false when not in a git repo", async () => {
    const { api } = createMockAPI();
    const ctx = createMockContext();

    // Initially unknown
    getMainRepoPath.mockReturnValue("");
    // detectMainRepo returns null
    getWorktreeList.mockResolvedValue([]);
    getMainWorktree.mockReturnValue(undefined);

    const result = await ensureMainRepo(api, ctx);

    expect(result).toBe(false);
    expect(ctx.ui.notify).toHaveBeenCalledWith("Not inside a git repository", "error");
    expect(setMainRepoPath).not.toHaveBeenCalled();
  });
});

// ============================================================================
// autoCommitWithAIMessage
// ============================================================================
describe("autoCommitWithAIMessage", () => {
  it("returns EMPTY_DIFF_FALLBACK when nothing staged after add", async () => {
    const { api } = createMockAPI();

    // git add -A succeeds, diff --cached returns empty
    gitExec
      .mockResolvedValueOnce({ stdout: "", stderr: "", code: 0, killed: false }) // add -A
      .mockResolvedValueOnce({ stdout: "", stderr: "", code: 0, killed: false }); // diff --cached empty

    const result = await autoCommitWithAIMessage(api, "/repo");

    expect(result).toBe("chore: save work");
    // No commit attempted
    expect(gitExec).toHaveBeenCalledTimes(2);
  });

  it("uses AI commit message when pi succeeds", async () => {
    const { api } = createMockAPI();

    const diffContent = "diff --git a/file.txt b/file.txt\n+new line";
    const aiMessage = "feat: add new feature";

    gitExec
      .mockResolvedValueOnce({ stdout: "", stderr: "", code: 0, killed: false }) // add -A
      .mockResolvedValueOnce({ stdout: diffContent, stderr: "", code: 0, killed: false }) // diff --cached
      .mockResolvedValueOnce({ stdout: "", stderr: "", code: 0, killed: false }); // commit

    spawnSync.mockReturnValue({
      status: 0,
      stdout: aiMessage + "\n",
      stderr: "",
    });

    const result = await autoCommitWithAIMessage(api, "/repo/wt");

    expect(result).toBe(aiMessage);
    expect(spawnSync).toHaveBeenCalledWith(
      "pi",
      ["--print"],
      expect.objectContaining({
        input: expect.stringContaining("Generate a concise conventional-commit"),
        cwd: "/repo/wt",
        timeout: 30_000,
        encoding: "utf-8",
      }),
    );
    // Commit called with AI message
    expect(gitExec).toHaveBeenCalledWith(api, ["commit", "-m", aiMessage], "/repo/wt");
  });

  it("uses FALLBACK_COMMIT_MESSAGE when pi fails", async () => {
    const { api } = createMockAPI();

    const diffContent = "diff --git a/file.txt b/file.txt\n+new line";

    gitExec
      .mockResolvedValueOnce({ stdout: "", stderr: "", code: 0, killed: false }) // add -A
      .mockResolvedValueOnce({ stdout: diffContent, stderr: "", code: 0, killed: false }) // diff --cached
      .mockResolvedValueOnce({ stdout: "", stderr: "", code: 0, killed: false }); // commit

    // pi subprocess fails
    spawnSync.mockReturnValue({
      status: 1,
      stdout: "",
      stderr: "error",
    });

    const result = await autoCommitWithAIMessage(api, "/repo/wt");

    expect(result).toBe("chore: auto-commit worktree changes");
    // Commit called with fallback message
    expect(gitExec).toHaveBeenCalledWith(
      api,
      ["commit", "-m", "chore: auto-commit worktree changes"],
      "/repo/wt",
    );
  });

  it("uses FALLBACK_COMMIT_MESSAGE when pi returns empty stdout", async () => {
    const { api } = createMockAPI();

    const diffContent = "diff --git a/file.txt b/file.txt\n+new line";

    gitExec
      .mockResolvedValueOnce({ stdout: "", stderr: "", code: 0, killed: false }) // add -A
      .mockResolvedValueOnce({ stdout: diffContent, stderr: "", code: 0, killed: false }) // diff --cached
      .mockResolvedValueOnce({ stdout: "", stderr: "", code: 0, killed: false }); // commit

    // pi returns status 0 but empty stdout
    spawnSync.mockReturnValue({
      status: 0,
      stdout: "   ",
      stderr: "",
    });

    const result = await autoCommitWithAIMessage(api, "/repo/wt");

    expect(result).toBe("chore: auto-commit worktree changes");
  });

  it("throws when commit fails", async () => {
    const { api } = createMockAPI();

    const diffContent = "diff --git a/file.txt b/file.txt\n+new line";

    gitExec
      .mockResolvedValueOnce({ stdout: "", stderr: "", code: 0, killed: false }) // add -A
      .mockResolvedValueOnce({ stdout: diffContent, stderr: "", code: 0, killed: false }) // diff --cached
      .mockResolvedValueOnce({ stdout: "", stderr: "nothing to commit", code: 1, killed: false }); // commit fails

    spawnSync.mockReturnValue({
      status: 0,
      stdout: "feat: something\n",
      stderr: "",
    });

    await expect(autoCommitWithAIMessage(api, "/repo/wt")).rejects.toThrow(
      "Auto-commit failed: nothing to commit",
    );
  });

  it("uses FALLBACK_COMMIT_MESSAGE when pi throws", async () => {
    const { api } = createMockAPI();

    const diffContent = "diff --git a/file.txt b/file.txt\n+new line";

    gitExec
      .mockResolvedValueOnce({ stdout: "", stderr: "", code: 0, killed: false }) // add -A
      .mockResolvedValueOnce({ stdout: diffContent, stderr: "", code: 0, killed: false }) // diff --cached
      .mockResolvedValueOnce({ stdout: "", stderr: "", code: 0, killed: false }); // commit

    spawnSync.mockImplementation(() => {
      throw new Error("spawn failed");
    });

    const result = await autoCommitWithAIMessage(api, "/repo/wt");

    expect(result).toBe("chore: auto-commit worktree changes");
  });
});
