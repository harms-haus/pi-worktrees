import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExecResult,
} from "@earendil-works/pi-coding-agent";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import { getCurrentBranch, getMainRepoPath, setCurrentWorktreePath } from "./state.js";
import type { WorktreeInfo } from "./types.js";
import { WORKTREE_CHANGE_TYPE } from "./types.js";

// ---------------------------------------------------------------------------
// 1. gitExec — thin wrapper around pi.exec for git commands
// ---------------------------------------------------------------------------

export async function gitExec(pi: ExtensionAPI, args: string[], cwd?: string): Promise<ExecResult> {
  return pi.exec("git", args, { cwd: cwd ?? getMainRepoPath() });
}

// ---------------------------------------------------------------------------
// 2. parseWorktreePorcelain — pure parser for `git worktree list --porcelain`
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
// 3. getWorktreeList — fetch and parse worktree list
// ---------------------------------------------------------------------------

export async function getWorktreeList(pi: ExtensionAPI, cwd?: string): Promise<WorktreeInfo[]> {
  const result = await gitExec(pi, ["worktree", "list", "--porcelain"], cwd);
  if (result.code !== 0) return [];
  return parseWorktreePorcelain(result.stdout);
}

// ---------------------------------------------------------------------------
// 4. findWorktreeByBranch — find a worktree by its branch name
// ---------------------------------------------------------------------------

export function findWorktreeByBranch(
  worktrees: WorktreeInfo[],
  branchName: string,
): WorktreeInfo | undefined {
  return worktrees.find((wt) => wt.branchName === branchName);
}

// ---------------------------------------------------------------------------
// 5. getMainWorktree — first worktree (git always lists main first)
// ---------------------------------------------------------------------------

export function getMainWorktree(worktrees: WorktreeInfo[]): WorktreeInfo | undefined {
  return worktrees[0];
}

// ---------------------------------------------------------------------------
// 6. resolveBaseDir — determine where worktrees are stored
// ---------------------------------------------------------------------------

const DEFAULT_BASE_DIR = "./.git/worktrees/";

export function resolveBaseDir(mainRepoPath: string): string {
  let baseDir = DEFAULT_BASE_DIR;

  try {
    const settingsPath = join(homedir(), ".pi", "agent", "settings.json");
    const raw = readFileSync(settingsPath, "utf-8");
    const settings = JSON.parse(raw) as Record<string, unknown>;

    const worktrees = settings.worktrees as Record<string, unknown> | undefined;
    if (worktrees && typeof worktrees.baseDir === "string" && worktrees.baseDir.length > 0) {
      baseDir = worktrees.baseDir;
    }
  } catch {
    // File not found or parse error — use default
  }

  let resolved: string;
  if (isAbsolute(baseDir)) {
    resolved = baseDir;
  } else {
    resolved = resolve(mainRepoPath, baseDir);
  }

  // Ensure trailing slash
  if (!resolved.endsWith("/")) {
    resolved += "/";
  }

  return resolved;
}

// ---------------------------------------------------------------------------
// 7. switchCwd — switch CWD, update state, persist entry
// ---------------------------------------------------------------------------

export function switchCwd(
  pi: ExtensionAPI,
  _ctx: ExtensionCommandContext,
  targetPath: string,
): void {
  pi.sendUserMessage("/cwd " + targetPath);
  setCurrentWorktreePath(targetPath);
  pi.appendEntry(WORKTREE_CHANGE_TYPE, {
    mainRepoPath: getMainRepoPath(),
    currentWorktreePath: targetPath,
    currentBranch: getCurrentBranch(),
  });
}

// ---------------------------------------------------------------------------
// 8. detectMainRepo — find the main repo root from a worktree CWD
// ---------------------------------------------------------------------------

export async function detectMainRepo(pi: ExtensionAPI, cwd: string): Promise<string | null> {
  const worktrees = await getWorktreeList(pi, cwd);
  const main = getMainWorktree(worktrees);
  return main?.path ?? null;
}

// ---------------------------------------------------------------------------
// 9. hasUncommittedChanges — check for dirty working tree
// ---------------------------------------------------------------------------

export async function hasUncommittedChanges(
  pi: ExtensionAPI,
  worktreePath: string,
): Promise<boolean> {
  const result = await gitExec(pi, ["status", "--porcelain"], worktreePath);
  return result.stdout.trim().length > 0;
}

// ---------------------------------------------------------------------------
// 9b. detectDefaultBranch — detect the default branch from git
// ---------------------------------------------------------------------------

export async function detectDefaultBranch(pi: ExtensionAPI, cwd: string): Promise<string> {
  // Try git symbolic-ref first (works when origin is configured)
  const symRefResult = await gitExec(pi, ["symbolic-ref", "refs/remotes/origin/HEAD"], cwd);
  if (symRefResult.code === 0) {
    const match = symRefResult.stdout.trim().match(/^refs\/remotes\/origin\/(.+)$/);
    if (match) return match[1];
  }
  // Fallback: get branch from main worktree
  const worktrees = await getWorktreeList(pi, cwd);
  const mainWt = getMainWorktree(worktrees);
  if (mainWt && mainWt.branchName !== "detached") {
    return mainWt.branchName;
  }
  // Final fallback
  return "main";
}

// ---------------------------------------------------------------------------
// 10. autoCommitWithAIMessage — stage, generate commit message, commit
// ---------------------------------------------------------------------------

const FALLBACK_COMMIT_MESSAGE = "chore: auto-commit worktree changes";
const EMPTY_DIFF_FALLBACK = "chore: save work";

export async function autoCommitWithAIMessage(
  pi: ExtensionAPI,
  worktreePath: string,
): Promise<string> {
  // Stage all changes
  await gitExec(pi, ["add", "-A"], worktreePath);

  // Get staged diff
  const diffResult = await gitExec(pi, ["diff", "--cached"], worktreePath);
  const diff = diffResult.stdout.trim();

  if (!diff) {
    // Nothing staged after add -A, nothing to commit
    return EMPTY_DIFF_FALLBACK;
  }

  // Generate commit message via pi subprocess.
  // Pass the prompt via stdin to avoid exposing diff content in process
  // args (visible via ps) and to avoid ARG_MAX limits on large changesets.
  let commitMessage = FALLBACK_COMMIT_MESSAGE;
  try {
    const promptText =
      "Generate a concise conventional-commit style message for this diff. " +
      "Reply with ONLY the commit message, nothing else:\n\n" +
      diff;
    const result = spawnSync("pi", ["--print"], {
      input: promptText,
      cwd: worktreePath,
      timeout: 30_000,
      encoding: "utf-8",
    });
    if (result.status === 0 && result.stdout.trim()) {
      commitMessage = result.stdout.trim();
    }
  } catch {
    // pi subprocess failed or timed out — use fallback
  }

  // Commit
  const commitResult = await gitExec(pi, ["commit", "-m", commitMessage], worktreePath);
  if (commitResult.code !== 0) {
    throw new Error("Auto-commit failed: " + commitResult.stderr.trim());
  }

  return commitMessage;
}

// ---------------------------------------------------------------------------
// 11. validateBranchName — validate a proposed git branch name
// ---------------------------------------------------------------------------

/* eslint-disable-next-line no-control-regex */
const BRANCH_NAME_RE = /(\.\.|~|\^|:|\\|[\x00-\x1f\x7f]|\s)|\.lock$/;

export function validateBranchName(name: string): string | null {
  if (!name || name.length === 0) {
    return "Branch name cannot be empty";
  }
  if (name.startsWith("-")) {
    return "Branch name cannot start with '-'";
  }
  if (name.toUpperCase() === "HEAD") {
    return "Branch name cannot be 'HEAD'";
  }
  const match = BRANCH_NAME_RE.exec(name);
  if (match) {
    return `Branch name contains invalid character: '${match[1] || name.slice(-5)}'`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 12. expandTilde — expand leading ~ to $HOME
// ---------------------------------------------------------------------------

export function expandTilde(input: string): string {
  if (input.startsWith("~")) {
    const home = process.env.HOME || "";
    if (home) {
      return home + input.slice(1);
    }
  }
  return input;
}
