# Commands

Detailed reference for all four pi-worktrees slash commands.

---

## `/wt-create`

Create a new git worktree and switch to it.

**Usage:**

```
/wt-create <branch-name>
```

| Parameter     | Required | Description                               |
| ------------- | -------- | ----------------------------------------- |
| `branch-name` | ✓        | Name of the branch to create or check out |

**Tab completion:** Branch names from existing worktrees.

### Validation

1. Branch name must not be empty.
2. Branch name is validated by `validateBranchName()`:
   - Cannot start with `-`
   - Cannot be `HEAD` (case-insensitive)
   - Cannot contain `..`, `~`, `^`, `:`, `\`, whitespace, or control characters
   - Cannot end with `.lock`

### Flow

1. **Validate** the branch name. Notify error if invalid.
2. **Detect main repo** if not already known (via `detectMainRepo`).
3. **Resolve worktree path** using `resolveBaseDir()` + branch name.
4. **Check for directory conflict** — if the target directory already exists, notify error.
5. **Check if branch exists** via `git rev-parse --verify`:
   - **Branch exists**: `git worktree add <path> <branch>` — check out existing branch in a new worktree.
   - **Branch doesn't exist**: `git worktree add -b <branch> <path>` — create new branch and worktree.
6. **Copy untracked files** — `getUntrackedFiles(pi, ctx.cwd)` lists untracked files via `git ls-files -z --others --exclude-standard`, then `copyUntrackedFiles(files, ctx.cwd, worktreePath)` copies them. Directories, symlinks, and files that already exist in the destination are skipped. Individual copy failures are silently ignored. This step is best-effort and does not affect the overall worktree creation flow.
7. **Update state**: set `currentBranch`, call `switchCwd()`, update footer status.
8. **Notify success** with the branch name and worktree path.

### Untracked Files

When a worktree is created, untracked files from the current working directory are automatically copied to the new worktree. This is a best-effort convenience feature — copy failures never cause worktree creation to fail.

- **Source**: `ctx.cwd` — wherever the user is when they run the command.
- **Discovery**: `git ls-files -z --others --exclude-standard` — respects `.gitignore`; files matching ignore rules are **not** copied.
- **Skipped**:
  - Directories (including submodule directories)
  - Symbolic links
  - Files that already exist in the new worktree
  - Files whose resolved path escapes the destination directory (path traversal protection)
- **Error handling**: individual copy failures are silently ignored.

### Error Cases

| Condition                | Message                                                                           |
| ------------------------ | --------------------------------------------------------------------------------- |
| No branch name provided  | `"Usage: /wt-create <branch-name>"`                                               |
| Invalid branch name      | Specific validation error (e.g. `"Branch name contains invalid character: '..'"`) |
| Not in a git repo        | `"Not inside a git repository"`                                                   |
| Directory already exists | `"Directory already exists: <path>"`                                              |
| `git worktree add` fails | `"Failed to create worktree: <stderr>"`                                           |

---

## `/wt-switch`

Switch to an existing worktree by branch name, or back to the default branch.

**Usage:**

```
/wt-switch <branch-name>
/wt-switch main
```

| Parameter     | Required | Description                                                          |
| ------------- | -------- | -------------------------------------------------------------------- |
| `branch-name` | ✓        | Name of the worktree branch to switch to, or the default branch name |

**Tab completion:** Branch names from existing worktrees plus the default branch.

### Flow

1. **Validate** that args are not empty. Notify usage error if missing.
2. **Detect main repo** if not already known.
3. **Handle default branch target** — if the target matches the detected default branch:
   - Set `currentBranch` to the default branch name.
   - Call `switchCwd()` with `mainRepoPath`.
   - Update footer, notify success.
   - Return early.
4. **Find the worktree** via `getWorktreeList()` + `findWorktreeByBranch()`.
5. **Switch**: set `currentBranch`, call `switchCwd()`, update footer, notify success.

### Error Cases

| Condition               | Message                                                                 |
| ----------------------- | ----------------------------------------------------------------------- |
| No branch name provided | `"Usage: /wt-switch <branch-name>\|main"`                               |
| Not in a git repo       | `"Not inside a git repository"`                                         |
| No worktree for branch  | `"No worktree found for branch '<name>'. Use /wt-create <name> first."` |

---

## `/wt-merge`

Merge a worktree's branch into the default branch. Auto-commits tracked changes. Optionally copies untracked files back to main and deletes the worktree. Requires confirmation.

**Usage:**

```
/wt-merge <branch-name>
/wt-merge                    # merges the current worktree's branch
```

| Parameter     | Required | Description                                      |
| ------------- | -------- | ------------------------------------------------ |
| `branch-name` | ✗        | Branch to merge. Defaults to the current branch. |

**Tab completion:** Branch names from existing worktrees.

### Resolution Logic

- If `<branch-name>` is provided → use it.
- If omitted → use `getCurrentBranch()`.
- If omitted AND currently on the default branch → error (nothing to merge).

### Validation

1. Branch name must pass `validateBranchName()`.
2. Target branch cannot be the default branch (cannot merge into itself).
3. A worktree must exist for the target branch.

### Flow

1. **Resolve and validate target** (`resolveMergeTarget`) — resolve the target branch from args or current branch, validate the branch name, detect main repo, guard against self-merge, find the worktree, and determine the main branch name.
2. **Confirm merge** — prompt the user to confirm merging `<branch>` into `<main>`.
3. **Handle tracked changes** (`handleTrackedChanges`) — check for uncommitted tracked changes via `hasTrackedChanges()` (which uses `git status --porcelain` and filters out `?? ` untracked entries):
   - **Interactive (UI)**: present a select dialog with two options:
     - *"Let agent summarize & commit"* — calls `autoCommitWithAIMessage()` which stages tracked changes only (`git add -u`), generates a commit message via `pi --print` (falls back to `"chore: auto-commit worktree changes"`), and commits.
     - *"Provide commit message"* — prompts for a custom message, then stages (`git add -u`) and commits.
     - Canceling either dialog halts the merge.
   - **Non-interactive**: auto-commits tracked changes directly via `autoCommitWithAIMessage()`. If auto-commit fails, the merge is halted.
4. **Detect untracked files and confirm copy-back** (`detectAndConfirmUntracked`) — list untracked files in the worktree, filter to those not already present in main, analyze each file (binary detection + line count), and show a confirmation dialog. See [Untracked Files](#untracked-files-merge) for details.
5. **Stash main worktree if dirty** (`stashMainIfDirty`) — if the main worktree has tracked uncommitted changes, run `git stash` and record that a stash was created.
6. **Save pre-merge HEAD** (`getPreMergeHead`) — capture the current HEAD commit via `git rev-parse HEAD` for potential rollback.
7. **Checkout main and merge** (`checkoutAndMerge`) — `git checkout <mainBranch>` then `git merge <targetBranch>`:
   - If checkout fails and a stash exists, reapply the stash (`git stash apply`) to restore the working tree.
   - If the merge has conflicts, list the conflicted files (via `git diff --name-only --diff-filter=U`), notify the user with instructions to resolve or abort, and halt. The worktree is **not** removed. Any stash is preserved (not applied).
8. **Verify merge integrity** (`verifyOrFailMerge`) — run `verifyMergeIntegrity()` which checks that (a) the main worktree has no unexpected tracked dirty files, and (b) the worktree branch is an ancestor of main (`merge-base --is-ancestor`). On failure: list errors, roll back via `git reset --hard <preMergeHead>`, preserve the worktree, and halt.
9. **Restore stash** — if main was stashed, apply it (`git stash apply`). On success, drop the stash (`git stash drop`). On failure, warn with recovery instructions (`git stash list` / `git stash apply`).
10. **Finalize** (`finalizeMerge`):
    - Copy confirmed untracked files via `copyFilesWithOverwrite()` (if any were confirmed in step 4).
    - Ask the user whether to delete the worktree (`"Delete worktree?"`). In non-interactive mode, the worktree is always kept.
    - If deleted: `git worktree remove -f` + `git worktree prune`.
    - Update state: set `currentBranch` to main, call `switchCwd()`, update footer, notify success.

### Untracked Files {#untracked-files-merge}

When merging a worktree, untracked files in the worktree that don't exist in the main working directory are detected and offered for copy-back to main.

- **Detection**: `getUntrackedFiles(pi, wt.path)` via `git ls-files -z --others --exclude-standard` — respects `.gitignore`.
- **Filtering**: only files not already present in main (via `existsSync`) are candidates.
- **Analysis**: each file is analyzed via `analyzeFile()` — checks for binary content (NUL byte scan of first 8 KB) and counts lines. Binary files show `(binary)`, text files show color-coded line counts (e.g. `+42` in green).
- **Confirmation (interactive)**: a dialog lists the candidate files and asks "Copy untracked files to main?". If declined, copy is skipped entirely (info notification).
- **Non-interactive**: untracked files are **not** copied (safe default).
- **Copy**: happens after the merge is verified, before the worktree deletion prompt. `copyFilesWithOverwrite()` copies files, overwriting any existing files in main. Individual copy failures are reported as warnings but don't prevent the merge from completing.
- **Timing**: detection runs **before** the tracked-changes commit so that untracked files are captured while still untracked.

### Merge Conflict Handling

If the merge has conflicts:

- The merge is **not** committed.
- The worktree is **not** removed.
- Conflicted files are listed by name in the error message.
- A stash (if any) is **preserved** (not applied). The message instructs the user to run `git stash list` / `git stash apply` to recover.
- The user is instructed to resolve conflicts or run `git merge --abort`.

### Error Cases

| Condition                                          | Message / Behavior                                                                                         |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| No args + on default branch                        | `"Usage: /wt-merge <branch-name> (currently on <default>, no worktree to merge)"`                           |
| Invalid branch name                                | Specific validation error                                                                                  |
| Not in a git repo                                  | `"Not inside a git repository"`                                                                            |
| Merging default into itself                        | `"Cannot merge the <default> branch into itself"`                                                          |
| No worktree for branch                             | `"No worktree found for branch '<name>'"`                                                                  |
| User cancels merge confirmation                    | `"Merge cancelled"` (info)                                                                                 |
| Tracked changes — user cancels select dialog       | `"Merge cancelled"` (info)                                                                                 |
| Tracked changes — user cancels input (empty msg)   | `"Merge cancelled"` (info)                                                                                 |
| Auto-commit fails (interactive)                    | `"Auto-commit failed: <message>"` (error) — merge halted                                                   |
| Auto-commit fails (non-interactive)                | `"Auto-commit failed: <message>. Merge halted — uncommitted changes remain in worktree."` (error)         |
| Checkout fails                                     | `"Failed to checkout <branch>: <stderr>"` (error). Stash reapplied if one was created.                     |
| Merge conflicts                                    | Lists conflicted files. Instructs `git merge --abort`. Stash preserved.                                    |
| Merge verification fails                           | Errors listed individually. Main rolled back via `git reset --hard`. Worktree preserved.                   |
| Stash apply fails                                  | `"Warning: failed to reapply stashed changes…"` — instructions to recover via `git stash list`/`apply`.   |
| Untracked copy — user declines                     | `"Skipping untracked file copy."` (info)                                                                   |
| Untracked copy — partial failure                   | `"Warning: failed to copy N file(s): …"` (warning)                                                         |
| Worktree remove fails                              | `"Merged but failed to remove worktree: <stderr>"` (warning, not error)                                    |
| User declines worktree deletion                    | Success notification includes `"(worktree kept)"`                                                          |

---

## `/wt-cleanup`

Remove a worktree without merging. Refuses if there are uncommitted changes. Requires confirmation.

**Usage:**

```
/wt-cleanup <branch-name>
/wt-cleanup                  # cleans up the current worktree
```

| Parameter     | Required | Description                                                      |
| ------------- | -------- | ---------------------------------------------------------------- |
| `branch-name` | ✗        | Branch whose worktree to remove. Defaults to the current branch. |

**Tab completion:** Branch names from existing worktrees.

### Resolution Logic

- If `<branch-name>` is provided → use it.
- If omitted → use `getCurrentBranch()`.
- If omitted AND currently on the default branch → error (cannot infer target).

### Validation

1. Branch name must pass `validateBranchName()`.
2. Cannot remove the default branch's worktree.
3. A worktree must exist for the target branch.
4. Worktree must not have uncommitted changes.

### Flow

1. **Resolve target** (from args or current branch).
2. **Validate** branch name.
3. **Detect main repo** if not already known.
4. **Guard** against removing the default worktree.
5. **Find the worktree** for the target branch.
6. **Check for uncommitted changes** — refuse if dirty.
7. **Confirm** the destructive operation via `ctx.ui.confirm()`.
8. **Remove the worktree** via `git worktree remove -f`. If that fails, tries `git worktree remove -f -f` for locked worktrees.
9. **Prune** stale worktree metadata.
10. **Delete the branch** via `git branch -d` (safe delete — only if fully merged).
11. **Update state**: if the removed worktree was the current one, switch to the default branch. Update footer, notify success.

### Branch Deletion

After removing the worktree, `/wt-cleanup` attempts `git branch -d <name>`:

- **Success**: branch was fully merged → deleted. Notified as `"Branch '<name>' deleted"`.
- **Failure**: branch was not fully merged → kept. User is shown the force-delete command: `"Use 'git branch -D <name>' to force-delete."`

### Error Cases

| Condition                        | Message                                                                                       |
| -------------------------------- | --------------------------------------------------------------------------------------------- |
| No args + on default branch      | `"Usage: /wt-cleanup <branch-name> (currently on <default>, specify a worktree to clean up)"` |
| Invalid branch name              | Specific validation error                                                                     |
| Not in a git repo                | `"Not inside a git repository"`                                                               |
| Target is the default branch     | `"Cannot remove the <default> worktree"`                                                      |
| No worktree for branch           | `"No worktree found for branch '<name>'"`                                                     |
| Uncommitted changes              | `"Worktree '<name>' has uncommitted changes. Use /wt-merge..."`                               |
| User cancels confirmation        | `"Cleanup cancelled"`                                                                         |
| Remove fails (even double-force) | `"Failed to remove worktree: <stderr>"`                                                       |
