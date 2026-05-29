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

const { readFileSync, lstatSync, existsSync, mkdirSync, copyFileSync } = vi.hoisted(() => ({
  readFileSync: vi.fn(),
  lstatSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  copyFileSync: vi.fn(),
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
  lstatSync,
  existsSync,
  mkdirSync,
  copyFileSync,
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
  copyUntrackedFiles,
  analyzeFile,
  copyFilesWithOverwrite,
  formatFileListForConfirm,
} from "../worktree.js";
import { WORKTREE_CHANGE_TYPE } from "../types.js";
import { createMockAPI, createMockContext } from "./helpers/mocks.js";
import { MAIN_REPO, MAIN_BRANCH, FEATURE_BRANCH, FEATURE_PATH } from "./helpers/fixtures.js";

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(lstatSync).mockReturnValue({
    isDirectory: () => false,
    isSymbolicLink: () => false,
  } as any);
  vi.mocked(existsSync).mockReturnValue(false);
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

// ============================================================================
// copyUntrackedFiles
// ============================================================================
describe("copyUntrackedFiles", () => {
  it("is no-op when list is empty", () => {
    copyUntrackedFiles([], "/src", "/dest");

    expect(copyFileSync).not.toHaveBeenCalled();
    expect(mkdirSync).not.toHaveBeenCalled();
  });

  it("copies a single file", () => {
    copyUntrackedFiles(["file.txt"], "/src", "/dest");

    expect(copyFileSync).toHaveBeenCalledWith("/src/file.txt", "/dest/file.txt");
  });

  it("creates parent directories for nested paths", () => {
    copyUntrackedFiles(["a/b/c.txt"], "/src", "/dest");

    expect(mkdirSync).toHaveBeenCalledWith("/dest/a/b", { recursive: true });
    expect(copyFileSync).toHaveBeenCalledWith("/src/a/b/c.txt", "/dest/a/b/c.txt");
  });

  it("skips directories (submodule filter)", () => {
    vi.mocked(lstatSync).mockReturnValue({
      isDirectory: () => true,
      isSymbolicLink: () => false,
    } as any);

    copyUntrackedFiles(["submodule-dir"], "/src", "/dest");

    expect(copyFileSync).not.toHaveBeenCalled();
  });

  it("skips files that already exist in destination", () => {
    vi.mocked(existsSync).mockReturnValue(true);

    copyUntrackedFiles(["file.txt"], "/src", "/dest");

    expect(copyFileSync).not.toHaveBeenCalled();
  });

  it("continues when a single file fails to copy", () => {
    vi.mocked(copyFileSync).mockImplementationOnce(() => {
      throw new Error("copy failed");
    });

    copyUntrackedFiles(["fail.txt", "ok.txt"], "/src", "/dest");

    expect(copyFileSync).toHaveBeenCalledTimes(2);
  });

  it("continues when lstatSync throws (file disappeared)", () => {
    vi.mocked(lstatSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });

    copyUntrackedFiles(["gone.txt"], "/src", "/dest");

    expect(copyFileSync).not.toHaveBeenCalled();
  });

  it("skips symbolic links", () => {
    vi.mocked(lstatSync).mockReturnValue({
      isDirectory: () => false,
      isSymbolicLink: () => true,
    } as any);
    copyUntrackedFiles(["symlink-file"], "/src", "/dest");
    expect(copyFileSync).not.toHaveBeenCalled();
  });

  it("skips files with path traversal in relative path", () => {
    copyUntrackedFiles(["../../../etc/passwd"], "/src", "/dest");
    expect(copyFileSync).not.toHaveBeenCalled();
  });

  it("copies multiple files", () => {
    copyUntrackedFiles(["a.txt", "b.txt", "dir/c.txt"], "/src", "/dest");

    expect(copyFileSync).toHaveBeenCalledTimes(3);
    expect(copyFileSync).toHaveBeenCalledWith("/src/a.txt", "/dest/a.txt");
    expect(copyFileSync).toHaveBeenCalledWith("/src/b.txt", "/dest/b.txt");
    expect(copyFileSync).toHaveBeenCalledWith("/src/dir/c.txt", "/dest/dir/c.txt");
  });
});

// ============================================================================
// analyzeFile
// ============================================================================
describe("analyzeFile", () => {
  it("returns { isBinary: false, lines: N } for a text file with N lines", () => {
    vi.mocked(readFileSync).mockImplementation((path: unknown) => {
      if (typeof path === "string" && path.endsWith("test.txt")) {
        return Buffer.from("line1\nline2\nline3\n");
      }
      throw new Error("unexpected readFileSync call");
    });

    const result = analyzeFile("/some/test.txt");

    expect(result).toEqual({ isBinary: false, lines: 3 });
  });

  it("returns { isBinary: false, lines: 0 } for an empty file", () => {
    vi.mocked(readFileSync).mockImplementation((path: unknown) => {
      if (typeof path === "string" && path.endsWith("empty.txt")) {
        return Buffer.alloc(0);
      }
      throw new Error("unexpected readFileSync call");
    });

    const result = analyzeFile("/some/empty.txt");

    expect(result).toEqual({ isBinary: false, lines: 0 });
  });

  it("returns { isBinary: true, lines: null } for a binary file", () => {
    vi.mocked(readFileSync).mockImplementation((path: unknown) => {
      if (typeof path === "string" && path.endsWith("binary.bin")) {
        return Buffer.from([0x00, 0x01, 0x02]);
      }
      throw new Error("unexpected readFileSync call");
    });

    const result = analyzeFile("/some/binary.bin");

    expect(result).toEqual({ isBinary: true, lines: null });
  });

  it("returns { isBinary: false, lines: 0 } when readFileSync throws", () => {
    vi.mocked(readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });

    const result = analyzeFile("/missing/file.txt");

    expect(result).toEqual({ isBinary: false, lines: 0 });
  });

  it("returns { isBinary: false, lines: 0 } when lstatSync indicates symlink", () => {
    vi.mocked(lstatSync).mockImplementation((path: unknown) => {
      if (typeof path === "string" && path.endsWith("symlink.txt")) {
        return {
          isDirectory: () => false,
          isSymbolicLink: () => true,
        } as any;
      }
      return {
        isDirectory: () => false,
        isSymbolicLink: () => false,
      } as any;
    });

    const result = analyzeFile("/some/symlink.txt");

    expect(result).toEqual({ isBinary: false, lines: 0 });
    // Should NOT attempt to read the file
    expect(readFileSync).not.toHaveBeenCalled();
  });

  it("returns { isBinary: false, lines: 0 } when lstatSync throws", () => {
    vi.mocked(lstatSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });

    const result = analyzeFile("/missing/file.txt");

    expect(result).toEqual({ isBinary: false, lines: 0 });
  });
});

// ============================================================================
// copyFilesWithOverwrite
// ============================================================================
describe("copyFilesWithOverwrite", () => {
  it("copies a single file", () => {
    const failed = copyFilesWithOverwrite(["file.txt"], "/src", "/dest");

    expect(failed).toEqual([]);
    expect(copyFileSync).toHaveBeenCalledWith("/src/file.txt", "/dest/file.txt");
  });

  it("overwrites existing file", () => {
    vi.mocked(existsSync).mockReturnValue(true);

    const failed = copyFilesWithOverwrite(["file.txt"], "/src", "/dest");

    expect(failed).toEqual([]);
    // Unlike copyUntrackedFiles, this should still copy even when file exists
    expect(copyFileSync).toHaveBeenCalledWith("/src/file.txt", "/dest/file.txt");
  });

  it("creates parent directories for nested paths", () => {
    const failed = copyFilesWithOverwrite(["a/b/c.txt"], "/src", "/dest");

    expect(failed).toEqual([]);
    expect(mkdirSync).toHaveBeenCalledWith("/dest/a/b", { recursive: true });
    expect(copyFileSync).toHaveBeenCalledWith("/src/a/b/c.txt", "/dest/a/b/c.txt");
  });

  it("skips directories", () => {
    vi.mocked(lstatSync).mockReturnValue({
      isDirectory: () => true,
      isSymbolicLink: () => false,
    } as any);

    const failed = copyFilesWithOverwrite(["submodule-dir"], "/src", "/dest");

    expect(failed).toEqual([]);
    expect(copyFileSync).not.toHaveBeenCalled();
  });

  it("skips symbolic links", () => {
    vi.mocked(lstatSync).mockReturnValue({
      isDirectory: () => false,
      isSymbolicLink: () => true,
    } as any);

    const failed = copyFilesWithOverwrite(["symlink-file"], "/src", "/dest");

    expect(failed).toEqual([]);
    expect(copyFileSync).not.toHaveBeenCalled();
  });

  it("prevents destination path traversal and adds to failed", () => {
    const failed = copyFilesWithOverwrite(["../../../etc/passwd"], "/src", "/dest");

    expect(failed).toEqual(["../../../etc/passwd"]);
    expect(copyFileSync).not.toHaveBeenCalled();
  });

  it("prevents source path traversal and adds to failed", () => {
    const failed = copyFilesWithOverwrite(["../../etc/passwd"], "/src", "/dest");

    expect(failed).toEqual(["../../etc/passwd"]);
    expect(copyFileSync).not.toHaveBeenCalled();
  });

  it("adds to failed when destination is a symlink", () => {
    vi.mocked(lstatSync).mockImplementation((path: unknown) => {
      if (typeof path === "string" && path.startsWith("/dest/")) {
        return {
          isDirectory: () => false,
          isSymbolicLink: () => true,
        } as any;
      }
      return {
        isDirectory: () => false,
        isSymbolicLink: () => false,
      } as any;
    });

    const failed = copyFilesWithOverwrite(["file.txt"], "/src", "/dest");

    expect(failed).toEqual(["file.txt"]);
    expect(copyFileSync).not.toHaveBeenCalled();
  });

  it("returns failed files on copy error", () => {
    vi.mocked(copyFileSync).mockImplementation(() => {
      throw new Error("copy failed");
    });

    const failed = copyFilesWithOverwrite(["bad.txt"], "/src", "/dest");

    expect(failed).toEqual(["bad.txt"]);
  });

  it("is no-op for empty list", () => {
    const failed = copyFilesWithOverwrite([], "/src", "/dest");

    expect(failed).toEqual([]);
    expect(copyFileSync).not.toHaveBeenCalled();
    expect(mkdirSync).not.toHaveBeenCalled();
    expect(lstatSync).not.toHaveBeenCalled();
  });
});

// ============================================================================
// formatFileListForConfirm
// ============================================================================
describe("formatFileListForConfirm", () => {
  const theme = {
    fg: vi.fn((color: string, text: string) => `<${color}>${text}</${color}>`),
  };

  beforeEach(() => {
    theme.fg.mockClear();
  });

  it("returns empty string for empty list", () => {
    const result = formatFileListForConfirm([], theme);

    expect(result).toBe("");
  });

  it("formats text file with green color-coded line count", () => {
    const files = [{ path: "src/app.ts", isBinary: false, lines: 42 }];

    const result = formatFileListForConfirm(files, theme);

    expect(theme.fg).toHaveBeenCalledWith("success", "+42");
    expect(result).toContain("src/app.ts");
    expect(result).toContain("+42");
  });

  it("formats binary file with (binary) label", () => {
    const files = [{ path: "image.png", isBinary: true, lines: null }];

    const result = formatFileListForConfirm(files, theme);

    expect(result).toContain("image.png");
    expect(result).toContain("(binary)");
    // fg should NOT be called for binary files
    expect(theme.fg).not.toHaveBeenCalled();
  });

  it("formats mixed list with numbered entries", () => {
    const files = [
      { path: "readme.md", isBinary: false, lines: 10 },
      { path: "logo.png", isBinary: true, lines: null },
      { path: "util.ts", isBinary: false, lines: 5 },
    ];

    const result = formatFileListForConfirm(files, theme);

    expect(result).toContain("1. readme.md");
    expect(result).toContain("2. logo.png");
    expect(result).toContain("3. util.ts");
    expect(result).toContain("(binary)");
  });

  it("prepends header line", () => {
    const files = [{ path: "file.txt", isBinary: false, lines: 1 }];

    const result = formatFileListForConfirm(files, theme);

    expect(result.startsWith("The following untracked files will be copied to main:"));
    expect(result.split("\n")[0]).toBe("The following untracked files will be copied to main:");
  });
});
