import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { handleWtCreate } from "./commands/wt-create.js";
import { handleWtSwitch } from "./commands/wt-switch.js";
import { handleWtMerge } from "./commands/wt-merge.js";
import { handleWtCleanup } from "./commands/wt-cleanup.js";
import { getBranchCompletions } from "./completions.js";
import {
  setMainRepoPath,
  setDefaultBranch,
  resetState,
  updateFooterStatus,
  restoreWorktreeFromBranch,
} from "./state.js";
import { detectMainRepo, detectDefaultBranch } from "./worktree.js";

export default function (pi: ExtensionAPI): void {
  // ── /wt-create ──────────────────────────────────────────────────────
  pi.registerCommand("wt-create", {
    description: "Create a new git worktree and switch to it",
    getArgumentCompletions: (prefix: string) => {
      return getBranchCompletions(prefix, pi);
    },
    handler: async (args, ctx) => {
      await handleWtCreate(args, ctx, pi);
    },
  });

  // ── /wt-switch ──────────────────────────────────────────────────────
  pi.registerCommand("wt-switch", {
    description: "Switch to a worktree by branch name, or 'main'",
    getArgumentCompletions: (prefix: string) => {
      return getBranchCompletions(prefix, pi);
    },
    handler: async (args, ctx) => {
      await handleWtSwitch(args, ctx, pi);
    },
  });

  // ── /wt-merge ──────────────────────────────────────────────────────
  pi.registerCommand("wt-merge", {
    description: "Merge a worktree's branch into main and remove the worktree",
    getArgumentCompletions: (prefix: string) => {
      return getBranchCompletions(prefix, pi);
    },
    handler: async (args, ctx) => {
      await handleWtMerge(args, ctx, pi);
    },
  });

  // ── /wt-cleanup ────────────────────────────────────────────────────
  pi.registerCommand("wt-cleanup", {
    description: "Remove a worktree and optionally delete its branch",
    getArgumentCompletions: (prefix: string) => {
      return getBranchCompletions(prefix, pi);
    },
    handler: async (args, ctx) => {
      await handleWtCleanup(args, ctx, pi);
    },
  });

  // ── State restoration ──────────────────────────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    const mainRepo = await detectMainRepo(pi, ctx.cwd);
    if (mainRepo) {
      setMainRepoPath(mainRepo);
      const defaultBranch = await detectDefaultBranch(pi, ctx.cwd);
      setDefaultBranch(defaultBranch);
    }
    restoreWorktreeFromBranch(ctx);
    updateFooterStatus(ctx);
  });

  pi.on("session_tree", (_event, ctx) => {
    restoreWorktreeFromBranch(ctx);
    updateFooterStatus(ctx);
  });

  pi.on("session_shutdown", () => {
    resetState();
  });
}
