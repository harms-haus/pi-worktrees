/** A parsed entry from `git worktree list --porcelain` */
export interface WorktreeInfo {
  /** Absolute path to the worktree directory */
  path: string;
  /** Current HEAD commit hash */
  head: string;
  /** Branch ref (e.g. "refs/heads/feature") or "detached" */
  branch: string;
  /** Human-readable branch name extracted from refs/heads/<name>, or "detached" */
  branchName: string;
}

/** Custom entry type for worktree-change entries in the session branch */
export const WORKTREE_CHANGE_TYPE = "worktree-change" as const;

/** Data persisted via pi.appendEntry for worktree state */
export interface WorktreeChangeData {
  /** Absolute path to the main repo */
  mainRepoPath: string;
  /** Absolute path to the current worktree (same as mainRepoPath if on main) */
  currentWorktreePath: string;
  /** Branch name of the current worktree, or the default branch name */
  currentBranch: string;
  /** Detected default branch name (e.g. "main", "master") */
  defaultBranch?: string;
}

/** Settings shape for the worktrees extension */
export interface WorktreeSettings {
  /** Base directory for worktrees (relative to main repo root). Default: "./.git/worktrees/" */
  baseDir: string;
}
