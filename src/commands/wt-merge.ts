import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  gitExec,
  getWorktreeList,
  findWorktreeByBranch,
  getMainWorktree,
  getUntrackedFiles,
} from "../git.js";
import {
  switchCwd,
  ensureMainRepo,
  hasUncommittedChanges,
  autoCommitWithAIMessage,
  analyzeFile,
  copyFilesWithOverwrite,
  formatFileListForConfirm,
} from "../worktree.js";
import { validateBranchName } from "../validation.js";
import {
  getMainRepoPath,
  getCurrentBranch,
  setCurrentBranch,
  updateFooterStatus,
  getDefaultBranch,
} from "../state.js";
import type { UntrackedFileInfo } from "../types.js";

function resolveTargetBranch(args: string, ctx: ExtensionCommandContext): string | null {
  const targetArg = args.trim();
  const defaultBranch = getDefaultBranch();
  if (!targetArg && getCurrentBranch() === defaultBranch) {
    ctx.ui.notify(
      "Usage: /wt-merge <branch-name> (currently on " + defaultBranch + ", no worktree to merge)",
      "error",
    );
    return null;
  }
  return targetArg || getCurrentBranch();
}

async function stashMainIfDirty(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<boolean> {
  const mainDirty = await hasUncommittedChanges(pi, getMainRepoPath());
  if (!mainDirty) return false;

  ctx.ui.notify("Main worktree has uncommitted changes. Stashing before checkout...", "warning");
  await gitExec(pi, ["stash"], getMainRepoPath());
  return true;
}

async function checkoutAndMerge(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  mainBranch: string,
  targetBranch: string,
  didStash: boolean,
): Promise<boolean> {
  const checkoutResult = await gitExec(pi, ["checkout", mainBranch], getMainRepoPath());
  if (checkoutResult.code !== 0) {
    ctx.ui.notify(
      "Failed to checkout " + mainBranch + ": " + checkoutResult.stderr.trim(),
      "error",
    );
    if (didStash) {
      await gitExec(pi, ["stash", "pop"], getMainRepoPath());
    }
    return false;
  }

  const mergeResult = await gitExec(pi, ["merge", targetBranch], getMainRepoPath());
  if (mergeResult.code !== 0) {
    ctx.ui.notify(
      "Merge has conflicts. Run `git merge --abort` to cancel, or resolve conflicts and commit. The worktree has NOT been removed.",
      "error",
    );
    if (didStash) {
      await gitExec(pi, ["stash", "pop"], getMainRepoPath());
    }
    return false;
  }

  if (didStash) {
    await gitExec(pi, ["stash", "pop"], getMainRepoPath());
  }
  return true;
}

async function detectAndConfirmUntracked(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  worktreePath: string,
  mainRepoPath: string,
): Promise<string[]> {
  // 1. Get untracked files from worktree
  const untrackedFiles = await getUntrackedFiles(pi, worktreePath);
  if (untrackedFiles.length === 0) return [];

  // 2. Filter to files NOT present in main
  const filesNotInMain = untrackedFiles.filter((f) => !existsSync(join(mainRepoPath, f)));
  if (filesNotInMain.length === 0) return [];

  // 3. Analyze each file (line count, binary status)
  const fileInfos: UntrackedFileInfo[] = filesNotInMain.map((f) => {
    const analysis = analyzeFile(join(worktreePath, f));
    return { path: f, ...analysis };
  });

  // 4. Show confirmation dialog (if UI available)
  if (ctx.hasUI) {
    const message = formatFileListForConfirm(
      fileInfos,
      ctx.ui.theme as { fg: (color: string, text: string) => string },
    );
    const confirmed = await ctx.ui.confirm("Copy untracked files to main?", message);
    if (!confirmed) {
      ctx.ui.notify("Skipping untracked file copy.", "info");
      return [];
    }
  }

  // 5. Return the file paths to copy
  return filesNotInMain;
}

export async function handleWtMerge(
  args: string,
  ctx: ExtensionCommandContext,
  pi: ExtensionAPI,
): Promise<void> {
  // 1. Resolve target branch
  const targetBranch = resolveTargetBranch(args, ctx);
  if (targetBranch === null) return;

  // 1.5. Validate branch name
  const validationError = validateBranchName(targetBranch);
  if (validationError) {
    ctx.ui.notify(validationError, "error");
    return;
  }

  // 2. Ensure main repo path is known
  if (!(await ensureMainRepo(pi, ctx))) return;

  // 3. Guard: cannot merge the default branch into itself
  const currentDefaultBranch = getDefaultBranch();
  if (targetBranch === currentDefaultBranch) {
    ctx.ui.notify("Cannot merge the " + currentDefaultBranch + " branch into itself", "error");
    return;
  }

  // 4. Find the worktree for the target branch
  const worktrees = await getWorktreeList(pi, getMainRepoPath());
  const wt = findWorktreeByBranch(worktrees, targetBranch);
  if (!wt) {
    ctx.ui.notify("No worktree found for branch '" + targetBranch + "'", "error");
    return;
  }

  // 5. Confirm destructive operation
  if (ctx.hasUI) {
    const confirmed = await ctx.ui.confirm(
      "Merge and remove worktree?",
      "This will merge '" +
        targetBranch +
        "' into the default branch and remove the worktree. Continue?",
    );
    if (!confirmed) {
      ctx.ui.notify("Merge cancelled", "info");
      return;
    }
  }

  // 5.5. Detect untracked files for copy-back (before auto-commit makes them tracked)
  const filesToCopy = await detectAndConfirmUntracked(pi, ctx, wt.path, getMainRepoPath());

  // 6. Handle uncommitted changes in the worktree
  const dirty = await hasUncommittedChanges(pi, wt.path);
  if (dirty) {
    ctx.ui.notify("Auto-committing uncommitted changes in '" + targetBranch + "'...", "info");
    const commitMsg = await autoCommitWithAIMessage(pi, wt.path);
    ctx.ui.notify("Committed: " + commitMsg, "info");
  }

  // 7. Get the main branch name
  const mainWorktree = getMainWorktree(worktrees);
  const mainBranch = mainWorktree?.branchName ?? getDefaultBranch();

  // 8. Stash main worktree if dirty
  const didStash = await stashMainIfDirty(pi, ctx);

  // 9. Checkout main and merge
  const ok = await checkoutAndMerge(pi, ctx, mainBranch, targetBranch, didStash);
  if (!ok) return;

  // 9.5. Copy untracked files to main
  if (filesToCopy.length > 0) {
    const failed = copyFilesWithOverwrite(filesToCopy, wt.path, getMainRepoPath());
    if (failed.length > 0) {
      ctx.ui.notify(
        `Warning: failed to copy ${failed.length} file(s): ${failed.join(", ")}`,
        "warning",
      );
    }
  }

  // 10. Remove the worktree
  const removeResult = await gitExec(pi, ["worktree", "remove", "-f", wt.path], getMainRepoPath());
  if (removeResult.code !== 0) {
    ctx.ui.notify("Merged but failed to remove worktree: " + removeResult.stderr.trim(), "warning");
  }

  // 11. Prune stale worktree data
  await gitExec(pi, ["worktree", "prune"], getMainRepoPath());

  // 12. Update state and switch
  setCurrentBranch(mainBranch);
  switchCwd(pi, ctx, getMainRepoPath());
  updateFooterStatus(ctx);
  ctx.ui.notify(
    "Merged '" + targetBranch + "' into " + mainBranch + " and removed worktree",
    "info",
  );
}
