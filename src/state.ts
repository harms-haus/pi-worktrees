import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { WorktreeChangeData } from "./types.js";
import { WORKTREE_CHANGE_TYPE } from "./types.js";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { existsSync, statSync } from "node:fs";

/** Absolute path to the main git worktree (the repo root). Set on session_start. */
let mainRepoPath: string = "";

/** Absolute path to the currently active worktree. Same as mainRepoPath when on main. */
let currentWorktreePath: string = "";

/** Branch name of the currently active worktree. "main" when on main worktree. */
let currentBranch: string = "main";

/** Detected default branch name (e.g. "main", "master"). */
let defaultBranch: string = "main";

export function getMainRepoPath(): string {
  return mainRepoPath;
}

export function setMainRepoPath(path: string): void {
  mainRepoPath = path;
}

export function getCurrentWorktreePath(): string {
  return currentWorktreePath;
}

export function setCurrentWorktreePath(path: string): void {
  currentWorktreePath = path;
}

export function getCurrentBranch(): string {
  return currentBranch;
}

export function setCurrentBranch(branch: string): void {
  currentBranch = branch;
}

export function getDefaultBranch(): string {
  return defaultBranch;
}

export function setDefaultBranch(branch: string): void {
  defaultBranch = branch;
}

export function resetState(): void {
  mainRepoPath = "";
  currentWorktreePath = "";
  currentBranch = "main";
  defaultBranch = "main";
}

export function updateFooterStatus(ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;

  if (currentBranch === defaultBranch && currentWorktreePath === mainRepoPath) {
    ctx.ui.setStatus("worktree", undefined);
  } else {
    ctx.ui.setStatus("worktree", ctx.ui.theme.fg("accent", "🌳 " + currentBranch));
  }
}

export function restoreWorktreeFromBranch(ctx: ExtensionContext, _originalCwd: string): void {
  let entries: SessionEntry[];
  try {
    entries = ctx.sessionManager.getBranch();
  } catch {
    return;
  }

  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (
      entry.type === "custom" &&
      entry.customType === WORKTREE_CHANGE_TYPE &&
      isValidWorktreeData(entry.data)
    ) {
      const data = entry.data;

      // Validate mainRepoPath exists as directory
      try {
        const stat = statSync(data.mainRepoPath);
        if (!stat.isDirectory()) continue;
      } catch {
        continue;
      }

      mainRepoPath = data.mainRepoPath;

      // Restore defaultBranch from entry data if present
      if (data.defaultBranch) {
        defaultBranch = data.defaultBranch;
      }

      // If the currentWorktreePath doesn't exist (deleted externally), fall back to main
      if (data.currentWorktreePath && existsSync(data.currentWorktreePath)) {
        currentWorktreePath = data.currentWorktreePath;
        currentBranch = data.currentBranch;
      } else {
        currentWorktreePath = data.mainRepoPath;
        currentBranch = defaultBranch;
      }

      return;
    }
  }
  // No valid entry found — leave defaults (will be populated when a command runs)
}

function isValidWorktreeData(data: unknown): data is WorktreeChangeData {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.mainRepoPath === "string" &&
    typeof d.currentWorktreePath === "string" &&
    typeof d.currentBranch === "string"
  );
}
