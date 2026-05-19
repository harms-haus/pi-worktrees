import type { ExtensionAPI, ExecResult } from "@earendil-works/pi-coding-agent";

import { getMainRepoPath } from "./state.js";
import type { WorktreeInfo } from "./types.js";

// ---------------------------------------------------------------------------
// gitExec — thin wrapper around pi.exec for git commands
// ---------------------------------------------------------------------------

export async function gitExec(pi: ExtensionAPI, args: string[], cwd?: string): Promise<ExecResult> {
  return pi.exec("git", args, { cwd: cwd ?? getMainRepoPath() });
}

// ---------------------------------------------------------------------------
// parseWorktreePorcelain — pure parser for `git worktree list --porcelain`
// ---------------------------------------------------------------------------

export function parseWorktreePorcelain(output: string): WorktreeInfo[] {
  const trimmed = output.trim();
  if (!trimmed) return [];

  const blocks = trimmed.split(/\n\n+/);
  const result: WorktreeInfo[] = [];

  for (const block of blocks) {
    const blockTrimmed = block.trim();
    if (!blockTrimmed) continue;

    let worktreePath = "";
    let head = "";
    let branch = "";
    let isDetached = false;

    for (const line of blockTrimmed.split("\n")) {
      if (line.startsWith("worktree ")) {
        worktreePath = line.slice("worktree ".length);
      } else if (line.startsWith("HEAD ")) {
        head = line.slice("HEAD ".length);
      } else if (line.startsWith("branch ")) {
        branch = line.slice("branch ".length);
      } else if (line === "detached") {
        isDetached = true;
      }
    }

    if (!worktreePath) continue;

    let branchName: string;
    if (isDetached || !branch) {
      branchName = "detached";
      branch = branch || "detached";
    } else if (branch.startsWith("refs/heads/")) {
      branchName = branch.slice("refs/heads/".length);
    } else {
      branchName = branch;
    }

    result.push({ path: worktreePath, head, branch, branchName });
  }

  return result;
}

// ---------------------------------------------------------------------------
// getWorktreeList — fetch and parse worktree list
// ---------------------------------------------------------------------------

export async function getWorktreeList(pi: ExtensionAPI, cwd?: string): Promise<WorktreeInfo[]> {
  const result = await gitExec(pi, ["worktree", "list", "--porcelain"], cwd);
  // Silently return empty on failure — callers treat [] as "no worktrees found"
  // which is a safe fallback when not in a git repo or on git error
  if (result.code !== 0) return [];
  return parseWorktreePorcelain(result.stdout);
}

// ---------------------------------------------------------------------------
// findWorktreeByBranch — find a worktree by its branch name
// ---------------------------------------------------------------------------

export function findWorktreeByBranch(
  worktrees: WorktreeInfo[],
  branchName: string,
): WorktreeInfo | undefined {
  return worktrees.find((wt) => wt.branchName === branchName);
}

// ---------------------------------------------------------------------------
// getMainWorktree — first worktree (git always lists main first)
// ---------------------------------------------------------------------------

export function getMainWorktree(worktrees: WorktreeInfo[]): WorktreeInfo | undefined {
  return worktrees[0];
}
