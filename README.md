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
| `/wt-merge [<branch-name>]` | Merge the worktree's branch into the default branch, auto-commit uncommitted changes, and remove the worktree |
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

- **Confirmation prompts** — Destructive operations (`/wt-merge` and `/wt-cleanup`) require confirmation before proceeding.
- **Uncommitted changes protection** — `/wt-cleanup` refuses to remove worktrees with uncommitted changes. Use `/wt-merge` instead, or commit/stash your changes first.
- **Merge conflicts** — If a merge has conflicts, the operation is aborted and the worktree is preserved. You'll get clear instructions for resolving the conflict or canceling the merge.
- **Branch cleanup** — `/wt-cleanup` attempts to delete the branch after removing the worktree. If the branch wasn't fully merged, you'll be shown the command to force-delete it.
- **Auto-commit** — When merging a worktree that has uncommitted changes, the extension auto-commits them using an AI-generated message via `pi --print`. If the AI call fails or times out, a fallback message (`chore: auto-commit worktree changes`) is used.
- **Worktree placement** — By default, worktrees are created inside `.git/worktrees/<branch-name>/` within the main repository.
- **Branch validation** — Branch names are validated before creation. Names cannot be empty, start with `-`, equal `HEAD`, or contain special characters (`..`, spaces, `~`, `^`, `:`, `\`, control characters, or end in `.lock`).
- **Stash during merge** — If the main worktree has uncommitted changes when a merge is performed, those changes are stashed and automatically restored after the merge completes.
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
# (You can always use "main" regardless of the actual default branch name)
/wt-switch main

# Switch back to the feature worktree
/wt-switch feature/login

# Feature is done — merge into the default branch and clean up
/wt-merge feature/login

# Remove an abandoned worktree without merging
/wt-cleanup stale-experiment
```

## License

[MIT](LICENSE)
