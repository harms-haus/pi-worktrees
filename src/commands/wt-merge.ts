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
  hasTrackedChanges,
  autoCommitWithAIMessage,
  analyzeFile,
  copyFilesWithOverwrite,
  formatFileListForConfirm,
  verifyMergeIntegrity,
} from "../worktree.js";
import { validateBranchName } from "../validation.js";
import {
  getMainRepoPath,
  getCurrentBranch,
  setCurrentBranch,
  updateFooterStatus,
  getDefaultBranch,
} from "../state.js";
import type { UntrackedFileInfo, WorktreeInfo } from "../types.js";

interface MergeTarget {
  branch: string;
  wt: WorktreeInfo;
  mainBranch: string;
}

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

async function resolveMergeTarget(
  args: string,
  ctx: ExtensionCommandContext,
  pi: ExtensionAPI,
): Promise<MergeTarget | null> {
  const targetBranch = resolveTargetBranch(args, ctx);
  if (targetBranch === null) return null;

  const validationError = validateBranchName(targetBranch);
  if (validationError) {
    ctx.ui.notify(validationError, "error");
    return null;
  }

  if (!(await ensureMainRepo(pi, ctx))) return null;

  const currentDefaultBranch = getDefaultBranch();
  if (targetBranch === currentDefaultBranch) {
    ctx.ui.notify("Cannot merge the " + currentDefaultBranch + " branch into itself", "error");
    return null;
  }

  const worktrees = await getWorktreeList(pi, getMainRepoPath());
  const wt = findWorktreeByBranch(worktrees, targetBranch);
  if (!wt) {
    ctx.ui.notify("No worktree found for branch '" + targetBranch + "'", "error");
    return null;
  }

  const mainWorktree = getMainWorktree(worktrees);
  const mainBranch = mainWorktree?.branchName ?? getDefaultBranch();

  return { branch: targetBranch, wt, mainBranch };
}

async function stashMainIfDirty(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<boolean> {
  const mainDirty = await hasTrackedChanges(pi, getMainRepoPath());
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
): Promise<{ ok: boolean; conflictFiles?: string[] }> {
  const checkoutResult = await gitExec(pi, ["checkout", mainBranch], getMainRepoPath());
  if (checkoutResult.code !== 0) {
    ctx.ui.notify(
      "Failed to checkout " + mainBranch + ": " + checkoutResult.stderr.trim(),
      "error",
    );
    if (didStash) {
      await gitExec(pi, ["stash", "apply"], getMainRepoPath());
    }
    return { ok: false };
  }

  const mergeResult = await gitExec(pi, ["merge", targetBranch], getMainRepoPath());
  if (mergeResult.code !== 0) {
    // Get conflicted files
    const conflictResult = await gitExec(
      pi,
      ["diff", "--name-only", "--diff-filter=U"],
      getMainRepoPath(),
    );
    const conflictFiles =
      conflictResult.code === 0 ? conflictResult.stdout.trim().split("\n").filter(Boolean) : [];

    let message =
      conflictFiles.length > 0
        ? "Merge has conflicts in: " +
          conflictFiles.join(", ") +
          ". Run `git merge --abort` to cancel, or resolve conflicts and commit. The worktree has NOT been removed."
        : "Merge has conflicts. Run `git merge --abort` to cancel, or resolve conflicts and commit. The worktree has NOT been removed.";
    if (didStash) {
      message += " Your stashed changes are preserved — run `git stash list` to see.";
    }
    ctx.ui.notify(message, "error");

    return { ok: false, conflictFiles };
  }

  return { ok: true };
}

async function handleTrackedChanges(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  worktreePath: string,
): Promise<boolean> {
  const hasChanges = await hasTrackedChanges(pi, worktreePath);
  if (!hasChanges) return true;

  if (ctx.hasUI) {
    const choice = await ctx.ui.select("Commit tracked changes?", [
      "Let agent summarize & commit",
      "Provide commit message",
    ]);
    if (choice === undefined) {
      ctx.ui.notify("Merge cancelled", "info");
      return false;
    }
    if (choice === "Provide commit message") {
      const msg = await ctx.ui.input("Enter commit message", "feat: ...");
      if (msg === undefined || msg.trim() === "") {
        ctx.ui.notify("Merge cancelled", "info");
        return false;
      }
      await gitExec(pi, ["add", "-u"], worktreePath);
      await gitExec(pi, ["commit", "-m", msg.trim()], worktreePath);
      ctx.ui.notify("Committed: " + msg.trim(), "info");
    } else {
      // "Let agent summarize & commit"
      try {
        const result = await autoCommitWithAIMessage(pi, worktreePath);
        if (result === null) {
          ctx.ui.notify("No changes to commit", "info");
        } else {
          ctx.ui.notify("Committed: " + result, "info");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.ui.notify("Auto-commit failed: " + message, "error");
        return false;
      }
    }
  } else {
    // Non-interactive: auto-commit
    try {
      const result = await autoCommitWithAIMessage(pi, worktreePath);
      if (result === null) {
        ctx.ui.notify("No changes to commit", "info");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.ui.notify(
        "Auto-commit failed: " +
          message +
          ". Merge halted — uncommitted changes remain in worktree.",
        "error",
      );
      return false;
    }
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

  // 5. In non-interactive mode, don't copy untracked files (safe default)
  if (!ctx.hasUI) return [];

  // 6. Return the file paths to copy
  return filesNotInMain;
}

async function askToDeleteWorktree(
  ctx: ExtensionCommandContext,
  targetBranch: string,
): Promise<boolean> {
  if (!ctx.hasUI) return false; // Keep worktree in non-interactive mode
  return ctx.ui.confirm(
    "Delete worktree?",
    "The worktree for '" + targetBranch + "' has been merged successfully. Delete it?",
  );
}

async function getPreMergeHead(pi: ExtensionAPI): Promise<string | null> {
  const result = await gitExec(pi, ["rev-parse", "HEAD"], getMainRepoPath());
  return result.code === 0 ? result.stdout.trim() : null;
}

async function verifyOrFailMerge(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  mainBranch: string,
  targetBranch: string,
  preMergeHead: string | null,
): Promise<boolean> {
  const verification = await verifyMergeIntegrity(pi, getMainRepoPath(), mainBranch, targetBranch);
  if (!verification.ok) {
    for (const error of verification.errors) {
      ctx.ui.notify(error, "error");
    }
    if (preMergeHead) {
      await gitExec(pi, ["reset", "--hard", preMergeHead], getMainRepoPath());
    }
    ctx.ui.notify(
      "Merge verification failed. Main branch rolled back. Worktree preserved. Review and retry, or resolve issues manually.",
      "warning",
    );
    return false;
  }
  return true;
}

async function finalizeMerge(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  target: MergeTarget,
  filesToCopy: string[],
): Promise<void> {
  // Copy untracked files
  if (filesToCopy.length > 0) {
    const failed = copyFilesWithOverwrite(filesToCopy, target.wt.path, getMainRepoPath());
    if (failed.length > 0) {
      ctx.ui.notify(
        `Warning: failed to copy ${failed.length} file(s): ${failed.join(", ")}`,
        "warning",
      );
    }
  }

  // Ask to delete worktree
  const shouldDelete = await askToDeleteWorktree(ctx, target.branch);
  if (shouldDelete) {
    const removeResult = await gitExec(
      pi,
      ["worktree", "remove", "-f", target.wt.path],
      getMainRepoPath(),
    );
    if (removeResult.code !== 0) {
      ctx.ui.notify(
        "Merged but failed to remove worktree: " + removeResult.stderr.trim(),
        "warning",
      );
    } else {
      await gitExec(pi, ["worktree", "prune"], getMainRepoPath());
    }
  }

  // Update state and switch
  setCurrentBranch(target.mainBranch);
  switchCwd(pi, ctx, getMainRepoPath());
  updateFooterStatus(ctx);

  const action = shouldDelete ? "and removed worktree" : "(worktree kept)";
  ctx.ui.notify("Merged '" + target.branch + "' into " + target.mainBranch + " " + action, "info");
}

export async function handleWtMerge(
  args: string,
  ctx: ExtensionCommandContext,
  pi: ExtensionAPI,
): Promise<void> {
  // 1. Resolve and validate target (branch, worktree, main branch)
  const target = await resolveMergeTarget(args, ctx, pi);
  if (!target) return;

  // 2. Confirm merge operation
  if (ctx.hasUI) {
    const confirmed = await ctx.ui.confirm(
      "Merge worktree?",
      "This will merge '" + target.branch + "' into '" + target.mainBranch + "'. Continue?",
    );
    if (!confirmed) {
      ctx.ui.notify("Merge cancelled", "info");
      return;
    }
  }

  // 3. Handle tracked changes (commit if dirty)
  const shouldContinue = await handleTrackedChanges(pi, ctx, target.wt.path);
  if (!shouldContinue) return;

  // 4. Detect untracked files and ask about copy-back
  const filesToCopy = await detectAndConfirmUntracked(pi, ctx, target.wt.path, getMainRepoPath());

  // 5. Stash main if dirty, save HEAD, checkout and merge
  const didStash = await stashMainIfDirty(pi, ctx);
  const preMergeHead = await getPreMergeHead(pi);

  const mergeResult = await checkoutAndMerge(pi, ctx, target.mainBranch, target.branch, didStash);
  if (!mergeResult.ok) return;

  // 6. Verify merge integrity (before restoring stash and copying untracked files)
  const verified = await verifyOrFailMerge(pi, ctx, target.mainBranch, target.branch, preMergeHead);
  if (!verified) return;

  // 7. Restore stash after verification passes
  if (didStash) {
    const applyResult = await gitExec(pi, ["stash", "apply"], getMainRepoPath());
    if (applyResult.code === 0) {
      await gitExec(pi, ["stash", "drop"], getMainRepoPath());
    } else {
      ctx.ui.notify(
        "Warning: failed to reapply stashed changes. Your changes are preserved in the stash — run `git stash list` and `git stash apply` to recover them.",
        "warning",
      );
    }
  }

  // 8. Finalize: copy files, optionally delete worktree, update state
  await finalizeMerge(pi, ctx, target, filesToCopy);
}
