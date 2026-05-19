import type { WorktreeInfo } from "../../types.js";

export const MAIN_REPO = "/repo";
export const MAIN_BRANCH = "main";
export const FEATURE_BRANCH = "feature";
export const FEATURE_PATH = "/repo/.git/worktrees/feature";

export const mainWorktree: WorktreeInfo = {
  path: MAIN_REPO,
  head: "abc123",
  branch: "refs/heads/main",
  branchName: MAIN_BRANCH,
};

export const featureWorktree: WorktreeInfo = {
  path: FEATURE_PATH,
  head: "def456",
  branch: "refs/heads/feature",
  branchName: FEATURE_BRANCH,
};

export const worktrees: WorktreeInfo[] = [mainWorktree, featureWorktree];
