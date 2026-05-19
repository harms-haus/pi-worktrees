import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExecResult,
} from "@earendil-works/pi-coding-agent";
import { gitExec, getWorktreeList, findWorktreeByBranch } from "../git.js";
import { switchCwd, ensureMainRepo, hasUncommittedChanges } from "../worktree.js";
import { validateBranchName } from "../validation.js";
import {
  getMainRepoPath,
  getCurrentBranch,
  setCurrentBranch,
  updateFooterStatus,
  getDefaultBranch,
} from "../state.js";

function notifyBranchDeletion(
  ctx: ExtensionCommandContext,
  target: string,
  result: ExecResult,
): void {
  if (result.code === 0) {
    ctx.ui.notify("Branch '" + target + "' deleted", "info");
  } else {
    ctx.ui.notify(
      "Branch '" +
        target +
        "' was not fully merged and was kept. Use `git branch -D " +
        target +
        "` to force-delete.",
      "info",
    );
  }
}

export async function handleWtCleanup(
  args: string,
  ctx: ExtensionCommandContext,
  pi: ExtensionAPI,
): Promise<void> {
  // 1. Resolve target
  const targetArg = args.trim();
  const defaultBranch = getDefaultBranch();
  if (!targetArg && getCurrentBranch() === defaultBranch) {
    ctx.ui.notify(
      "Usage: /wt-cleanup <branch-name> (currently on " +
        defaultBranch +
        ", specify a worktree to clean up)",
      "error",
    );
    return;
  }
  const target = targetArg || getCurrentBranch();

  // 1.5. Validate branch name
  const validationError = validateBranchName(target);
  if (validationError) {
    ctx.ui.notify(validationError, "error");
    return;
  }

  // 2. Ensure main repo path is known
  if (!(await ensureMainRepo(pi, ctx))) return;

  // 3. Find the worktree
  if (target === defaultBranch) {
    ctx.ui.notify("Cannot remove the " + defaultBranch + " worktree", "error");
    return;
  }

  const worktrees = await getWorktreeList(pi, getMainRepoPath());
  const wt = findWorktreeByBranch(worktrees, target);
  if (!wt) {
    ctx.ui.notify("No worktree found for branch '" + target + "'", "error");
    return;
  }

  // 4. Check for uncommitted changes
  const dirty = await hasUncommittedChanges(pi, wt.path);
  if (dirty) {
    ctx.ui.notify(
      "Worktree '" +
        target +
        "' has uncommitted changes. Use /wt-merge to merge and clean up, or commit/stash your changes first.",
      "error",
    );
    return;
  }

  // 5. Confirm destructive operation
  if (ctx.hasUI) {
    const confirmed = await ctx.ui.confirm(
      "Remove worktree?",
      "This will force-remove the worktree for '" +
        target +
        "' and optionally delete its branch. This cannot be undone.",
    );
    if (!confirmed) {
      ctx.ui.notify("Cleanup cancelled", "info");
      return;
    }
  }

  // 6. Remove the worktree
  let removeResult = await gitExec(pi, ["worktree", "remove", "-f", wt.path], getMainRepoPath());
  if (removeResult.code !== 0) {
    // Try double-force for locked worktrees
    removeResult = await gitExec(
      pi,
      ["worktree", "remove", "-f", "-f", wt.path],
      getMainRepoPath(),
    );
    if (removeResult.code !== 0) {
      ctx.ui.notify("Failed to remove worktree: " + removeResult.stderr.trim(), "error");
      return;
    }
  }

  // 7. Prune stale worktree data
  await gitExec(pi, ["worktree", "prune"], getMainRepoPath());

  // 8. Optionally delete the branch (safe delete — only if merged)
  const branchResult = await gitExec(pi, ["branch", "-d", target], getMainRepoPath());
  notifyBranchDeletion(ctx, target, branchResult);

  // 9. Update state and switch to default branch if we were in that worktree
  if (getCurrentBranch() === target) {
    setCurrentBranch(defaultBranch);
    switchCwd(pi, ctx, getMainRepoPath());
  }
  updateFooterStatus(ctx);
  ctx.ui.notify("Cleaned up worktree '" + target + "'", "info");
}
