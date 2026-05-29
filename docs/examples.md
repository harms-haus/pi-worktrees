# Examples

Practical walkthroughs for common pi-worktrees workflows.

---

## Typical Feature Workflow

Create a feature branch, work on it, then merge it back and clean up.

```
# You're on the default branch (e.g. main, master)
# No worktree indicator in the footer

# 1. Create a new feature worktree — switches CWD automatically
/wt-create feature/login

# Footer now shows: 🌳 feature/login
# You're now in .git/worktrees/feature/login/
# Any untracked files in your current directory (e.g. .env files,
# configuration files not yet committed) are automatically copied
# to the new worktree.

# 2. Work on the feature — edit files, commit, etc.
# The agent operates in the worktree directory

# 3. Done with the feature — merge into default branch and remove worktree
/wt-merge feature/login
# ✓ Auto-commits any uncommitted changes
# ✓ Checks out default branch
# ✓ Merges feature/login into default branch
# ✓ Removes the worktree
# ✓ Switches CWD back to the main repo

# Footer returns to normal (no 🌳 indicator)
```

---

## Parallel Features

Work on multiple features simultaneously by creating separate worktrees.

```
# Create two feature worktrees
/wt-create feature/login
# Untracked files are carried over to feature/login's worktree
/wt-create feature/dashboard
# Untracked files from the current directory are carried over again

# Both worktrees exist on disk:
#   .git/worktrees/feature/login/
#   .git/worktrees/feature/dashboard/

# Switch between them freely
/wt-switch feature/login
# ... work on login ...

/wt-switch feature/dashboard
# ... work on dashboard ...

# Switch back to the default branch for a hotfix
/wt-switch main
# ... apply hotfix ...

/wt-switch feature/login
# ... continue working on login ...

# Merge features one at a time
/wt-merge feature/login
/wt-merge feature/dashboard
```

---

## Cleanup Without Merge

Remove an abandoned or experimental worktree without merging its changes.

```
# Create an experiment
/wt-create experiment/new-approach

# ... decide it's not going to work out ...

# If there are no uncommitted changes, clean up directly
/wt-cleanup experiment/new-approach
# ✓ Confirmation prompt appears
# ✓ Worktree is force-removed
# ✓ Branch is deleted (if fully merged) or kept with instructions

# If the worktree has uncommitted changes, cleanup is refused:
/wt-cleanup experiment/new-approach
# ✗ "Worktree 'experiment/new-approach' has uncommitted changes."
# → Commit or stash first, or use /wt-merge instead

# Clean up from within the worktree (no argument needed)
/wt-switch experiment/new-approach
/wt-cleanup
# Since you're ON experiment/new-approach, it infers the target
```

---

## Custom Directory Configuration

Store worktrees outside the `.git` directory for organizational or disk-space reasons.

Configure in `~/.pi/agent/settings.json`:

```json
{
  "worktrees": {
    "baseDir": "../worktrees/"
  }
}
```

Now worktrees are created as siblings to the repo directory:

```
projects/
├── my-app/                    # main repo
│   ├── .git/
│   └── src/
└── worktrees/
    ├── feature/login/         # worktree for feature/login
    └── feature/dashboard/     # worktree for feature/dashboard
```

Absolute paths also work:

```json
{
  "worktrees": {
    "baseDir": "/tmp/worktrees/"
  }
}
```

> **Note:** Tilde (`~`) paths are **not** supported for `baseDir`. Use `$HOME` expansion in your shell or specify an absolute path instead:
>
> ```bash
> # Example: resolve the path manually
> echo '{"worktrees":{"baseDir":"'$HOME'/worktrees/"}}' > ~/.pi/agent/settings.json
> ```

---

## Non-Main Default Branch

When your repo uses `master`, `develop`, or another branch as the default, pi-worktrees detects it automatically.

```
# Repo with "develop" as default branch
# Detected via git symbolic-ref refs/remotes/origin/HEAD

/wt-create feature/api
# Creates worktree branched from current HEAD

/wt-switch develop
# Switches back to the detected default branch

/wt-merge feature/api
# Merges feature/api into develop

/wt-cleanup old-feature
# Cleans up worktree, stays on develop
```

The default branch is detected once at session start and cached in module-level state. It's used for:

- Footer status display (no 🌳 indicator when on the default branch)
- `/wt-switch` — accepting the default branch name as a target
- `/wt-merge` — knowing which branch to merge into
- `/wt-cleanup` — preventing removal of the default worktree

---

## Quick Reference

| Goal | Command |
|---|---|
| Create and switch to a new feature | `/wt-create feature-name` |
| Switch to an existing worktree | `/wt-switch feature-name` |
| Return to the default branch | `/wt-switch main` |
| Merge feature and remove worktree | `/wt-merge feature-name` |
| Merge current worktree (no arg) | `/wt-merge` |
| Remove a worktree without merging | `/wt-cleanup feature-name` |
| Remove current worktree (no arg) | `/wt-cleanup` |
