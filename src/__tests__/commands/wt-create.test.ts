import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock node:fs before importing anything that uses it ──────────────
vi.mock("node:fs", () => ({
  statSync: vi.fn(),
  readFileSync: vi.fn(),
}));

// ── Mock git module ─────────────────────────────────────────────
vi.mock("../../git.js", () => ({
  gitExec: vi.fn(),
  getUntrackedFiles: vi.fn(),
}));

// ── Mock worktree module ─────────────────────────────────────────
vi.mock("../../worktree.js", () => ({
  resolveBaseDir: vi.fn(() => "/repo/.git/worktrees/"),
  ensureMainRepo: vi.fn(),
  switchCwd: vi.fn(),
  copyUntrackedFiles: vi.fn(),
}));

// ── Mock validation module ──────────────────────────────────────
vi.mock("../../validation.js", () => ({
  validateBranchName: vi.fn(() => null),
}));

// ── Mock state module ───────────────────────────────────────────────
vi.mock("../../state.js", () => ({
  getMainRepoPath: vi.fn(() => ""),
  setMainRepoPath: vi.fn(),
  setCurrentBranch: vi.fn(),
  updateFooterStatus: vi.fn(),
}));

// ── Imports (after mocks are registered) ─────────────────────────────
import { statSync } from "node:fs";
import { handleWtCreate } from "../../commands/wt-create.js";
import { gitExec, getUntrackedFiles } from "../../git.js";
import { resolveBaseDir, ensureMainRepo, switchCwd, copyUntrackedFiles } from "../../worktree.js";
import { validateBranchName } from "../../validation.js";
import { getMainRepoPath, setCurrentBranch, updateFooterStatus } from "../../state.js";
import { createMockAPI, createMockContext, successResult, errorResult } from "../helpers/mocks.js";
import { FEATURE_PATH } from "../helpers/fixtures.js";

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks();
  // Default: statSync throws (directory does not exist)
  vi.mocked(statSync).mockImplementation(() => {
    throw new Error("ENOENT");
  });
  // Default: no validation error
  vi.mocked(validateBranchName).mockReturnValue(null);
  // Default: main repo path is already known
  vi.mocked(getMainRepoPath).mockReturnValue("/repo");
  vi.mocked(resolveBaseDir).mockReturnValue("/repo/.git/worktrees/");
  vi.mocked(ensureMainRepo).mockResolvedValue(true);
  vi.mocked(getUntrackedFiles).mockResolvedValue([]);
  vi.mocked(copyUntrackedFiles).mockReturnValue();
});

// ============================================================================
// Tests
// ============================================================================

describe("handleWtCreate", () => {
  const { api } = createMockAPI();

  it("empty args → error notification", async () => {
    const ctx = createMockContext();
    await handleWtCreate("", ctx, api);

    expect(ctx.ui.notify).toHaveBeenCalledWith("Usage: /wt-create <branch-name>", "error");
    expect(gitExec).not.toHaveBeenCalled();
  });

  it("invalid branch name → error notification", async () => {
    vi.mocked(validateBranchName).mockReturnValue("Branch name cannot start with '-'");

    const ctx = createMockContext();
    await handleWtCreate("-bad", ctx, api);

    expect(ctx.ui.notify).toHaveBeenCalledWith("Branch name cannot start with '-'", "error");
    expect(gitExec).not.toHaveBeenCalled();
  });

  it("not in git repo → error notification", async () => {
    vi.mocked(ensureMainRepo).mockImplementationOnce((_pi: any, mockCtx: any) => {
      mockCtx.ui.notify("Not inside a git repository", "error");
      return Promise.resolve(false);
    });

    const ctx = createMockContext();
    await handleWtCreate("feature", ctx, api);

    expect(ctx.ui.notify).toHaveBeenCalledWith("Not inside a git repository", "error");
    expect(gitExec).not.toHaveBeenCalled();
  });

  it("directory already exists → error notification", async () => {
    // statSync returns without throwing → directory exists
    vi.mocked(statSync).mockReturnValue({ isDirectory: () => true } as ReturnType<typeof statSync>);

    const ctx = createMockContext();
    await handleWtCreate("feature", ctx, api);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Directory already exists: /repo/.git/worktrees/feature",
      "error",
    );
    expect(gitExec).not.toHaveBeenCalled();
  });

  it("new branch — success path", async () => {
    // rev-parse --verify → code 1 (branch doesn't exist)
    vi.mocked(gitExec)
      .mockResolvedValueOnce(errorResult())
      // worktree add -b → code 0
      .mockResolvedValueOnce(successResult());

    const ctx = createMockContext();
    await handleWtCreate("feature", ctx, api);

    // Assert gitExec calls
    expect(gitExec).toHaveBeenCalledTimes(2);
    expect(gitExec).toHaveBeenNthCalledWith(1, api, ["rev-parse", "--verify", "feature"], "/repo");
    expect(gitExec).toHaveBeenNthCalledWith(
      2,
      api,
      ["worktree", "add", "-b", "feature", "/repo/.git/worktrees/feature"],
      "/repo",
    );

    // State updated
    expect(setCurrentBranch).toHaveBeenCalledWith("feature");

    // switchCwd called
    expect(switchCwd).toHaveBeenCalledWith(api, ctx, "/repo/.git/worktrees/feature");

    // Footer updated
    expect(updateFooterStatus).toHaveBeenCalledWith(ctx);

    // Success notification
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Created worktree for 'feature' at /repo/.git/worktrees/feature",
      "info",
    );
  });

  it("existing branch — success path", async () => {
    // rev-parse --verify → code 0 (branch exists)
    vi.mocked(gitExec)
      .mockResolvedValueOnce(successResult())
      // worktree add (no -b) → code 0
      .mockResolvedValueOnce(successResult());

    const ctx = createMockContext();
    await handleWtCreate("existing-branch", ctx, api);

    // Assert gitExec calls
    expect(gitExec).toHaveBeenCalledTimes(2);
    expect(gitExec).toHaveBeenNthCalledWith(
      1,
      api,
      ["rev-parse", "--verify", "existing-branch"],
      "/repo",
    );
    expect(gitExec).toHaveBeenNthCalledWith(
      2,
      api,
      ["worktree", "add", "/repo/.git/worktrees/existing-branch", "existing-branch"],
      "/repo",
    );

    // State updated
    expect(setCurrentBranch).toHaveBeenCalledWith("existing-branch");
    expect(switchCwd).toHaveBeenCalledWith(api, ctx, "/repo/.git/worktrees/existing-branch");
    expect(updateFooterStatus).toHaveBeenCalledWith(ctx);

    // Success notification
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Created worktree for 'existing-branch' at /repo/.git/worktrees/existing-branch",
      "info",
    );
  });

  it("git worktree add fails → error notification", async () => {
    // rev-parse --verify → code 1 (branch doesn't exist)
    vi.mocked(gitExec)
      .mockResolvedValueOnce(errorResult())
      // worktree add -b → code 1 (failure)
      .mockResolvedValueOnce(errorResult("fatal: already exists"));

    const ctx = createMockContext();
    await handleWtCreate("feature", ctx, api);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Failed to create worktree: fatal: already exists",
      "error",
    );
    // Should NOT have called switchCwd or setCurrentBranch
    expect(switchCwd).not.toHaveBeenCalled();
    expect(setCurrentBranch).not.toHaveBeenCalled();
  });

  it("copies untracked files on new branch creation", async () => {
    vi.mocked(getUntrackedFiles).mockResolvedValue(["untracked.txt"]);

    vi.mocked(gitExec).mockResolvedValueOnce(errorResult()).mockResolvedValueOnce(successResult());

    const ctx = createMockContext();
    await handleWtCreate("feature", ctx, api);

    expect(getUntrackedFiles).toHaveBeenCalledWith(api, ctx.cwd);
    expect(copyUntrackedFiles).toHaveBeenCalledWith(["untracked.txt"], ctx.cwd, FEATURE_PATH);
  });

  it("uses ctx.cwd as source path for untracked files", async () => {
    vi.mocked(getUntrackedFiles).mockResolvedValue(["file.txt"]);

    vi.mocked(gitExec).mockResolvedValueOnce(errorResult()).mockResolvedValueOnce(successResult());

    const customCtx = createMockContext({ cwd: "/custom/source/path" });
    await handleWtCreate("feature", customCtx, api);

    expect(getUntrackedFiles).toHaveBeenCalledWith(api, "/custom/source/path");
    expect(copyUntrackedFiles).toHaveBeenCalledWith(
      ["file.txt"],
      "/custom/source/path",
      FEATURE_PATH,
    );
  });

  it("handles empty untracked files list gracefully", async () => {
    vi.mocked(getUntrackedFiles).mockResolvedValue([]);

    vi.mocked(gitExec).mockResolvedValueOnce(errorResult()).mockResolvedValueOnce(successResult());

    const ctx = createMockContext();
    await handleWtCreate("feature", ctx, api);

    expect(copyUntrackedFiles).toHaveBeenCalledWith([], ctx.cwd, FEATURE_PATH);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Created worktree for 'feature' at /repo/.git/worktrees/feature",
      "info",
    );
  });

  it("does not copy files when worktree creation fails", async () => {
    vi.mocked(gitExec)
      .mockResolvedValueOnce(errorResult())
      .mockResolvedValueOnce(errorResult("fatal: already exists"));

    const ctx = createMockContext();
    await handleWtCreate("feature", ctx, api);

    expect(getUntrackedFiles).not.toHaveBeenCalled();
    expect(copyUntrackedFiles).not.toHaveBeenCalled();
  });

  it("copies untracked files for existing branch path", async () => {
    vi.mocked(getUntrackedFiles).mockResolvedValue(["notes.md"]);

    vi.mocked(gitExec)
      .mockResolvedValueOnce(successResult())
      .mockResolvedValueOnce(successResult());

    const ctx = createMockContext();
    await handleWtCreate("existing-branch", ctx, api);

    expect(getUntrackedFiles).toHaveBeenCalledWith(api, ctx.cwd);
    expect(copyUntrackedFiles).toHaveBeenCalledWith(
      ["notes.md"],
      ctx.cwd,
      "/repo/.git/worktrees/existing-branch",
    );
  });
});
