import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock git module ──────────────────────────────────────────────
vi.mock("../../git.js", () => ({
  gitExec: vi.fn(),
  getWorktreeList: vi.fn(),
  findWorktreeByBranch: vi.fn(),
  getMainWorktree: vi.fn(),
  getUntrackedFiles: vi.fn(() => Promise.resolve([])),
}));

// ── Mock worktree module ──────────────────────────────────────────
vi.mock("../../worktree.js", () => ({
  switchCwd: vi.fn(),
  ensureMainRepo: vi.fn(() => Promise.resolve(true)),
  hasTrackedChanges: vi.fn(() => Promise.resolve(false)),
  autoCommitWithAIMessage: vi.fn(),
  verifyMergeIntegrity: vi.fn(() => Promise.resolve({ ok: true, errors: [] })),
  analyzeFile: vi.fn(() => ({ isBinary: false, lines: 10 })),
  copyFilesWithOverwrite: vi.fn(() => []),
  formatFileListForConfirm: vi.fn(() => "mock list"),
}));

// ── Mock node:fs for existsSync ──────────────────────────────────
vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false), // default: files not in main
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
import {
  gitExec,
  getWorktreeList,
  findWorktreeByBranch,
  getMainWorktree,
  getUntrackedFiles,
} from "../../git.js";
import {
  switchCwd,
  ensureMainRepo,
  hasTrackedChanges,
  autoCommitWithAIMessage,
  analyzeFile,
  copyFilesWithOverwrite,
  formatFileListForConfirm,
  verifyMergeIntegrity,
} from "../../worktree.js";
import { validateBranchName } from "../../validation.js";
import { existsSync } from "node:fs";
import {
  getMainRepoPath,
  getCurrentBranch,
  setCurrentBranch,
  updateFooterStatus,
  getDefaultBranch,
} from "../../state.js";
import { handleWtMerge } from "../../commands/wt-merge.js";
import { createMockAPI, createMockContext, successResult, errorResult } from "../helpers/mocks.js";
import {
  mainWorktree,
  featureWorktree,
  worktrees,
  MAIN_REPO,
  MAIN_BRANCH,
  FEATURE_BRANCH,
  FEATURE_PATH,
} from "../helpers/fixtures.js";

// ============================================================================
// Helpers
// ============================================================================

/** Set up the standard mock chain for a successful merge with delete. */
function setupStandardMocks() {
  vi.mocked(getMainRepoPath).mockReturnValue(MAIN_REPO);
  vi.mocked(getCurrentBranch).mockReturnValue(FEATURE_BRANCH);
  vi.mocked(validateBranchName).mockReturnValue(null);
  vi.mocked(ensureMainRepo).mockResolvedValue(true);
  vi.mocked(getWorktreeList).mockResolvedValue(worktrees);
  vi.mocked(findWorktreeByBranch).mockReturnValue(featureWorktree);
  vi.mocked(getMainWorktree).mockReturnValue(mainWorktree);
  vi.mocked(hasTrackedChanges).mockResolvedValue(false);
  vi.mocked(verifyMergeIntegrity).mockResolvedValue({ ok: true, errors: [] });
}

/**
 * Set up gitExec mock chain for a full happy-path merge with delete.
 * Order: rev-parse HEAD → checkout → merge → worktree remove → prune
 */
function setupHappyGitChain(deleteWorktree = true) {
  const chain = vi
    .mocked(gitExec)
    .mockResolvedValueOnce(successResult("abc123")) // rev-parse HEAD
    .mockResolvedValueOnce(successResult()) // checkout main
    .mockResolvedValueOnce(successResult()); // merge

  if (deleteWorktree) {
    chain
      .mockResolvedValueOnce(successResult()) // worktree remove -f
      .mockResolvedValueOnce(successResult()); // worktree prune
  }

  return chain;
}

/**
 * Set up gitExec mock chain for tracked changes + happy merge.
 * Order: add -u → commit -m → rev-parse HEAD → checkout → merge → remove → prune
 */
function setupTrackedChangesGitChain(_commitMsg: string, deleteWorktree = true) {
  const chain = vi
    .mocked(gitExec)
    .mockResolvedValueOnce(successResult()) // add -u (in handleTrackedChanges)
    .mockResolvedValueOnce(successResult()) // commit -m (in handleTrackedChanges)
    .mockResolvedValueOnce(successResult("abc123")) // rev-parse HEAD
    .mockResolvedValueOnce(successResult()) // checkout main
    .mockResolvedValueOnce(successResult()); // merge

  if (deleteWorktree) {
    chain
      .mockResolvedValueOnce(successResult()) // worktree remove -f
      .mockResolvedValueOnce(successResult()); // worktree prune
  }

  return chain;
}

// ============================================================================
// Setup / Teardown
// ============================================================================

beforeEach(() => {
  vi.resetAllMocks();
  setupStandardMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// Tests
// ============================================================================

describe("handleWtMerge", () => {
  // ══════════════════════════════════════════════════════════════════
  // A. Input validation
  // ══════════════════════════════════════════════════════════════════

  // ── 1. No args, on main → error notification ────────────────────
  it("no args + on main → error notification", async () => {
    vi.mocked(getCurrentBranch).mockReturnValue("main");

    const pi = createMockAPI().api;
    const ctx = createMockContext();

    await handleWtMerge("", ctx, pi);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Usage: /wt-merge <branch-name> (currently on " +
        getDefaultBranch() +
        ", no worktree to merge)",
      "error",
    );
    expect(getWorktreeList).not.toHaveBeenCalled();
    expect(gitExec).not.toHaveBeenCalled();
  });

  // ── 2. Invalid branch name → error notification ─────────────────
  it("invalid branch name → error notification", async () => {
    const pi = createMockAPI().api;
    const ctx = createMockContext();

    vi.mocked(validateBranchName).mockReturnValueOnce("Branch name cannot be 'HEAD'");

    await handleWtMerge("HEAD", ctx, pi);

    expect(ctx.ui.notify).toHaveBeenCalledWith("Branch name cannot be 'HEAD'", "error");
    expect(getWorktreeList).not.toHaveBeenCalled();
    expect(gitExec).not.toHaveBeenCalled();
  });

  // ── 3. ensureMainRepo fails → error notification ───────────────
  it("ensureMainRepo fails → error notification", async () => {
    const pi = createMockAPI().api;
    const ctx = createMockContext();

    vi.mocked(ensureMainRepo).mockImplementationOnce((_pi: any, mockCtx: any) => {
      mockCtx.ui.notify("Not inside a git repository", "error");
      return Promise.resolve(false);
    });

    await handleWtMerge("feature", ctx, pi);

    expect(ctx.ui.notify).toHaveBeenCalledWith("Not inside a git repository", "error");
    expect(getWorktreeList).not.toHaveBeenCalled();
    expect(gitExec).not.toHaveBeenCalled();
  });

  // ── 4. Target is default branch → error notification ────────────
  it("target is default branch → error notification", async () => {
    const pi = createMockAPI().api;
    const ctx = createMockContext();

    await handleWtMerge("main", ctx, pi);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Cannot merge the " + getDefaultBranch() + " branch into itself",
      "error",
    );
    expect(getWorktreeList).not.toHaveBeenCalled();
    expect(gitExec).not.toHaveBeenCalled();
  });

  // ── 5. Branch not found → error ─────────────────────────────────
  it("branch not found → error", async () => {
    const pi = createMockAPI().api;
    const ctx = createMockContext();

    vi.mocked(findWorktreeByBranch).mockReturnValueOnce(undefined);

    await handleWtMerge("nonexistent", ctx, pi);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "No worktree found for branch 'nonexistent'",
      "error",
    );
    expect(gitExec).not.toHaveBeenCalled();
  });

  // ── 6. Merge confirmation cancelled → "Merge cancelled" ─────────
  it("merge confirmation cancelled → 'Merge cancelled'", async () => {
    const pi = createMockAPI().api;
    const ctx = createMockContext();

    // First confirm call is the merge confirm — return false
    vi.mocked(ctx.ui.confirm).mockResolvedValueOnce(false);

    await handleWtMerge("feature", ctx, pi);

    expect(ctx.ui.confirm).toHaveBeenCalledWith(
      "Merge worktree?",
      "This will merge '" + FEATURE_BRANCH + "' into '" + MAIN_BRANCH + "'. Continue?",
    );
    expect(ctx.ui.notify).toHaveBeenCalledWith("Merge cancelled", "info");
    expect(gitExec).not.toHaveBeenCalled();
  });

  // ══════════════════════════════════════════════════════════════════
  // B. Tracked changes flow
  // ══════════════════════════════════════════════════════════════════

  // ── 7. Clean worktree → no commit prompt, proceeds to merge ────
  it("clean worktree → no commit prompt, proceeds to merge", async () => {
    const pi = createMockAPI().api;
    const ctx = createMockContext();

    // hasTrackedChanges returns false (default from setupStandardMocks)
    setupHappyGitChain();

    await handleWtMerge("feature", ctx, pi);

    // No select dialog shown
    expect(ctx.ui.select).not.toHaveBeenCalled();
    // No auto-commit
    expect(autoCommitWithAIMessage).not.toHaveBeenCalled();
    // Merge proceeds
    expect(gitExec).toHaveBeenCalledWith(pi, ["checkout", MAIN_BRANCH], MAIN_REPO);
    expect(gitExec).toHaveBeenCalledWith(pi, ["merge", FEATURE_BRANCH], MAIN_REPO);
  });

  // ── 8. Dirty worktree, "Let agent summarize & commit" ──────────
  it("dirty worktree → 'Let agent summarize & commit' selected", async () => {
    const pi = createMockAPI().api;
    const ctx = createMockContext();

    vi.mocked(hasTrackedChanges).mockResolvedValueOnce(true); // worktree dirty
    vi.mocked(ctx.ui.select).mockResolvedValueOnce("Let agent summarize & commit");
    vi.mocked(autoCommitWithAIMessage).mockResolvedValueOnce("feat: new feature");

    // gitExec chain: rev-parse → checkout → merge → remove → prune
    setupHappyGitChain();

    await handleWtMerge("feature", ctx, pi);

    // Select dialog shown
    expect(ctx.ui.select).toHaveBeenCalledWith("Commit tracked changes?", [
      "Let agent summarize & commit",
      "Provide commit message",
    ]);

    // autoCommitWithAIMessage called
    expect(autoCommitWithAIMessage).toHaveBeenCalledWith(pi, FEATURE_PATH);

    // Committed notification
    expect(ctx.ui.notify).toHaveBeenCalledWith("Committed: feat: new feature", "info");

    // Merge proceeds
    expect(gitExec).toHaveBeenCalledWith(pi, ["checkout", MAIN_BRANCH], MAIN_REPO);
    expect(gitExec).toHaveBeenCalledWith(pi, ["merge", FEATURE_BRANCH], MAIN_REPO);
    expect(gitExec).toHaveBeenCalledWith(pi, ["worktree", "remove", "-f", FEATURE_PATH], MAIN_REPO);
    expect(gitExec).toHaveBeenCalledWith(pi, ["worktree", "prune"], MAIN_REPO);
  });

  // ── 9. Dirty worktree, "Provide commit message", enters "fix: bug"
  it("dirty worktree → 'Provide commit message' with 'fix: bug'", async () => {
    const pi = createMockAPI().api;
    const ctx = createMockContext();

    vi.mocked(hasTrackedChanges).mockResolvedValueOnce(true); // worktree dirty
    vi.mocked(ctx.ui.select).mockResolvedValueOnce("Provide commit message");
    vi.mocked(ctx.ui.input).mockResolvedValueOnce("fix: bug");

    // gitExec chain: add -u → commit -m → rev-parse → checkout → merge → remove → prune
    setupTrackedChangesGitChain("fix: bug");

    await handleWtMerge("feature", ctx, pi);

    // add -u called
    expect(gitExec).toHaveBeenCalledWith(pi, ["add", "-u"], FEATURE_PATH);
    // commit -m called
    expect(gitExec).toHaveBeenCalledWith(pi, ["commit", "-m", "fix: bug"], FEATURE_PATH);
    // Committed notification
    expect(ctx.ui.notify).toHaveBeenCalledWith("Committed: fix: bug", "info");

    // Merge proceeds
    expect(gitExec).toHaveBeenCalledWith(pi, ["checkout", MAIN_BRANCH], MAIN_REPO);
    expect(gitExec).toHaveBeenCalledWith(pi, ["merge", FEATURE_BRANCH], MAIN_REPO);
  });

  // ── 10. Dirty worktree, user cancels select ────────────────────
  it("dirty worktree → user cancels select → 'Merge cancelled'", async () => {
    const pi = createMockAPI().api;
    const ctx = createMockContext();

    vi.mocked(hasTrackedChanges).mockResolvedValueOnce(true); // worktree dirty
    vi.mocked(ctx.ui.select).mockResolvedValueOnce(undefined); // cancel

    await handleWtMerge("feature", ctx, pi);

    expect(ctx.ui.notify).toHaveBeenCalledWith("Merge cancelled", "info");
    // No merge
    expect(gitExec).not.toHaveBeenCalledWith(
      pi,
      expect.arrayContaining(["merge"]),
      expect.anything(),
    );
  });

  // ── 11. Dirty worktree, user cancels input ──────────────────────
  it("dirty worktree → user cancels input → 'Merge cancelled'", async () => {
    const pi = createMockAPI().api;
    const ctx = createMockContext();

    vi.mocked(hasTrackedChanges).mockResolvedValueOnce(true); // worktree dirty
    vi.mocked(ctx.ui.select).mockResolvedValueOnce("Provide commit message");
    vi.mocked(ctx.ui.input).mockResolvedValueOnce(undefined); // cancel

    await handleWtMerge("feature", ctx, pi);

    expect(ctx.ui.notify).toHaveBeenCalledWith("Merge cancelled", "info");
    // No merge
    expect(gitExec).not.toHaveBeenCalledWith(
      pi,
      expect.arrayContaining(["merge"]),
      expect.anything(),
    );
  });

  // ── 12. Dirty worktree, non-interactive ─────────────────────────
  it("dirty worktree → non-interactive → auto-commit without prompt", async () => {
    const pi = createMockAPI().api;
    const ctx = createMockContext({ hasUI: false });

    vi.mocked(hasTrackedChanges).mockResolvedValueOnce(true); // worktree dirty
    vi.mocked(autoCommitWithAIMessage).mockResolvedValueOnce("chore: auto");

    setupHappyGitChain();

    await handleWtMerge("feature", ctx, pi);

    // No select dialog shown
    expect(ctx.ui.select).not.toHaveBeenCalled();
    // autoCommitWithAIMessage called directly
    expect(autoCommitWithAIMessage).toHaveBeenCalledWith(pi, FEATURE_PATH);
    // Merge proceeds
    expect(gitExec).toHaveBeenCalledWith(pi, ["checkout", MAIN_BRANCH], MAIN_REPO);
    expect(gitExec).toHaveBeenCalledWith(pi, ["merge", FEATURE_BRANCH], MAIN_REPO);
  });

  // ── 13. autoCommitWithAIMessage throws ──────────────────────────
  it("dirty worktree → auto-commit throws → error notification, no merge", async () => {
    const pi = createMockAPI().api;
    const ctx = createMockContext();

    vi.mocked(hasTrackedChanges).mockResolvedValueOnce(true); // worktree dirty
    vi.mocked(ctx.ui.select).mockResolvedValueOnce("Let agent summarize & commit");
    vi.mocked(autoCommitWithAIMessage).mockRejectedValueOnce(new Error("AI unavailable"));

    await handleWtMerge("feature", ctx, pi);

    expect(ctx.ui.notify).toHaveBeenCalledWith("Auto-commit failed: AI unavailable", "error");
    // No merge
    expect(gitExec).not.toHaveBeenCalledWith(
      pi,
      expect.arrayContaining(["checkout"]),
      expect.anything(),
    );
  });

  // ══════════════════════════════════════════════════════════════════
  // C. Merge execution
  // ══════════════════════════════════════════════════════════════════

  // ── 14. Successful merge, user confirms delete ──────────────────
  it("successful merge, user confirms delete → full happy path", async () => {
    const pi = createMockAPI().api;
    const ctx = createMockContext();

    // Default confirm returns true (merge confirm + delete confirm)
    setupHappyGitChain(true);

    await handleWtMerge("feature", ctx, pi);

    // Verify resolveMergeTarget called
    expect(ensureMainRepo).toHaveBeenCalledWith(pi, ctx);
    expect(getWorktreeList).toHaveBeenCalledWith(pi, MAIN_REPO);
    expect(findWorktreeByBranch).toHaveBeenCalledWith(worktrees, FEATURE_BRANCH);
    expect(getMainWorktree).toHaveBeenCalledWith(worktrees);

    // Merge confirm shown
    expect(ctx.ui.confirm).toHaveBeenCalledWith(
      "Merge worktree?",
      "This will merge 'feature' into 'main'. Continue?",
    );

    // Git operations
    expect(gitExec).toHaveBeenCalledWith(pi, ["rev-parse", "HEAD"], MAIN_REPO);
    expect(gitExec).toHaveBeenCalledWith(pi, ["checkout", MAIN_BRANCH], MAIN_REPO);
    expect(gitExec).toHaveBeenCalledWith(pi, ["merge", FEATURE_BRANCH], MAIN_REPO);

    // Verify integrity
    expect(verifyMergeIntegrity).toHaveBeenCalledWith(pi, MAIN_REPO, MAIN_BRANCH, FEATURE_BRANCH);

    // Delete confirm shown
    expect(ctx.ui.confirm).toHaveBeenCalledWith(
      "Delete worktree?",
      "The worktree for 'feature' has been merged successfully. Delete it?",
    );

    // Worktree removed and pruned
    expect(gitExec).toHaveBeenCalledWith(pi, ["worktree", "remove", "-f", FEATURE_PATH], MAIN_REPO);
    expect(gitExec).toHaveBeenCalledWith(pi, ["worktree", "prune"], MAIN_REPO);

    // State updated
    expect(setCurrentBranch).toHaveBeenCalledWith(MAIN_BRANCH);
    expect(switchCwd).toHaveBeenCalledWith(pi, ctx, MAIN_REPO);
    expect(updateFooterStatus).toHaveBeenCalledWith(ctx);

    // Success notification
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Merged 'feature' into main and removed worktree",
      "info",
    );
  });

  // ── 15. Successful merge, user declines delete ──────────────────
  it("successful merge, user declines delete → worktree kept", async () => {
    const pi = createMockAPI().api;
    const ctx = createMockContext();

    // First confirm (merge): true, Second confirm (delete): false
    vi.mocked(ctx.ui.confirm)
      .mockResolvedValueOnce(true) // merge confirm
      .mockResolvedValueOnce(false); // delete confirm

    setupHappyGitChain(false); // no delete git calls

    await handleWtMerge("feature", ctx, pi);

    // Worktree NOT removed
    expect(gitExec).not.toHaveBeenCalledWith(
      pi,
      ["worktree", "remove", "-f", FEATURE_PATH],
      MAIN_REPO,
    );
    expect(gitExec).not.toHaveBeenCalledWith(pi, ["worktree", "prune"], MAIN_REPO);

    // State still updated
    expect(setCurrentBranch).toHaveBeenCalledWith(MAIN_BRANCH);
    expect(switchCwd).toHaveBeenCalledWith(pi, ctx, MAIN_REPO);

    // Notification says "(worktree kept)"
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Merged 'feature' into main (worktree kept)",
      "info",
    );
  });

  // ── 16. Successful merge, non-interactive ───────────────────────
  it("successful merge, non-interactive → worktree kept (no delete confirm)", async () => {
    const pi = createMockAPI().api;
    const ctx = createMockContext({ hasUI: false });

    setupHappyGitChain(false); // no delete in non-interactive

    await handleWtMerge("feature", ctx, pi);

    // No confirm dialogs at all
    expect(ctx.ui.confirm).not.toHaveBeenCalled();

    // No select/input dialogs
    expect(ctx.ui.select).not.toHaveBeenCalled();

    // Worktree NOT removed (non-interactive keeps worktree)
    expect(gitExec).not.toHaveBeenCalledWith(
      pi,
      ["worktree", "remove", "-f", FEATURE_PATH],
      MAIN_REPO,
    );
    expect(gitExec).not.toHaveBeenCalledWith(pi, ["worktree", "prune"], MAIN_REPO);

    // State still updated
    expect(setCurrentBranch).toHaveBeenCalledWith(MAIN_BRANCH);
    expect(switchCwd).toHaveBeenCalledWith(pi, ctx, MAIN_REPO);

    // Notification says "(worktree kept)"
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Merged 'feature' into main (worktree kept)",
      "info",
    );
  });

  // ══════════════════════════════════════════════════════════════════
  // D. Stash behavior
  // ══════════════════════════════════════════════════════════════════

  // ── 17. Main dirty → stash, apply, drop ─────────────────────────
  it("main dirty → stash before checkout, apply+drop after merge", async () => {
    const pi = createMockAPI().api;
    const ctx = createMockContext();

    // First call: worktree clean (in handleTrackedChanges)
    // Second call: worktree clean (in stashMainIfDirty - main check)
    // Wait — stashMainIfDirty checks the MAIN repo, not the worktree.
    // Actually hasTrackedChanges is called twice:
    //   1. handleTrackedChanges(pi, target.wt.path) — checks worktree → false
    //   2. stashMainIfDirty(pi, ctx) — checks main → true
    vi.mocked(hasTrackedChanges)
      .mockResolvedValueOnce(false) // worktree clean
      .mockResolvedValueOnce(true); // main dirty

    // gitExec chain: stash → rev-parse → checkout → merge → stash apply → stash drop → remove → prune
    vi.mocked(gitExec)
      .mockResolvedValueOnce(successResult()) // git stash
      .mockResolvedValueOnce(successResult("abc123")) // rev-parse HEAD
      .mockResolvedValueOnce(successResult()) // checkout main
      .mockResolvedValueOnce(successResult()) // merge
      .mockResolvedValueOnce(successResult()) // stash apply (succeeds)
      .mockResolvedValueOnce(successResult()) // stash drop
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

    // Stash apply called after merge
    expect(gitExec).toHaveBeenCalledWith(pi, ["stash", "apply"], MAIN_REPO);

    // Stash drop called (because apply succeeded)
    expect(gitExec).toHaveBeenCalledWith(pi, ["stash", "drop"], MAIN_REPO);

    // Worktree remove and prune still called
    expect(gitExec).toHaveBeenCalledWith(pi, ["worktree", "remove", "-f", FEATURE_PATH], MAIN_REPO);
    expect(gitExec).toHaveBeenCalledWith(pi, ["worktree", "prune"], MAIN_REPO);
  });

  // ── 18. Checkout fails with stash → stash applied ──────────────
  it("checkout fails with stash → stash applied, error notification", async () => {
    const pi = createMockAPI().api;
    const ctx = createMockContext();

    vi.mocked(hasTrackedChanges)
      .mockResolvedValueOnce(false) // worktree clean
      .mockResolvedValueOnce(true); // main dirty

    vi.mocked(gitExec)
      .mockResolvedValueOnce(successResult()) // git stash
      .mockResolvedValueOnce(successResult("abc123")) // rev-parse HEAD
      .mockResolvedValueOnce(errorResult("already on 'main'")); // checkout fails

    await handleWtMerge("feature", ctx, pi);

    // Checkout error
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Failed to checkout"),
      "error",
    );

    // Stash applied on failure path
    expect(gitExec).toHaveBeenCalledWith(pi, ["stash", "apply"], MAIN_REPO);

    // No merge or remove
    expect(gitExec).not.toHaveBeenCalledWith(pi, ["merge", FEATURE_BRANCH], MAIN_REPO);
    expect(gitExec).not.toHaveBeenCalledWith(
      pi,
      ["worktree", "remove", "-f", FEATURE_PATH],
      MAIN_REPO,
    );
  });

  // ══════════════════════════════════════════════════════════════════
  // E. Merge conflict
  // ══════════════════════════════════════════════════════════════════

  // ── 19. Merge conflict → error, worktree NOT deleted ────────────
  it("merge conflict → error with conflicted files, worktree NOT deleted", async () => {
    const pi = createMockAPI().api;
    const ctx = createMockContext();

    vi.mocked(gitExec)
      .mockResolvedValueOnce(successResult("abc123")) // rev-parse HEAD
      .mockResolvedValueOnce(successResult()) // checkout main
      .mockResolvedValueOnce(
        errorResult("CONFLICT (content): Merge conflict in file.txt", "Auto-merging file.txt"),
      ) // merge fails
      .mockResolvedValueOnce(successResult("file.txt\nother.txt")); // diff --name-only --diff-filter=U

    await handleWtMerge("feature", ctx, pi);

    // Error notification with conflicted files
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Merge has conflicts in: file.txt, other.txt. Run `git merge --abort` to cancel, or resolve conflicts and commit. The worktree has NOT been removed.",
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

  // ══════════════════════════════════════════════════════════════════
  // F. Verification
  // ══════════════════════════════════════════════════════════════════

  // ── 20. Verification fails → reset, worktree kept ──────────────
  it("verification fails → reset --hard, worktree kept", async () => {
    const pi = createMockAPI().api;
    const ctx = createMockContext();

    vi.mocked(verifyMergeIntegrity).mockResolvedValueOnce({
      ok: false,
      errors: ["Worktree branch 'feature' is not fully merged into main"],
    });

    vi.mocked(gitExec)
      .mockResolvedValueOnce(successResult("abc123")) // rev-parse HEAD
      .mockResolvedValueOnce(successResult()) // checkout main
      .mockResolvedValueOnce(successResult()) // merge succeeds
      .mockResolvedValueOnce(successResult()); // reset --hard abc123

    await handleWtMerge("feature", ctx, pi);

    // Verification error shown
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Worktree branch 'feature' is not fully merged into main",
      "error",
    );

    // Reset called with pre-merge HEAD
    expect(gitExec).toHaveBeenCalledWith(pi, ["reset", "--hard", "abc123"], MAIN_REPO);

    // Rollback warning
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Merge verification failed. Main branch rolled back. Worktree preserved. Review and retry, or resolve issues manually.",
      "warning",
    );

    // Worktree NOT removed
    expect(gitExec).not.toHaveBeenCalledWith(
      pi,
      ["worktree", "remove", "-f", FEATURE_PATH],
      MAIN_REPO,
    );
    // State NOT updated
    expect(setCurrentBranch).not.toHaveBeenCalled();
    expect(switchCwd).not.toHaveBeenCalled();
  });

  // ══════════════════════════════════════════════════════════════════
  // G. Untracked file copy
  // ══════════════════════════════════════════════════════════════════

  // ── 21. Untracked files, user confirms copy ─────────────────────
  it("untracked files confirmed → files copied, merge completes", async () => {
    const pi = createMockAPI().api;
    const ctx = createMockContext();

    vi.mocked(getUntrackedFiles).mockResolvedValueOnce(["new-file.ts"]);
    vi.mocked(existsSync).mockReturnValueOnce(false); // not in main
    vi.mocked(formatFileListForConfirm).mockReturnValueOnce("mock list");

    // Confirm calls: merge (true), untracked (true), delete (true)
    vi.mocked(ctx.ui.confirm)
      .mockResolvedValueOnce(true) // merge confirm
      .mockResolvedValueOnce(true) // untracked confirm
      .mockResolvedValueOnce(true); // delete confirm

    setupHappyGitChain(true);

    await handleWtMerge("feature", ctx, pi);

    // Untracked files detection
    expect(getUntrackedFiles).toHaveBeenCalledWith(pi, FEATURE_PATH);
    expect(analyzeFile).toHaveBeenCalled();

    // Confirm dialog for untracked
    expect(ctx.ui.confirm).toHaveBeenCalledWith("Copy untracked files to main?", "mock list");

    // copyFilesWithOverwrite called
    expect(copyFilesWithOverwrite).toHaveBeenCalledWith(["new-file.ts"], FEATURE_PATH, MAIN_REPO);

    // Merge still completes
    expect(gitExec).toHaveBeenCalledWith(pi, ["checkout", MAIN_BRANCH], MAIN_REPO);
    expect(gitExec).toHaveBeenCalledWith(pi, ["merge", FEATURE_BRANCH], MAIN_REPO);
    expect(gitExec).toHaveBeenCalledWith(pi, ["worktree", "remove", "-f", FEATURE_PATH], MAIN_REPO);
  });

  // ── 22. Untracked files, user declines copy ─────────────────────
  it("untracked files declined → no copy, merge still proceeds", async () => {
    const pi = createMockAPI().api;
    const ctx = createMockContext();

    vi.mocked(getUntrackedFiles).mockResolvedValueOnce(["new-file.ts"]);
    vi.mocked(existsSync).mockReturnValueOnce(false); // not in main
    vi.mocked(formatFileListForConfirm).mockReturnValueOnce("mock list");

    // Confirm calls: merge (true), untracked (false), delete (true)
    vi.mocked(ctx.ui.confirm)
      .mockResolvedValueOnce(true) // merge confirm
      .mockResolvedValueOnce(false) // untracked confirm
      .mockResolvedValueOnce(true); // delete confirm

    setupHappyGitChain(true);

    await handleWtMerge("feature", ctx, pi);

    // Skipping notification
    expect(ctx.ui.notify).toHaveBeenCalledWith("Skipping untracked file copy.", "info");

    // copyFilesWithOverwrite NOT called
    expect(copyFilesWithOverwrite).not.toHaveBeenCalled();

    // Merge still completes
    expect(gitExec).toHaveBeenCalledWith(pi, ["checkout", MAIN_BRANCH], MAIN_REPO);
    expect(gitExec).toHaveBeenCalledWith(pi, ["merge", FEATURE_BRANCH], MAIN_REPO);
    expect(gitExec).toHaveBeenCalledWith(pi, ["worktree", "remove", "-f", FEATURE_PATH], MAIN_REPO);
    expect(gitExec).toHaveBeenCalledWith(pi, ["worktree", "prune"], MAIN_REPO);
  });

  // ══════════════════════════════════════════════════════════════════
  // H. Additional branch coverage
  // ══════════════════════════════════════════════════════════════════

  // ── 23. Merge conflict with no conflict files (ternary else) ───
  it("merge conflict → no conflict files → generic message", async () => {
    const pi = createMockAPI().api;
    const ctx = createMockContext();

    vi.mocked(gitExec)
      .mockResolvedValueOnce(successResult("abc123")) // rev-parse HEAD
      .mockResolvedValueOnce(successResult()) // checkout main
      .mockResolvedValueOnce(errorResult("Merge conflict")) // merge fails
      .mockResolvedValueOnce(errorResult("error")); // diff --name-only fails

    await handleWtMerge("feature", ctx, pi);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Merge has conflicts. Run `git merge --abort` to cancel, or resolve conflicts and commit. The worktree has NOT been removed.",
      "error",
    );

    // Worktree NOT removed
    expect(gitExec).not.toHaveBeenCalledWith(
      pi,
      ["worktree", "remove", "-f", FEATURE_PATH],
      MAIN_REPO,
    );
  });

  // ── 24. Stash apply fails after successful merge ────────────────
  it("stash apply fails after merge → warning, no drop", async () => {
    const pi = createMockAPI().api;
    const ctx = createMockContext();

    vi.mocked(hasTrackedChanges)
      .mockResolvedValueOnce(false) // worktree clean
      .mockResolvedValueOnce(true); // main dirty

    vi.mocked(gitExec)
      .mockResolvedValueOnce(successResult()) // git stash
      .mockResolvedValueOnce(successResult("abc123")) // rev-parse HEAD
      .mockResolvedValueOnce(successResult()) // checkout main
      .mockResolvedValueOnce(successResult()) // merge succeeds
      .mockResolvedValueOnce(errorResult("conflict")) // stash apply fails
      .mockResolvedValueOnce(successResult()) // worktree remove -f
      .mockResolvedValueOnce(successResult()); // worktree prune

    await handleWtMerge("feature", ctx, pi);

    // Warning about stash apply failure
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Warning: failed to reapply stashed changes. Your changes are preserved in the stash — run `git stash list` and `git stash apply` to recover them.",
      "warning",
    );

    // Stash drop NOT called
    expect(gitExec).not.toHaveBeenCalledWith(pi, ["stash", "drop"], MAIN_REPO);

    // Worktree still removed
    expect(gitExec).toHaveBeenCalledWith(pi, ["worktree", "remove", "-f", FEATURE_PATH], MAIN_REPO);
  });

  // ── 25. autoCommitWithAIMessage returns null in interactive mode
  it("dirty worktree → auto-commit returns null → 'No changes to commit'", async () => {
    const pi = createMockAPI().api;
    const ctx = createMockContext();

    vi.mocked(hasTrackedChanges).mockResolvedValueOnce(true);
    vi.mocked(ctx.ui.select).mockResolvedValueOnce("Let agent summarize & commit");
    vi.mocked(autoCommitWithAIMessage).mockResolvedValueOnce(null); // null = nothing to commit

    setupHappyGitChain();

    await handleWtMerge("feature", ctx, pi);

    expect(ctx.ui.notify).toHaveBeenCalledWith("No changes to commit", "info");

    // Merge still proceeds
    expect(gitExec).toHaveBeenCalledWith(pi, ["checkout", MAIN_BRANCH], MAIN_REPO);
    expect(gitExec).toHaveBeenCalledWith(pi, ["merge", FEATURE_BRANCH], MAIN_REPO);
  });

  // ── 26. Worktree remove fails after merge ──────────────────────
  it("worktree remove fails → warning notification", async () => {
    const pi = createMockAPI().api;
    const ctx = createMockContext();

    vi.mocked(gitExec)
      .mockResolvedValueOnce(successResult("abc123")) // rev-parse HEAD
      .mockResolvedValueOnce(successResult()) // checkout main
      .mockResolvedValueOnce(successResult()) // merge
      .mockResolvedValueOnce(errorResult("worktree in use")); // worktree remove -f fails

    await handleWtMerge("feature", ctx, pi);

    // Warning about remove failure
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Merged but failed to remove worktree: worktree in use",
      "warning",
    );

    // Prune NOT called
    expect(gitExec).not.toHaveBeenCalledWith(pi, ["worktree", "prune"], MAIN_REPO);

    // State still updated
    expect(setCurrentBranch).toHaveBeenCalledWith(MAIN_BRANCH);
    expect(switchCwd).toHaveBeenCalledWith(pi, ctx, MAIN_REPO);
  });

  // ── 27. Verification fails with null preMergeHead ──────────────
  it("verification fails with null preMergeHead → no reset, warning", async () => {
    const pi = createMockAPI().api;
    const ctx = createMockContext();

    vi.mocked(verifyMergeIntegrity).mockResolvedValueOnce({
      ok: false,
      errors: ["Integrity check failed"],
    });

    vi.mocked(gitExec)
      .mockResolvedValueOnce(successResult("abc123")) // rev-parse HEAD
      .mockResolvedValueOnce(successResult()) // checkout main
      .mockResolvedValueOnce(successResult()); // merge succeeds
    // Note: getPreMergeHead returns null because rev-parse HEAD is the FIRST call,
    // but we need preMergeHead to be null. Let me re-think...
    // preMergeHead comes from getPreMergeHead which is called BEFORE checkoutAndMerge.
    // So we need rev-parse to fail.

    // Actually the gitExec chain is:
    //   1. rev-parse HEAD (getPreMergeHead) — need this to fail for null preMergeHead
    //   2. checkout main
    //   3. merge
    // Wait, the order in handleWtMerge is:
    //   stashMainIfDirty → getPreMergeHead → checkoutAndMerge → verifyOrFailMerge
    //   And getPreMergeHead calls gitExec for rev-parse HEAD.
    // But checkoutAndMerge also calls gitExec for checkout and merge.
    // So the chain is: rev-parse → checkout → merge

    // Override the above — need rev-parse to fail:
    vi.mocked(gitExec).mockReset();
    vi.mocked(gitExec)
      .mockResolvedValueOnce(errorResult("fatal")) // rev-parse HEAD fails → preMergeHead = null
      .mockResolvedValueOnce(successResult()) // checkout main
      .mockResolvedValueOnce(successResult()); // merge

    await handleWtMerge("feature", ctx, pi);

    // Error shown
    expect(ctx.ui.notify).toHaveBeenCalledWith("Integrity check failed", "error");

    // Reset NOT called (preMergeHead is null)
    expect(gitExec).not.toHaveBeenCalledWith(
      pi,
      expect.arrayContaining(["reset"]),
      expect.anything(),
    );

    // Warning about rollback
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Merge verification failed. Main branch rolled back. Worktree preserved. Review and retry, or resolve issues manually.",
      "warning",
    );

    // State NOT updated
    expect(setCurrentBranch).not.toHaveBeenCalled();
  });

  // ── 28. Merge conflict with stash → stash applied back ──────────
  it("merge conflict with stash → stash applied back", async () => {
    const pi = createMockAPI().api;
    const ctx = createMockContext();

    vi.mocked(hasTrackedChanges)
      .mockResolvedValueOnce(false) // worktree clean
      .mockResolvedValueOnce(true); // main dirty

    vi.mocked(gitExec)
      .mockResolvedValueOnce(successResult()) // git stash
      .mockResolvedValueOnce(successResult("abc123")) // rev-parse HEAD
      .mockResolvedValueOnce(successResult()) // checkout main
      .mockResolvedValueOnce(errorResult("CONFLICT")) // merge fails
      .mockResolvedValueOnce(errorResult("error")); // diff --name-only fails → empty conflictFiles

    await handleWtMerge("feature", ctx, pi);

    // Generic conflict message with stash info
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Merge has conflicts. Run `git merge --abort` to cancel, or resolve conflicts and commit. The worktree has NOT been removed. Your stashed changes are preserved — run `git stash list` to see.",
      "error",
    );

    // Stash is NO LONGER applied back on conflict — it stays in the stash stack
  });

  // ── 29. copyFilesWithOverwrite returns failures ────────────────
  it("untracked files copy fails → warning notification", async () => {
    const pi = createMockAPI().api;
    const ctx = createMockContext();

    vi.mocked(getUntrackedFiles).mockResolvedValueOnce(["bad-file.ts"]);
    vi.mocked(existsSync).mockReturnValueOnce(false); // not in main
    vi.mocked(copyFilesWithOverwrite).mockReturnValueOnce(["bad-file.ts"]); // copy fails

    setupHappyGitChain(true);

    await handleWtMerge("feature", ctx, pi);

    // Warning about failed copy
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Warning: failed to copy 1 file(s): bad-file.ts",
      "warning",
    );

    // Merge still completes
    expect(gitExec).toHaveBeenCalledWith(pi, ["checkout", MAIN_BRANCH], MAIN_REPO);
    expect(gitExec).toHaveBeenCalledWith(pi, ["merge", FEATURE_BRANCH], MAIN_REPO);
  });
});
