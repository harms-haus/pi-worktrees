import type { AutocompleteItem } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getWorktreeList } from "./git.js";
import { getMainRepoPath, getDefaultBranch } from "./state.js";

/** Provide branch-name tab-completion for worktree commands. */
export async function getBranchCompletions(
  prefix: string,
  pi: ExtensionAPI,
): Promise<AutocompleteItem[] | null> {
  const worktrees = await getWorktreeList(pi, getMainRepoPath());
  if (worktrees.length === 0) return null;

  // Collect unique branch names, skipping "detached"
  const branchNames = new Set<string>();
  branchNames.add(getDefaultBranch());
  for (const wt of worktrees) {
    if (wt.branchName !== "detached") {
      branchNames.add(wt.branchName);
    }
  }

  // Filter by prefix (case-insensitive)
  const lower = prefix.toLowerCase();
  const matches = [...branchNames].filter((name) => name.toLowerCase().startsWith(lower));

  if (matches.length === 0) return null;

  return matches.map((name) => ({ label: name, value: name }));
}
