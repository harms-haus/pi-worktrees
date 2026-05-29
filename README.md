# pi-worktrees — Git worktree management for pi-coding-agent

Manage git worktrees with slash commands for creating, switching, merging, and cleaning up worktrees. Each worktree gets its own directory and working tree, so you can work on multiple branches simultaneously without stashing or committing.

## Requirements

- **pi-coding-agent >= 0.74.0**
- **[pi-cwd](https://github.com/harms-haus/pi-cwd) extension must be installed** — required for CWD switching when moving between worktrees

## Installation

**Via pi install:**

```bash
pi install pi-worktrees
```

**Manual:**

Copy the extension directory to `~/.pi/agent/extensions/pi-worktrees/`.

## Commands

| Command | Description |
|---|---|
| `/wt-create <branch-name>` | Create a worktree for the branch (creates the branch if it doesn't exist) and switch to it |
| `/wt-switch <branch-name>\|<default-branch>` | Switch to an existing worktree or back to the default branch |
| `/wt-merge [<branch-name>]` | Merge a worktree's branch into the default branch with post-merge verification and optional worktree cleanup. Prompts for commit method when tracked changes are detected |
| `/wt-cleanup [<branch-name>]` | Remove a worktree (requires confirmation). Refuses if there are uncommitted changes |

> The default branch is detected automatically from git (e.g. `main`, `master`, `develop`).

All commands support tab-completion for branch names.

## Settings

Configure the worktree storage directory in `~/.pi/agent/settings.json`:

```json
{
  "worktrees": {
    "baseDir": "./.git/worktrees/"
  }
}
```

- **`worktrees.baseDir`** — Where worktrees are stored on disk.
  - **Default:** `./.git/worktrees/`
  - Can be an **absolute path** (e.g., `/tmp/worktrees/`) or **relative to the repo root** (e.g., `../worktrees/`).
  - A trailing slash is added automatically if omitted.

## Behavior Notes

- **Confirmation prompts** — Destructive operations (`/wt-merge` and `/wt-cleanup`) require confirmation before proceeding. `/wt-merge` has a second confirmation dialog for copying untracked files back to the main repo (see below).
- **Uncommitted changes protection** — `/wt-cleanup` refuses to remove worktrees with uncommitted changes. Use `/wt-merge` instead, or commit/stash your changes first.
- **Merge conflicts** — If a merge has conflicts, the operation is aborted and the worktree is preserved. You'll get clear instructions for resolving the conflict or canceling the merge.
- **Branch cleanup** — `/wt-cleanup` attempts to delete the branch after removing the worktree. If the branch wasn't fully merged, you'll be shown the command to force-delete it.
- **Auto-commit** — When merging a worktree that has tracked uncommitted changes (staged or unstaged modifications to tracked files, excluding untracked files), the user is presented with a choice:
  - **"Let agent summarize & commit"** — stages tracked-file changes via `git add -u`, generates a commit message via `pi --print` subprocess, and commits. If the AI call fails or times out, a fallback message (`chore: auto-commit worktree changes`) is used. If auto-commit itself fails, the merge is halted and the worktree is preserved.
  - **"Provide commit message"** — prompts for a custom message, stages tracked files, and commits. An empty message cancels the merge.
  - **Cancel** — dismissing the dialog aborts the merge.
  - **Non-interactive mode** — auto-commits without a dialog, using the AI-generated message (or fallback).
- **Untracked files are copied to new worktrees** — When creating a worktree with `/wt-create`, any untracked files in your current directory (respecting `.gitignore`) are automatically copied to the new worktree. This includes files not yet added to git, but excludes files matched by `.gitignore` patterns. Directories, symlinks, and files that already exist in the new worktree are skipped. This is a best-effort operation — individual copy failures are silently ignored.
- **Untracked files are offered for copy-back on merge** — When merging a worktree with `/wt-merge`, untracked files in the worktree that don't exist in the main working directory are detected and presented in a confirmation dialog. The dialog shows file names with color-coded line counts (`+N` for text files) or `(binary)` for binary files. If confirmed, the files are copied to the main repo after the merge completes. Existing files in the main repo are overwritten. Individual copy failures are reported as warnings. Detection happens before auto-commit to capture untracked files before `git add -A` stages them.
- **Worktree placement** — By default, worktrees are created inside `.git/worktrees/<branch-name>/` within the main repository.
- **Branch validation** — Branch names are validated before creation. Names cannot be empty, start with `-`, equal `HEAD`, or contain special characters (`..`, spaces, `~`, `^`, `:`, `\`, control characters, or end in `.lock`).
- **Stash during merge** — If the main worktree has tracked dirty changes (not untracked files) when a merge is performed, those changes are stashed before checkout. After the merge passes verification, the stash is restored via `git stash apply` followed by `git stash drop`. If stash apply fails, a warning is shown with recovery instructions (`git stash list` / `git stash apply`) and the stash is preserved. On merge conflict, the stash is not applied; the user is informed that stashed changes are preserved.
- **Merge verification** — After a merge succeeds, `verifyMergeIntegrity` checks that (1) the main worktree has no unexpected tracked dirty files, and (2) the worktree branch is an ancestor of the main branch (all commits are reachable). If verification fails, the main branch is rolled back via `git reset --hard` to the pre-merge HEAD, the worktree is preserved, and the user is advised to review and retry or resolve issues manually.
- **Worktree deletion** — After a successful merge and verification, the user is asked whether to delete the worktree. In non-interactive mode, the worktree is kept by default. The final notification indicates whether the worktree was removed or kept.
- **Session persistence** — Worktree state is persisted to the session branch. When a session restarts, the extension automatically detects the main repo and restores the active worktree.
- **Footer status** — When a worktree is active, the footer displays a 🌳 indicator with the current branch name.

## Examples

A typical feature development workflow:

```
# Start on the default branch (e.g. main, master)
/worktrees are not in use yet

# Create a new feature worktree (switches CWD automatically)
/wt-create feature/login

# Work on the feature... make changes, commit, etc.
# The footer shows: 🌳 feature/login

# Switch back to the default branch for a quick fix
# (Use your repo's detected default branch name)
/wt-switch main

# Switch back to the feature worktree
/wt-switch feature/login

# Feature is done — merge into the default branch and clean up
/wt-merge feature/login

# Remove an abandoned worktree without merging
/wt-cleanup stale-experiment
```

## Documentation

| Document                                                   | Description                                              |
| ---------------------------------------------------------- | -------------------------------------------------------- |
| [Commands](docs/commands.md)                               | Detailed reference for all slash commands                |
| [Examples](docs/examples.md)                               | Practical workflow walkthroughs                          |
| [Configuration Reference](docs/configuration-reference.md) | `worktrees.baseDir` setting and path resolution          |
| [Architecture](docs/architecture.md)                       | Module structure, dependency graph, and data flow        |
| [State Management](docs/state-management.md)               | Session persistence and restoration                      |
| [Testing](docs/testing.md)                                 | Running and writing tests for the extension              |
| [Contributing](docs/contributing.md)                       | Development setup and contribution guidelines            |

## License

[MIT](LICENSE)
