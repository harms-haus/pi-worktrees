import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { getWorktreeList, findWorktreeByBranch } from "../git.js";
import { switchCwd, ensureMainRepo } from "../worktree.js";
import {
  getMainRepoPath,
  setCurrentBranch,
  updateFooterStatus,
  getDefaultBranch,
} from "../state.js";

export async function handleWtSwitch(
  args: string,
  ctx: ExtensionCommandContext,
  pi: ExtensionAPI,
): Promise<void> {
  // 1. Validate args
  const target = args.trim();
  if (!target) {
    ctx.ui.notify("Usage: /wt-switch <branch-name>|main", "error");
    return;
  }

  // 2. Ensure main repo path is known
  if (!(await ensureMainRepo(pi, ctx))) return;

  // 3. Handle default branch target (accept both "main" literal and detected default)
  const defaultBranch = getDefaultBranch();
  if (target === defaultBranch) {
    setCurrentBranch(defaultBranch);
    switchCwd(pi, ctx, getMainRepoPath());
    updateFooterStatus(ctx);
    ctx.ui.notify("Switched to " + defaultBranch + " worktree", "info");
    return;
  }

  // 4. Find worktree for branch
  const worktrees = await getWorktreeList(pi, getMainRepoPath());
  const wt = findWorktreeByBranch(worktrees, target);
  if (!wt) {
    ctx.ui.notify(
      "No worktree found for branch '" + target + "'. Use /wt-create " + target + " first.",
      "error",
    );
    return;
  }

  // 5. Switch
  setCurrentBranch(target);
  switchCwd(pi, ctx, wt.path);
  updateFooterStatus(ctx);
  ctx.ui.notify("Switched to worktree '" + target + "' at " + wt.path, "info");
}
