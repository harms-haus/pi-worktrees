import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock helpers before importing anything that uses them ──────────
vi.mock("../../helpers.js", () => ({
  gitExec: vi.fn(),
  getWorktreeList: vi.fn(),
  findWorktreeByBranch: vi.fn(),
  switchCwd: vi.fn(),
  detectMainRepo: vi.fn(),
  hasUncommittedChanges: vi.fn(),
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
import {
  gitExec,
  getWorktreeList,
  findWorktreeByBranch,
  switchCwd,
  hasUncommittedChanges,
} from "../../helpers.js";
import {
  getMainRepoPath,
  getCurrentBranch,
  setCurrentBranch,
  updateFooterStatus,
  getDefaultBranch,
} from "../../state.js";
import { handleWtCleanup } from "../../commands/wt-cleanup.js";
import { createMockAPI, createMockContext, successResult, errorResult } from "../helpers/mocks.js";

import type { WorktreeInfo } from "../../types.js";

// ============================================================================
// Test Data
// ============================================================================

const MAIN_REPO = "/repo";
const MAIN_BRANCH = "main";
const FEATURE_BRANCH = "feature";
const FEATURE_PATH = "/repo/.git/worktrees/feature";

const mainWorktree: WorktreeInfo = {
  path: MAIN_REPO,
  head: "abc123",
  branch: "refs/heads/main",
  branchName: MAIN_BRANCH,
};

const featureWorktree: WorktreeInfo = {
  path: FEATURE_PATH,
  head: "def456",
  branch: "refs/heads/feature",
  branchName: FEATURE_BRANCH,
};

const worktrees: WorktreeInfo[] = [mainWorktree, featureWorktree];

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
});
