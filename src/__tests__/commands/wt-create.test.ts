import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock node:fs before importing anything that uses it ──────────────
vi.mock("node:fs", () => ({
  statSync: vi.fn(),
  readFileSync: vi.fn(),
}));

// ── Mock helpers module ─────────────────────────────────────────────
vi.mock("../../helpers.js", () => ({
  gitExec: vi.fn(),
  resolveBaseDir: vi.fn(() => "/repo/.git/worktrees/"),
  detectMainRepo: vi.fn(),
  switchCwd: vi.fn(),
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
import {
  gitExec,
  resolveBaseDir,
  detectMainRepo,
  switchCwd,
  validateBranchName,
} from "../../helpers.js";
import { getMainRepoPath, setCurrentBranch, updateFooterStatus } from "../../state.js";
import { createMockAPI, createMockContext } from "../helpers/mocks.js";

// ============================================================================
// Helpers
// ============================================================================

function makeExecResult(
  overrides: Partial<{ stdout: string; stderr: string; code: number; killed: boolean }> = {},
) {
  return {
    stdout: overrides.stdout ?? "",
    stderr: overrides.stderr ?? "",
    code: overrides.code ?? 0,
    killed: overrides.killed ?? false,
  };
}

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
    vi.mocked(getMainRepoPath).mockReturnValue("");
    vi.mocked(detectMainRepo).mockResolvedValue(null);

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
      .mockResolvedValueOnce(makeExecResult({ code: 1 }))
      // worktree add -b → code 0
      .mockResolvedValueOnce(makeExecResult({ code: 0 }));

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
      .mockResolvedValueOnce(makeExecResult({ code: 0 }))
      // worktree add (no -b) → code 0
      .mockResolvedValueOnce(makeExecResult({ code: 0 }));

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
      .mockResolvedValueOnce(makeExecResult({ code: 1 }))
      // worktree add -b → code 1 (failure)
      .mockResolvedValueOnce(makeExecResult({ code: 1, stderr: "fatal: already exists" }));

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
});
