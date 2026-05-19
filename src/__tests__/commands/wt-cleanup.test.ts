import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock git module ──────────────────────────────────────────────
vi.mock("../../git.js", () => ({
  gitExec: vi.fn(),
  getWorktreeList: vi.fn(),
  findWorktreeByBranch: vi.fn(),
}));

// ── Mock worktree module ──────────────────────────────────────────
vi.mock("../../worktree.js", () => ({
  switchCwd: vi.fn(),
  detectMainRepo: vi.fn(),
  ensureMainRepo: vi.fn(() => Promise.resolve(true)),
  hasUncommittedChanges: vi.fn(),
}));

// ── Mock validation module ───────────────────────────────────────
vi.mock("../../validation.js", () => ({
  validateBranchName: vi.fn(() => null),
}));

vi.mock("../../state.js", () => ({
  getMainRepoPath: vi.fn(() => "/repo"),
  setMainRepoPath: vi.fn(),
  getCurrentBranch: vi.fn(() => "feature"),
  setCurrentBranch: vi.fn(),
  updateFooterStatus: vi.fn(),
  getDefaultBranch: vi.fn(() => "main"),
}));

// ── Imports (after mocks are registered) ─────────────────────────────
import { gitExec, getWorktreeList, findWorktreeByBranch } from "../../git.js";
import { switchCwd, hasUncommittedChanges, ensureMainRepo } from "../../worktree.js";
import { validateBranchName } from "../../validation.js";
import {
  getMainRepoPath,
  getCurrentBranch,
  setCurrentBranch,
  updateFooterStatus,
  getDefaultBranch,
} from "../../state.js";
import { handleWtCleanup } from "../../commands/wt-cleanup.js";
import { createMockAPI, createMockContext, successResult, errorResult } from "../helpers/mocks.js";
import {
  mainWorktree,
  featureWorktree,
  worktrees,
  MAIN_REPO,
  FEATURE_BRANCH,
  FEATURE_PATH,
} from "../helpers/fixtures.js";

import type { WorktreeInfo } from "../../types.js";

// ============================================================================
// Test Data (imported from fixtures)
// ============================================================================

// ============================================================================
// Setup / Teardown
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks();
  // Default: mainRepoPath already known
  vi.mocked(getMainRepoPath).mockReturnValue(MAIN_REPO);
  // Default: current branch is feature
  vi.mocked(getCurrentBranch).mockReturnValue(FEATURE_BRANCH);
  // Default: worktree is clean
  vi.mocked(hasUncommittedChanges).mockResolvedValue(false);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// Tests
// ============================================================================

describe("handleWtCleanup", () => {
  // ── 1. No args, on main → error ─────────────────────────────────
  it("no args and on main → error notification", async () => {
    vi.mocked(getCurrentBranch).mockReturnValue("main");

    const pi = createMockAPI().api;
    const ctx = createMockContext();

    await handleWtCleanup("", ctx, pi);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Usage: /wt-cleanup <branch-name> (currently on " +
        getDefaultBranch() +
        ", specify a worktree to clean up)",
      "error",
    );
    // No further operations
    expect(getWorktreeList).not.toHaveBeenCalled();
    expect(gitExec).not.toHaveBeenCalled();
  });

  // ── 2. Target is "main" → error (cannot remove main worktree) ────
  it("target is 'main' → error", async () => {
    const pi = createMockAPI().api;
    const ctx = createMockContext();

    await handleWtCleanup("main", ctx, pi);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Cannot remove the " + getDefaultBranch() + " worktree",
      "error",
    );
    expect(getWorktreeList).not.toHaveBeenCalled();
    expect(gitExec).not.toHaveBeenCalled();
  });

  // ── 3. Branch not found → error ─────────────────────────────────
  it("branch not found → error", async () => {
    const pi = createMockAPI().api;
    const ctx = createMockContext();

    vi.mocked(getWorktreeList).mockResolvedValueOnce(worktrees);
    vi.mocked(findWorktreeByBranch).mockReturnValueOnce(undefined);

    await handleWtCleanup("nonexistent", ctx, pi);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "No worktree found for branch 'nonexistent'",
      "error",
    );
    expect(gitExec).not.toHaveBeenCalled();
  });

  // ── 3.5. Dirty worktree → refusal ─────────────────────────────────
  it("dirty worktree → refuses to remove and shows error", async () => {
    const pi = createMockAPI().api;
    const ctx = createMockContext();

    vi.mocked(getWorktreeList).mockResolvedValueOnce(worktrees);
    vi.mocked(findWorktreeByBranch).mockReturnValueOnce(featureWorktree);
    vi.mocked(hasUncommittedChanges).mockResolvedValueOnce(true); // dirty!

    await handleWtCleanup("feature", ctx, pi);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Worktree '" +
        FEATURE_BRANCH +
        "' has uncommitted changes. Use /wt-merge to merge and clean up, or commit/stash your changes first.",
      "error",
    );
    expect(gitExec).not.toHaveBeenCalled();
    expect(ctx.ui.confirm).not.toHaveBeenCalled();
  });

  // ── 3.6. Confirmation cancelled → cleanup cancelled ────────────────
  it("confirmation cancelled → cleanup cancelled", async () => {
    const pi = createMockAPI().api;
    const ctx = createMockContext();
    vi.mocked(ctx.ui.confirm).mockResolvedValueOnce(false); // cancelled

    vi.mocked(getWorktreeList).mockResolvedValueOnce(worktrees);
    vi.mocked(findWorktreeByBranch).mockReturnValueOnce(featureWorktree);

    await handleWtCleanup("feature", ctx, pi);

    expect(ctx.ui.confirm).toHaveBeenCalledWith(
      "Remove worktree?",
      "This will force-remove the worktree for '" +
        FEATURE_BRANCH +
        "' and optionally delete its branch. This cannot be undone.",
    );
    expect(ctx.ui.notify).toHaveBeenCalledWith("Cleanup cancelled", "info");
    expect(gitExec).not.toHaveBeenCalled();
  });

  // ── 4. Success — currently in target worktree ───────────────────
  it("success — currently in target worktree → switches CWD to main", async () => {
    const pi = createMockAPI().api;
    const ctx = createMockContext();
    // getCurrentBranch() returns "feature" by default, which matches the target
    vi.mocked(getCurrentBranch).mockReturnValue(FEATURE_BRANCH);

    vi.mocked(getWorktreeList).mockResolvedValueOnce(worktrees);
    vi.mocked(findWorktreeByBranch).mockReturnValueOnce(featureWorktree);
    vi.mocked(gitExec)
      .mockResolvedValueOnce(successResult()) // worktree remove -f
      .mockResolvedValueOnce(successResult()) // worktree prune
      .mockResolvedValueOnce(successResult()); // branch -d

    await handleWtCleanup("feature", ctx, pi);

    // Remove worktree
    expect(gitExec).toHaveBeenCalledWith(pi, ["worktree", "remove", "-f", FEATURE_PATH], MAIN_REPO);

    // Prune
    expect(gitExec).toHaveBeenCalledWith(pi, ["worktree", "prune"], MAIN_REPO);

    // Branch delete
    expect(gitExec).toHaveBeenCalledWith(pi, ["branch", "-d", FEATURE_BRANCH], MAIN_REPO);

    // Switches CWD back to main repo since we were in the target worktree
    expect(setCurrentBranch).toHaveBeenCalledWith(getDefaultBranch());
    expect(switchCwd).toHaveBeenCalledWith(pi, ctx, MAIN_REPO);

    // Footer updated
    expect(updateFooterStatus).toHaveBeenCalledWith(ctx);

    // Success notification
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Cleaned up worktree '" + FEATURE_BRANCH + "'",
      "info",
    );
  });

  // ── 5. Success — currently in different worktree ────────────────
  it("success — currently in different worktree → does NOT switch CWD", async () => {
    const pi = createMockAPI().api;
    const ctx = createMockContext();

    const otherBranch = "other-branch";
    const otherPath = "/repo/.git/worktrees/other-branch";
    const otherWorktree: WorktreeInfo = {
      path: otherPath,
      head: "xyz999",
      branch: "refs/heads/other-branch",
      branchName: otherBranch,
    };

    // Current branch is "other-branch", cleaning up "feature"
    vi.mocked(getCurrentBranch).mockReturnValue(otherBranch);

    vi.mocked(getWorktreeList).mockResolvedValueOnce([
      mainWorktree,
      otherWorktree,
      featureWorktree,
    ]);
    vi.mocked(findWorktreeByBranch).mockReturnValueOnce(featureWorktree);
    vi.mocked(gitExec)
      .mockResolvedValueOnce(successResult()) // worktree remove -f
      .mockResolvedValueOnce(successResult()) // worktree prune
      .mockResolvedValueOnce(successResult()); // branch -d

    await handleWtCleanup("feature", ctx, pi);

    // Does NOT switch CWD — stays in current worktree
    expect(setCurrentBranch).not.toHaveBeenCalled();
    expect(switchCwd).not.toHaveBeenCalled();

    // Footer IS still updated
    expect(updateFooterStatus).toHaveBeenCalledWith(ctx);

    // Success notification
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Cleaned up worktree '" + FEATURE_BRANCH + "'",
      "info",
    );
  });

  // ── 6. Locked worktree — first remove fails, double-force succeeds
  it("locked worktree — first remove fails, double-force succeeds", async () => {
    const pi = createMockAPI().api;
    const ctx = createMockContext();
    vi.mocked(getCurrentBranch).mockReturnValue(FEATURE_BRANCH);

    vi.mocked(getWorktreeList).mockResolvedValueOnce(worktrees);
    vi.mocked(findWorktreeByBranch).mockReturnValueOnce(featureWorktree);
    vi.mocked(gitExec)
      .mockResolvedValueOnce(errorResult("worktree is locked")) // worktree remove -f fails
      .mockResolvedValueOnce(successResult()) // worktree remove -f -f succeeds
      .mockResolvedValueOnce(successResult()) // worktree prune
      .mockResolvedValueOnce(successResult()); // branch -d

    await handleWtCleanup("feature", ctx, pi);

    // First remove attempt
    expect(gitExec).toHaveBeenCalledWith(pi, ["worktree", "remove", "-f", FEATURE_PATH], MAIN_REPO);

    // Second remove attempt (double-force)
    expect(gitExec).toHaveBeenCalledWith(
      pi,
      ["worktree", "remove", "-f", "-f", FEATURE_PATH],
      MAIN_REPO,
    );

    // Prune and branch delete still called
    expect(gitExec).toHaveBeenCalledWith(pi, ["worktree", "prune"], MAIN_REPO);
    expect(gitExec).toHaveBeenCalledWith(pi, ["branch", "-d", FEATURE_BRANCH], MAIN_REPO);

    // Success
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Cleaned up worktree '" + FEATURE_BRANCH + "'",
      "info",
    );
  });

  // ── 7. Both remove attempts fail → error notification ───────────
  it("both remove attempts fail → error notification", async () => {
    const pi = createMockAPI().api;
    const ctx = createMockContext();

    vi.mocked(getWorktreeList).mockResolvedValueOnce(worktrees);
    vi.mocked(findWorktreeByBranch).mockReturnValueOnce(featureWorktree);
    vi.mocked(gitExec)
      .mockResolvedValueOnce(errorResult("worktree is locked")) // first remove fails
      .mockResolvedValueOnce(errorResult("still locked after force")); // double-force fails

    await handleWtCleanup("feature", ctx, pi);

    // Error notification
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Failed to remove worktree: still locked after force",
      "error",
    );

    // Prune NOT called (early return)
    expect(gitExec).not.toHaveBeenCalledWith(pi, ["worktree", "prune"], MAIN_REPO);

    // State NOT updated
    expect(setCurrentBranch).not.toHaveBeenCalled();
    expect(switchCwd).not.toHaveBeenCalled();
  });

  // ── 8. Branch deletion — safe delete succeeds ───────────────────
  it("branch deletion — safe delete is called and succeeds", async () => {
    const pi = createMockAPI().api;
    const ctx = createMockContext();
    vi.mocked(getCurrentBranch).mockReturnValue(FEATURE_BRANCH);

    vi.mocked(getWorktreeList).mockResolvedValueOnce(worktrees);
    vi.mocked(findWorktreeByBranch).mockReturnValueOnce(featureWorktree);
    vi.mocked(gitExec)
      .mockResolvedValueOnce(successResult()) // worktree remove -f
      .mockResolvedValueOnce(successResult()) // worktree prune
      .mockResolvedValueOnce(successResult("Deleted branch feature (was def456).")); // branch -d

    await handleWtCleanup("feature", ctx, pi);

    // branch -d called
    expect(gitExec).toHaveBeenCalledWith(pi, ["branch", "-d", FEATURE_BRANCH], MAIN_REPO);

    // Branch deleted notification
    expect(ctx.ui.notify).toHaveBeenCalledWith("Branch '" + FEATURE_BRANCH + "' deleted", "info");

    // Success notification
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Cleaned up worktree '" + FEATURE_BRANCH + "'",
      "info",
    );
  });

  // ── 9. Branch deletion fails — still succeeds (safe delete is best-effort)
  it("branch deletion fails — cleanup still succeeds (safe delete is best-effort)", async () => {
    const pi = createMockAPI().api;
    const ctx = createMockContext();
    vi.mocked(getCurrentBranch).mockReturnValue(FEATURE_BRANCH);

    vi.mocked(getWorktreeList).mockResolvedValueOnce(worktrees);
    vi.mocked(findWorktreeByBranch).mockReturnValueOnce(featureWorktree);
    vi.mocked(gitExec)
      .mockResolvedValueOnce(successResult()) // worktree remove -f
      .mockResolvedValueOnce(successResult()) // worktree prune
      .mockResolvedValueOnce(errorResult("The branch 'feature' is not fully merged.")); // branch -d fails

    await handleWtCleanup("feature", ctx, pi);

    // branch -d was attempted
    expect(gitExec).toHaveBeenCalledWith(pi, ["branch", "-d", FEATURE_BRANCH], MAIN_REPO);

    // Branch not fully merged notification
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Branch '" +
        FEATURE_BRANCH +
        "' was not fully merged and was kept. Use `git branch -D " +
        FEATURE_BRANCH +
        "` to force-delete.",
      "info",
    );

    // Cleanup still succeeds — the success notification is shown
    // (branch deletion is best-effort / fire-and-forget)
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Cleaned up worktree '" + FEATURE_BRANCH + "'",
      "info",
    );
    expect(setCurrentBranch).toHaveBeenCalledWith(getDefaultBranch());
    expect(switchCwd).toHaveBeenCalledWith(pi, ctx, MAIN_REPO);
  });

  // ── 10. Not in git repo → error notification ────────────────────
  it("not in git repo → error notification", async () => {
    const pi = createMockAPI().api;
    const ctx = createMockContext();

    vi.mocked(ensureMainRepo).mockImplementationOnce((_pi: any, mockCtx: any) => {
      mockCtx.ui.notify("Not inside a git repository", "error");
      return Promise.resolve(false);
    });

    await handleWtCleanup("feature", ctx, pi);

    expect(ctx.ui.notify).toHaveBeenCalledWith("Not inside a git repository", "error");
    expect(getWorktreeList).not.toHaveBeenCalled();
    expect(gitExec).not.toHaveBeenCalled();
  });

  // ── 11. Invalid branch name → error notification ────────────────
  it("invalid branch name → error notification", async () => {
    const pi = createMockAPI().api;
    const ctx = createMockContext();

    vi.mocked(validateBranchName).mockReturnValueOnce(
      "Branch name contains invalid character: '..'",
    );

    await handleWtCleanup("bad..name", ctx, pi);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Branch name contains invalid character: '..'",
      "error",
    );
    expect(getWorktreeList).not.toHaveBeenCalled();
    expect(gitExec).not.toHaveBeenCalled();
  });
});
