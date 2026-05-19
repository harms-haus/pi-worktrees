import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock git module ─────────────────────────────────────────────
vi.mock("../../git.js", () => ({
  getWorktreeList: vi.fn(),
  findWorktreeByBranch: vi.fn(),
}));

// ── Mock worktree module ─────────────────────────────────────────
vi.mock("../../worktree.js", () => ({
  switchCwd: vi.fn(),
  ensureMainRepo: vi.fn(),
}));

// ── Mock state module ───────────────────────────────────────────────
vi.mock("../../state.js", () => ({
  getMainRepoPath: vi.fn(() => ""),
  setMainRepoPath: vi.fn(),
  setCurrentBranch: vi.fn(),
  updateFooterStatus: vi.fn(),
  getDefaultBranch: vi.fn(() => "main"),
}));

// ── Imports (after mocks are registered) ─────────────────────────────
import { handleWtSwitch } from "../../commands/wt-switch.js";
import { getWorktreeList, findWorktreeByBranch } from "../../git.js";
import { switchCwd, ensureMainRepo } from "../../worktree.js";
import {
  getMainRepoPath,
  setCurrentBranch,
  updateFooterStatus,
  getDefaultBranch,
} from "../../state.js";
import { createMockAPI, createMockContext } from "../helpers/mocks.js";

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks();
  // Default: main repo path is already known
  vi.mocked(getMainRepoPath).mockReturnValue("/repo");
  vi.mocked(ensureMainRepo).mockResolvedValue(true);
});

// ============================================================================
// Tests
// ============================================================================

describe("handleWtSwitch", () => {
  const { api } = createMockAPI();

  it("empty args → error notification", async () => {
    const ctx = createMockContext();
    await handleWtSwitch("", ctx, api);

    expect(ctx.ui.notify).toHaveBeenCalledWith("Usage: /wt-switch <branch-name>|main", "error");
    expect(switchCwd).not.toHaveBeenCalled();
  });

  it("switch to 'main' — success", async () => {
    const ctx = createMockContext();
    await handleWtSwitch("main", ctx, api);

    // Branch set to default branch
    expect(setCurrentBranch).toHaveBeenCalledWith(getDefaultBranch());

    // switchCwd called with main repo path
    expect(switchCwd).toHaveBeenCalledWith(api, ctx, "/repo");

    // Footer updated
    expect(updateFooterStatus).toHaveBeenCalledWith(ctx);

    // Success notification
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Switched to " + getDefaultBranch() + " worktree",
      "info",
    );
  });

  it("switch to existing branch worktree — success", async () => {
    const worktreePath = "/repo/.git/worktrees/feature";
    vi.mocked(getWorktreeList).mockResolvedValue([]);
    vi.mocked(findWorktreeByBranch).mockReturnValue({
      path: worktreePath,
      head: "abc123",
      branch: "refs/heads/feature",
      branchName: "feature",
    });

    const ctx = createMockContext();
    await handleWtSwitch("feature", ctx, api);

    // getWorktreeList called
    expect(getWorktreeList).toHaveBeenCalledWith(api, "/repo");

    // findWorktreeByBranch called with worktrees and target
    expect(findWorktreeByBranch).toHaveBeenCalledWith([], "feature");

    // Branch set
    expect(setCurrentBranch).toHaveBeenCalledWith("feature");

    // switchCwd called with worktree path
    expect(switchCwd).toHaveBeenCalledWith(api, ctx, worktreePath);

    // Footer updated
    expect(updateFooterStatus).toHaveBeenCalledWith(ctx);

    // Success notification
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Switched to worktree 'feature' at " + worktreePath,
      "info",
    );
  });

  it("branch not found → error with suggestion to use /wt-create", async () => {
    vi.mocked(getWorktreeList).mockResolvedValue([]);
    vi.mocked(findWorktreeByBranch).mockReturnValue(undefined);

    const ctx = createMockContext();
    await handleWtSwitch("nonexistent", ctx, api);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "No worktree found for branch 'nonexistent'. Use /wt-create nonexistent first.",
      "error",
    );
    expect(switchCwd).not.toHaveBeenCalled();
    expect(setCurrentBranch).not.toHaveBeenCalled();
  });

  it("switch to literal 'main' when default is 'master' → treats as regular branch lookup", async () => {
    vi.mocked(getDefaultBranch).mockReturnValue("master");
    vi.mocked(getWorktreeList).mockResolvedValue([]);
    vi.mocked(findWorktreeByBranch).mockReturnValue(undefined);

    const ctx = createMockContext();
    await handleWtSwitch("main", ctx, api);

    // Should NOT switch to main repo — instead looks up branch 'main' as a regular branch
    expect(switchCwd).not.toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "No worktree found for branch 'main'. Use /wt-create main first.",
      "error",
    );
  });

  it("not in git repo → error notification", async () => {
    vi.mocked(ensureMainRepo).mockImplementationOnce((_pi: any, mockCtx: any) => {
      mockCtx.ui.notify("Not inside a git repository", "error");
      return Promise.resolve(false);
    });

    const ctx = createMockContext();
    await handleWtSwitch("feature", ctx, api);

    expect(ctx.ui.notify).toHaveBeenCalledWith("Not inside a git repository", "error");
    expect(switchCwd).not.toHaveBeenCalled();
    expect(getWorktreeList).not.toHaveBeenCalled();
  });
});
