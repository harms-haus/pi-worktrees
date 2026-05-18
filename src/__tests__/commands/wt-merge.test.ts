import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock helpers before importing anything that uses them ──────────
vi.mock("../../helpers.js", () => ({
  gitExec: vi.fn(),
  getWorktreeList: vi.fn(),
  findWorktreeByBranch: vi.fn(),
  getMainWorktree: vi.fn(),
  switchCwd: vi.fn(),
  detectMainRepo: vi.fn(),
  hasUncommittedChanges: vi.fn(),
  autoCommitWithAIMessage: vi.fn(),
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
  getMainWorktree,
  switchCwd,
  detectMainRepo,
  hasUncommittedChanges,
  autoCommitWithAIMessage,
} from "../../helpers.js";
import {
  getMainRepoPath,
  setMainRepoPath,
  getCurrentBranch,
  setCurrentBranch,
  updateFooterStatus,
} from "../../state.js";
import { handleWtMerge } from "../../commands/wt-merge.js";
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
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// Tests
// ============================================================================

describe("handleWtMerge", () => {
  // ── 1. No args, on main → error notification ────────────────────
  it("no args and on main → error notification", async () => {
    vi.mocked(getCurrentBranch).mockReturnValue("main");

    const pi = createMockAPI().api;
    const ctx = createMockContext();

    await handleWtMerge("", ctx, pi);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Usage: /wt-merge <branch-name> (currently on main, no worktree to merge)",
      "error",
    );
    // No further operations
    expect(getWorktreeList).not.toHaveBeenCalled();
    expect(gitExec).not.toHaveBeenCalled();
  });

  // ── 2. No args, on worktree — uses current branch ───────────────
  it("no args on worktree → uses current branch name", async () => {
    const pi = createMockAPI().api;
    const ctx = createMockContext();

    // getMainRepoPath returns empty → triggers detectMainRepo
    vi.mocked(getMainRepoPath).mockReturnValueOnce("");
    vi.mocked(detectMainRepo).mockResolvedValueOnce(MAIN_REPO);

    vi.mocked(getWorktreeList).mockResolvedValueOnce(worktrees);
    vi.mocked(findWorktreeByBranch).mockReturnValueOnce(featureWorktree);
    vi.mocked(hasUncommittedChanges).mockResolvedValueOnce(false); // worktree clean
    vi.mocked(getMainWorktree).mockReturnValueOnce(mainWorktree);
    vi.mocked(hasUncommittedChanges).mockResolvedValueOnce(false); // main clean
    vi.mocked(gitExec)
      .mockResolvedValueOnce(successResult()) // checkout main
      .mockResolvedValueOnce(successResult("Already up to date.")) // merge
      .mockResolvedValueOnce(successResult()) // worktree remove -f
      .mockResolvedValueOnce(successResult()); // worktree prune

    await handleWtMerge("", ctx, pi);

    // findWorktreeByBranch called with current branch ("feature")
    expect(findWorktreeByBranch).toHaveBeenCalledWith(worktrees, FEATURE_BRANCH);
    // Success notification
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Merged '" + FEATURE_BRANCH + "' into " + MAIN_BRANCH + " and removed worktree",
      "info",
    );
  });

  // ── 3. Branch not found → error ─────────────────────────────────
  it("branch not found → error", async () => {
    const pi = createMockAPI().api;
    const ctx = createMockContext();

    vi.mocked(getWorktreeList).mockResolvedValueOnce(worktrees);
    vi.mocked(findWorktreeByBranch).mockReturnValueOnce(undefined);

    await handleWtMerge("nonexistent", ctx, pi);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "No worktree found for branch 'nonexistent'",
      "error",
    );
    expect(gitExec).not.toHaveBeenCalled();
  });

  // ── 3.5. Confirmation cancelled → merge cancelled ──────────────────
  it("confirmation cancelled → merge cancelled", async () => {
    const pi = createMockAPI().api;
    const ctx = createMockContext();
    vi.mocked(ctx.ui.confirm).mockResolvedValueOnce(false); // cancelled

    vi.mocked(getWorktreeList).mockResolvedValueOnce(worktrees);
    vi.mocked(findWorktreeByBranch).mockReturnValueOnce(featureWorktree);

    await handleWtMerge("feature", ctx, pi);

    expect(ctx.ui.confirm).toHaveBeenCalledWith(
      "Merge and remove worktree?",
      "This will merge '" +
        FEATURE_BRANCH +
        "' into the default branch and remove the worktree. Continue?",
    );
    expect(ctx.ui.notify).toHaveBeenCalledWith("Merge cancelled", "info");
    expect(gitExec).not.toHaveBeenCalled();
  });

  // ── 4. Clean worktree — skips auto-commit ───────────────────────
  it("clean worktree → skips auto-commit, merges and removes worktree", async () => {
    const pi = createMockAPI().api;
    const ctx = createMockContext();

    vi.mocked(getWorktreeList).mockResolvedValueOnce(worktrees);
    vi.mocked(findWorktreeByBranch).mockReturnValueOnce(featureWorktree);
    vi.mocked(hasUncommittedChanges).mockResolvedValueOnce(false); // worktree clean
    vi.mocked(getMainWorktree).mockReturnValueOnce(mainWorktree);
    vi.mocked(hasUncommittedChanges).mockResolvedValueOnce(false); // main clean
    vi.mocked(gitExec)
      .mockResolvedValueOnce(successResult()) // checkout main
      .mockResolvedValueOnce(successResult("Merge made by the 'ort' strategy.")) // merge
      .mockResolvedValueOnce(successResult()) // worktree remove -f
      .mockResolvedValueOnce(successResult()); // worktree prune

    await handleWtMerge("feature", ctx, pi);

    // No auto-commit
    expect(autoCommitWithAIMessage).not.toHaveBeenCalled();

    // Checkout main
    expect(gitExec).toHaveBeenCalledWith(pi, ["checkout", MAIN_BRANCH], MAIN_REPO);

    // Merge
    expect(gitExec).toHaveBeenCalledWith(pi, ["merge", FEATURE_BRANCH], MAIN_REPO);

    // Remove worktree
    expect(gitExec).toHaveBeenCalledWith(pi, ["worktree", "remove", "-f", FEATURE_PATH], MAIN_REPO);

    // Prune
    expect(gitExec).toHaveBeenCalledWith(pi, ["worktree", "prune"], MAIN_REPO);

    // State updated
    expect(setCurrentBranch).toHaveBeenCalledWith(MAIN_BRANCH);
    expect(switchCwd).toHaveBeenCalledWith(pi, ctx, MAIN_REPO);
    expect(updateFooterStatus).toHaveBeenCalledWith(ctx);

    // Success notification
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Merged 'feature' into " + MAIN_BRANCH + " and removed worktree",
      "info",
    );
  });

  // ── 5. Dirty worktree — auto-commits with AI message ────────────
  it("dirty worktree → auto-commits with AI message, then merges", async () => {
    const pi = createMockAPI().api;
    const ctx = createMockContext();

    const commitMsg = "feat: add new feature";

    vi.mocked(getWorktreeList).mockResolvedValueOnce(worktrees);
    vi.mocked(findWorktreeByBranch).mockReturnValueOnce(featureWorktree);
    vi.mocked(hasUncommittedChanges).mockResolvedValueOnce(true); // worktree dirty
    vi.mocked(autoCommitWithAIMessage).mockResolvedValueOnce(commitMsg);
    vi.mocked(getMainWorktree).mockReturnValueOnce(mainWorktree);
    vi.mocked(hasUncommittedChanges).mockResolvedValueOnce(false); // main clean
    vi.mocked(gitExec)
      .mockResolvedValueOnce(successResult()) // checkout main
      .mockResolvedValueOnce(successResult()) // merge
      .mockResolvedValueOnce(successResult()) // worktree remove -f
      .mockResolvedValueOnce(successResult()); // worktree prune

    await handleWtMerge("feature", ctx, pi);

    // Auto-commit notification
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Auto-committing uncommitted changes in 'feature'...",
      "info",
    );
    expect(autoCommitWithAIMessage).toHaveBeenCalledWith(pi, FEATURE_PATH);
    expect(ctx.ui.notify).toHaveBeenCalledWith("Committed: " + commitMsg, "info");

    // Merge continues
    expect(gitExec).toHaveBeenCalledWith(pi, ["checkout", MAIN_BRANCH], MAIN_REPO);
    expect(gitExec).toHaveBeenCalledWith(pi, ["merge", FEATURE_BRANCH], MAIN_REPO);
    expect(gitExec).toHaveBeenCalledWith(pi, ["worktree", "remove", "-f", FEATURE_PATH], MAIN_REPO);
    expect(gitExec).toHaveBeenCalledWith(pi, ["worktree", "prune"], MAIN_REPO);
  });

  // ── 6. Merge conflict → error, worktree NOT deleted ─────────────
  it("merge conflict → error, worktree NOT deleted", async () => {
    const pi = createMockAPI().api;
    const ctx = createMockContext();

    vi.mocked(getWorktreeList).mockResolvedValueOnce(worktrees);
    vi.mocked(findWorktreeByBranch).mockReturnValueOnce(featureWorktree);
    vi.mocked(hasUncommittedChanges).mockResolvedValueOnce(false); // worktree clean
    vi.mocked(getMainWorktree).mockReturnValueOnce(mainWorktree);
    vi.mocked(hasUncommittedChanges).mockResolvedValueOnce(false); // main clean
    vi.mocked(gitExec)
      .mockResolvedValueOnce(successResult()) // checkout main succeeds
      .mockResolvedValueOnce(
        errorResult("CONFLICT (content): Merge conflict in file.txt", "Auto-merging file.txt"),
      ); // merge fails

    await handleWtMerge("feature", ctx, pi);

    // Error notification
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Merge has conflicts. Run `git merge --abort` to cancel, or resolve conflicts and commit. The worktree has NOT been removed.",
      "error",
    );

    // Worktree remove NOT called
    expect(gitExec).not.toHaveBeenCalledWith(
      pi,
      ["worktree", "remove", "-f", FEATURE_PATH],
      MAIN_REPO,
    );
    // Prune NOT called
    expect(gitExec).not.toHaveBeenCalledWith(pi, ["worktree", "prune"], MAIN_REPO);
    // State NOT updated
    expect(setCurrentBranch).not.toHaveBeenCalled();
    expect(switchCwd).not.toHaveBeenCalled();
  });

  // ── 7. Worktree remove fails — warning, continues to prune ──────
  it("worktree remove fails after successful merge → warning, continues to prune", async () => {
    const pi = createMockAPI().api;
    const ctx = createMockContext();

    vi.mocked(getWorktreeList).mockResolvedValueOnce(worktrees);
    vi.mocked(findWorktreeByBranch).mockReturnValueOnce(featureWorktree);
    vi.mocked(hasUncommittedChanges).mockResolvedValueOnce(false); // worktree clean
    vi.mocked(getMainWorktree).mockReturnValueOnce(mainWorktree);
    vi.mocked(hasUncommittedChanges).mockResolvedValueOnce(false); // main clean
    vi.mocked(gitExec)
      .mockResolvedValueOnce(successResult()) // checkout main
      .mockResolvedValueOnce(successResult()) // merge
      .mockResolvedValueOnce(errorResult("worktree is locked")) // worktree remove fails
      .mockResolvedValueOnce(successResult()); // prune still called

    await handleWtMerge("feature", ctx, pi);

    // Warning notification about remove failure
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Merged but failed to remove worktree: worktree is locked",
      "warning",
    );

    // Prune IS still called
    expect(gitExec).toHaveBeenCalledWith(pi, ["worktree", "prune"], MAIN_REPO);

    // State still updated
    expect(setCurrentBranch).toHaveBeenCalledWith(MAIN_BRANCH);
    expect(switchCwd).toHaveBeenCalledWith(pi, ctx, MAIN_REPO);

    // Final success notification still sent
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Merged 'feature' into " + MAIN_BRANCH + " and removed worktree",
      "info",
    );
  });

  // ── 8. With explicit branch name arg ────────────────────────────
  it("explicit branch name arg → uses provided branch", async () => {
    const pi = createMockAPI().api;
    const ctx = createMockContext();

    const bugfixBranch = "bugfix";
    const bugfixPath = "/repo/.git/worktrees/bugfix";
    const bugfixWorktree: WorktreeInfo = {
      path: bugfixPath,
      head: "ghi789",
      branch: "refs/heads/bugfix",
      branchName: bugfixBranch,
    };
    const allWorktrees: WorktreeInfo[] = [mainWorktree, featureWorktree, bugfixWorktree];

    vi.mocked(getWorktreeList).mockResolvedValueOnce(allWorktrees);
    vi.mocked(findWorktreeByBranch).mockReturnValueOnce(bugfixWorktree);
    vi.mocked(hasUncommittedChanges).mockResolvedValueOnce(false); // worktree clean
    vi.mocked(getMainWorktree).mockReturnValueOnce(mainWorktree);
    vi.mocked(hasUncommittedChanges).mockResolvedValueOnce(false); // main clean
    vi.mocked(gitExec)
      .mockResolvedValueOnce(successResult()) // checkout main
      .mockResolvedValueOnce(successResult()) // merge
      .mockResolvedValueOnce(successResult()) // worktree remove -f
      .mockResolvedValueOnce(successResult()); // worktree prune

    await handleWtMerge("bugfix", ctx, pi);

    // findWorktreeByBranch called with explicit branch
    expect(findWorktreeByBranch).toHaveBeenCalledWith(allWorktrees, bugfixBranch);

    // Merge called with explicit branch
    expect(gitExec).toHaveBeenCalledWith(pi, ["merge", bugfixBranch], MAIN_REPO);

    // Remove called with bugfix worktree path
    expect(gitExec).toHaveBeenCalledWith(pi, ["worktree", "remove", "-f", bugfixPath], MAIN_REPO);

    // Success notification with explicit branch
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Merged 'bugfix' into " + MAIN_BRANCH + " and removed worktree",
      "info",
    );
  });

  // ── 9. Main worktree dirty → stashes and pops ──────────────────
  it("main worktree dirty → stashes before checkout and pops after merge", async () => {
    const pi = createMockAPI().api;
    const ctx = createMockContext();

    vi.mocked(getWorktreeList).mockResolvedValueOnce(worktrees);
    vi.mocked(findWorktreeByBranch).mockReturnValueOnce(featureWorktree);
    vi.mocked(hasUncommittedChanges)
      .mockResolvedValueOnce(false) // worktree clean
      .mockResolvedValueOnce(true); // main dirty
    vi.mocked(getMainWorktree).mockReturnValueOnce(mainWorktree);
    vi.mocked(gitExec)
      .mockResolvedValueOnce(successResult()) // git stash
      .mockResolvedValueOnce(successResult()) // checkout main
      .mockResolvedValueOnce(successResult()) // merge
      .mockResolvedValueOnce(successResult()) // git stash pop
      .mockResolvedValueOnce(successResult()) // worktree remove -f
      .mockResolvedValueOnce(successResult()); // worktree prune

    await handleWtMerge("feature", ctx, pi);

    // Warning about stashing
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Main worktree has uncommitted changes. Stashing before checkout...",
      "warning",
    );

    // Stash called
    expect(gitExec).toHaveBeenCalledWith(pi, ["stash"], MAIN_REPO);

    // Checkout called after stash
    expect(gitExec).toHaveBeenCalledWith(pi, ["checkout", MAIN_BRANCH], MAIN_REPO);

    // Merge called
    expect(gitExec).toHaveBeenCalledWith(pi, ["merge", FEATURE_BRANCH], MAIN_REPO);

    // Stash pop called after merge
    expect(gitExec).toHaveBeenCalledWith(pi, ["stash", "pop"], MAIN_REPO);

    // Worktree remove and prune still called
    expect(gitExec).toHaveBeenCalledWith(pi, ["worktree", "remove", "-f", FEATURE_PATH], MAIN_REPO);
    expect(gitExec).toHaveBeenCalledWith(pi, ["worktree", "prune"], MAIN_REPO);
  });

  // ── Checkout failure with stash → stash is popped ──────────────
  it("checkout fails and main was stashed → stash is popped", async () => {
    const pi = createMockAPI().api;
    const ctx = createMockContext();

    vi.mocked(getWorktreeList).mockResolvedValueOnce(worktrees);
    vi.mocked(findWorktreeByBranch).mockReturnValueOnce(featureWorktree);
    vi.mocked(hasUncommittedChanges)
      .mockResolvedValueOnce(false) // worktree clean
      .mockResolvedValueOnce(true); // main dirty
    vi.mocked(getMainWorktree).mockReturnValueOnce(mainWorktree);
    vi.mocked(gitExec)
      .mockResolvedValueOnce(successResult()) // git stash
      .mockResolvedValueOnce(errorResult("already on 'main'")); // checkout fails

    await handleWtMerge("feature", ctx, pi);

    // Checkout error
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Failed to checkout"),
      "error",
    );

    // Stash pop called on failure path
    expect(gitExec).toHaveBeenCalledWith(pi, ["stash", "pop"], MAIN_REPO);
  });

  // ── Merge failure with stash → stash is popped ─────────────────
  it("merge fails and main was stashed → stash is popped", async () => {
    const pi = createMockAPI().api;
    const ctx = createMockContext();

    vi.mocked(getWorktreeList).mockResolvedValueOnce(worktrees);
    vi.mocked(findWorktreeByBranch).mockReturnValueOnce(featureWorktree);
    vi.mocked(hasUncommittedChanges)
      .mockResolvedValueOnce(false) // worktree clean
      .mockResolvedValueOnce(true); // main dirty
    vi.mocked(getMainWorktree).mockReturnValueOnce(mainWorktree);
    vi.mocked(gitExec)
      .mockResolvedValueOnce(successResult()) // git stash
      .mockResolvedValueOnce(successResult()) // checkout main succeeds
      .mockResolvedValueOnce(errorResult("merge conflict")); // merge fails

    await handleWtMerge("feature", ctx, pi);

    // Merge error
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Merge has conflicts. Run `git merge --abort` to cancel, or resolve conflicts and commit. The worktree has NOT been removed.",
      "error",
    );

    // Stash pop called on failure path
    expect(gitExec).toHaveBeenCalledWith(pi, ["stash", "pop"], MAIN_REPO);
  });

  // ── Main repo path unknown → detects from cwd ──────────────────
  it("main repo path unknown → detects from cwd", async () => {
    const pi = createMockAPI().api;
    const ctx = createMockContext();

    vi.mocked(getMainRepoPath).mockReturnValueOnce("").mockReturnValue(MAIN_REPO);
    vi.mocked(detectMainRepo).mockResolvedValueOnce(MAIN_REPO);

    vi.mocked(getWorktreeList).mockResolvedValueOnce(worktrees);
    vi.mocked(findWorktreeByBranch).mockReturnValueOnce(featureWorktree);
    vi.mocked(hasUncommittedChanges).mockResolvedValueOnce(false); // worktree clean
    vi.mocked(getMainWorktree).mockReturnValueOnce(mainWorktree);
    vi.mocked(hasUncommittedChanges).mockResolvedValueOnce(false); // main clean
    vi.mocked(gitExec)
      .mockResolvedValueOnce(successResult()) // checkout main
      .mockResolvedValueOnce(successResult()) // merge
      .mockResolvedValueOnce(successResult()) // worktree remove -f
      .mockResolvedValueOnce(successResult()); // worktree prune

    await handleWtMerge("feature", ctx, pi);

    expect(detectMainRepo).toHaveBeenCalledWith(pi, ctx.cwd);
    expect(setMainRepoPath).toHaveBeenCalledWith(MAIN_REPO);
  });

  // ── Main repo path unknown and detection fails → error ─────────
  it("main repo detection fails → error notification", async () => {
    const pi = createMockAPI().api;
    const ctx = createMockContext();

    vi.mocked(getMainRepoPath).mockReturnValueOnce("");
    vi.mocked(detectMainRepo).mockResolvedValueOnce(null);

    await handleWtMerge("feature", ctx, pi);

    expect(ctx.ui.notify).toHaveBeenCalledWith("Not inside a git repository", "error");
  });
});
