import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { gitExec, getWorktreeList, getMainWorktree } from "./git.js";
import {
  getMainRepoPath,
  getCurrentBranch,
  setCurrentWorktreePath,
  getDefaultBranch,
  setMainRepoPath,
} from "./state.js";
import { WORKTREE_CHANGE_TYPE } from "./types.js";

// ---------------------------------------------------------------------------
// resolveBaseDir — determine where worktrees are stored
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
// switchCwd — switch CWD, update state, persist entry
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
    defaultBranch: getDefaultBranch(),
  });
}

// ---------------------------------------------------------------------------
// detectMainRepo — find the main repo root from a worktree CWD
// ---------------------------------------------------------------------------

export async function detectMainRepo(pi: ExtensionAPI, cwd: string): Promise<string | null> {
  const worktrees = await getWorktreeList(pi, cwd);
  const main = getMainWorktree(worktrees);
  return main?.path ?? null;
}

// ---------------------------------------------------------------------------
// hasUncommittedChanges — check for dirty working tree
// ---------------------------------------------------------------------------

export async function hasUncommittedChanges(
  pi: ExtensionAPI,
  worktreePath: string,
): Promise<boolean> {
  const result = await gitExec(pi, ["status", "--porcelain"], worktreePath);
  return result.stdout.trim().length > 0;
}

// ---------------------------------------------------------------------------
// detectDefaultBranch — detect the default branch from git
// ---------------------------------------------------------------------------

export async function detectDefaultBranch(pi: ExtensionAPI, cwd: string): Promise<string> {
  // Try git symbolic-ref first (works when origin is configured)
  const symRefResult = await gitExec(pi, ["symbolic-ref", "refs/remotes/origin/HEAD"], cwd);
  if (symRefResult.code === 0) {
    const match = symRefResult.stdout.trim().match(/^refs\/remotes\/origin\/(.+)$/);
    if (match && match[1]) return match[1];
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
// ensureMainRepo — ensure mainRepoPath is known; detect from cwd if not set
// ---------------------------------------------------------------------------

/**
 * Ensure mainRepoPath is known. Detects from cwd if not set.
 * Returns true if main repo was detected, false if not in a git repo.
 * Sets mainRepoPath on success.
 */
export async function ensureMainRepo(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): Promise<boolean> {
  if (getMainRepoPath() !== "") return true;

  const mainRepo = await detectMainRepo(pi, ctx.cwd);
  if (!mainRepo) {
    ctx.ui.notify("Not inside a git repository", "error");
    return false;
  }
  setMainRepoPath(mainRepo);
  return true;
}

// ---------------------------------------------------------------------------
// autoCommitWithAIMessage — stage, generate commit message, commit
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
// copyUntrackedFiles — copy untracked files from source to destination
// ---------------------------------------------------------------------------

export function copyUntrackedFiles(
  untrackedFiles: string[],
  sourceDir: string,
  destDir: string,
): void {
  if (untrackedFiles.length === 0) return;

  for (const relPath of untrackedFiles) {
    try {
      const srcPath = join(sourceDir, relPath);
      const destPath = join(destDir, relPath);

      // Prevent path traversal
      const resolvedDest = resolve(destPath);
      if (!resolvedDest.startsWith(resolve(destDir) + "/") && resolvedDest !== resolve(destDir))
        continue;

      // Skip directories (submodule filter) and symlinks
      const stat = lstatSync(srcPath);
      if (stat.isDirectory()) continue;
      if (stat.isSymbolicLink()) continue;

      // Skip existing files
      if (existsSync(destPath)) continue;

      // Create parent directory
      mkdirSync(dirname(destPath), { recursive: true });

      // Copy file
      copyFileSync(srcPath, destPath);
    } catch {
      // Individual copy failure — silently skip
    }
  }
}
