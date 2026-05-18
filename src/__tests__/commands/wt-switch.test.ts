import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock helpers module ─────────────────────────────────────────────
vi.mock("../../helpers.js", () => ({
  getWorktreeList: vi.fn(),
  findWorktreeByBranch: vi.fn(),
  switchCwd: vi.fn(),
  detectMainRepo: vi.fn(),
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
import { getWorktreeList, findWorktreeByBranch, switchCwd } from "../../helpers.js";
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
});
