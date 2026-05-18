import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { statSync } from "node:fs";
import { join } from "node:path";
import {
  gitExec,
  resolveBaseDir,
  switchCwd,
  detectMainRepo,
  validateBranchName,
} from "../helpers.js";
import {
  getMainRepoPath,
  setMainRepoPath,
  setCurrentBranch,
  updateFooterStatus,
} from "../state.js";

export async function handleWtCreate(
  args: string,
  ctx: ExtensionCommandContext,
  pi: ExtensionAPI,
): Promise<void> {
  // 1. Validate args
  const branchName = args.trim();
  if (!branchName) {
    ctx.ui.notify("Usage: /wt-create <branch-name>", "error");
    return;
  }

  const validationError = validateBranchName(branchName);
  if (validationError) {
    ctx.ui.notify(validationError, "error");
    return;
  }

  // 2. Ensure main repo path is known
  if (getMainRepoPath() === "") {
    const mainRepo = await detectMainRepo(pi, ctx.cwd);
    if (!mainRepo) {
      ctx.ui.notify("Not inside a git repository", "error");
      return;
    }
    setMainRepoPath(mainRepo);
  }

  // 3. Resolve worktree path
  const baseDir = resolveBaseDir(getMainRepoPath());
  const worktreePath = join(baseDir, branchName);

  try {
    statSync(worktreePath);
    ctx.ui.notify("Directory already exists: " + worktreePath, "error");
    return;
  } catch {
    // ENOENT — directory does not exist, which is what we want
  }

  // 4. Check if branch already exists
  const branchCheck = await gitExec(pi, ["rev-parse", "--verify", branchName], getMainRepoPath());

  let result;
  if (branchCheck.code === 0) {
    // Branch exists — check out existing branch in new worktree
    result = await gitExec(pi, ["worktree", "add", worktreePath, branchName], getMainRepoPath());
  } else {
    // Branch doesn't exist — create new branch and worktree
    result = await gitExec(
      pi,
      ["worktree", "add", "-b", branchName, worktreePath],
      getMainRepoPath(),
    );
  }

  // 5. Check result
  if (result.code !== 0) {
    ctx.ui.notify("Failed to create worktree: " + result.stderr.trim(), "error");
    return;
  }

  // 6. Update state and switch
  setCurrentBranch(branchName);
  switchCwd(pi, ctx, worktreePath);
  updateFooterStatus(ctx);
  ctx.ui.notify("Created worktree for '" + branchName + "' at " + worktreePath, "info");
}
