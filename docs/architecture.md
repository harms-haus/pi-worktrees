# Architecture

Technical reference for developers working on or extending pi-worktrees internals.

---

## System Overview

pi-worktrees is a **pi coding agent extension** that provides git worktree management through four slash commands. It hooks into 3 framework events to detect the main repository, restore worktree state across session restarts, update the footer status indicator, and clean up on shutdown.

The extension has no HTTP server, no database, and no background processes. It is entirely event-driven: the pi agent runtime calls into registered callbacks, and the extension responds by executing git commands, mutating closure-captured state, switching the agent's CWD, and sending user-visible notifications.

**Core responsibilities:**

1. **Worktree creation** — `/wt-create` creates a new git worktree (and branch if needed), switches the agent's CWD into it, and persists the state change.
2. **Worktree switching** — `/wt-switch` moves the agent's CWD between existing worktrees or back to the default branch worktree.
3. **Worktree merging** — `/wt-merge` auto-commits uncommitted changes, merges the feature branch into the default branch, removes the worktree, and prunes stale data.
4. **Worktree cleanup** — `/wt-cleanup` force-removes a worktree (after confirmation) and optionally deletes the branch.
5. **State persistence** — Every worktree change is appended to the session branch via `pi.appendEntry`, enabling full reconstruction on session resume or branch switch.
6. **Footer status** — A `🌳` indicator in the footer shows the current branch when not on the default branch.

---

## Module Map

| File                         | Responsibility                                                                                                                  | Key Exports                                                                                                                                                                                                                               | Internal Dependencies                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `src/index.ts`               | Entry point; registers 4 commands + 3 event handlers                                                                            | `default` (extension function)                                                                                                                                                                                                            | `state.ts`, `commands/*`, `completions.ts`, `worktree.ts`        |
| `src/types.ts`               | Type definitions                                                                                                                | `WorktreeInfo`, `WORKTREE_CHANGE_TYPE`, `WorktreeChangeData`, `UntrackedFileInfo`                                                                                                                                                         | —                                                                |
| `src/state.ts`               | Module-level state variables, accessors, restoration from session branch, footer status updates                                 | `getMainRepoPath`, `setMainRepoPath`, `getCurrentWorktreePath`, `setCurrentWorktreePath`, `getCurrentBranch`, `setCurrentBranch`, `getDefaultBranch`, `setDefaultBranch`, `resetState`, `updateFooterStatus`, `restoreWorktreeFromBranch` | `types.ts`                                                       |
| `src/git.ts`                 | Git execution wrapper, worktree porcelain parsing, worktree queries                                                             | `gitExec`, `parseWorktreePorcelain`, `getWorktreeList`, `findWorktreeByBranch`, `getMainWorktree`, `getUntrackedFiles`                                                                                                                    | `state.ts`, `types.ts`                                           |
| `src/worktree.ts`            | Worktree operations: base directory resolution, CWD switching, repo detection, dirty check, tracked-changes check, auto-commit, merge verification, untracked file copying | `resolveBaseDir`, `switchCwd`, `ensureMainRepo`, `detectMainRepo`, `hasUncommittedChanges`, `hasTrackedChanges`, `detectDefaultBranch`, `autoCommitWithAIMessage`, `verifyMergeIntegrity`, `copyUntrackedFiles`, `analyzeFile`, `copyFilesWithOverwrite`, `formatFileListForConfirm` | `git.ts`, `state.ts`, `types.ts`                                 |
| `src/validation.ts`          | Input validation for branch names and tilde expansion                                                                           | `validateBranchName`, `expandTilde`                                                                                                                                                                                                       | —                                                                |
| `src/completions.ts`         | Tab-completion for branch names across all worktree commands                                                                    | `getBranchCompletions`                                                                                                                                                                                                                    | `git.ts`, `state.ts`                                             |
| `src/commands/wt-create.ts`  | `/wt-create` handler                                                                                                            | `handleWtCreate`                                                                                                                                                                                                                          | `git.ts`, `worktree.ts`, `validation.ts`, `state.ts`             |
| `src/commands/wt-switch.ts`  | `/wt-switch` handler                                                                                                            | `handleWtSwitch`                                                                                                                                                                                                                          | `git.ts`, `worktree.ts`, `state.ts`                              |
| `src/commands/wt-merge.ts`   | `/wt-merge` handler                                                                                                             | `handleWtMerge`                                                                                                                                                                                                                           | `git.ts`, `worktree.ts`, `validation.ts`, `state.ts`, `types.ts` |
| `src/commands/wt-cleanup.ts` | `/wt-cleanup` handler                                                                                                           | `handleWtCleanup`                                                                                                                                                                                                                         | `git.ts`, `worktree.ts`, `validation.ts`, `state.ts`             |

### Dependency Graph

```
index.ts
├── commands/
│   ├── wt-create.ts ──── git.ts, worktree.ts, validation.ts, state.ts
│   ├── wt-switch.ts ──── git.ts, worktree.ts, state.ts
│   ├── wt-merge.ts  ──── git.ts, worktree.ts, validation.ts, state.ts, types.ts
│   └── wt-cleanup.ts─── git.ts, worktree.ts, validation.ts, state.ts
├── completions.ts ─────── git.ts, state.ts
├── state.ts ───────────── types.ts
├── worktree.ts ────────── git.ts, state.ts, types.ts
├── git.ts ─────────────── state.ts, types.ts
├── validation.ts ──────── (standalone)
└── types.ts ───────────── (standalone)
```

```
types.ts ─────── (no imports)
validation.ts ── (no imports)
git.ts ──────── types.ts, state.ts
state.ts ─────── types.ts
worktree.ts ──── git.ts, state.ts, types.ts
completions.ts ──git.ts, state.ts
commands/* ───── git.ts, worktree.ts, validation.ts, state.ts
index.ts ──────── state.ts, commands/*, completions.ts, worktree.ts
```

---

## Data Flow Diagram

The diagram below traces the complete lifecycle from user command invocation through git execution, state mutation, and CWD switching.

```
User
  │
  ▼
┌──────────────────────────────────────────────────────────────────────┐
│  /wt-create feature/login                                            │
│                                                                      │
│  1. validateBranchName(branchName)          ← validation.ts         │
│  2. detectMainRepo(pi, ctx.cwd)             ← worktree.ts           │
│  3. resolveBaseDir(mainRepoPath)            ← worktree.ts           │
│  4. gitExec(["worktree", "add", ...])       ← git.ts                │
│  5. getUntrackedFiles(pi, ctx.cwd)          ← git.ts                │
│     └── copyUntrackedFiles(files, ctx.cwd, worktreePath) ← worktree.ts│
│  6. setCurrentBranch(branchName)            ← state.ts              │
│  7. switchCwd(pi, ctx, worktreePath)        ← worktree.ts           │
│     ├── pi.sendUserMessage("/cwd " + path)                          │
│     ├── setCurrentWorktreePath(path)       ← state.ts              │
│     └── pi.appendEntry(WORKTREE_CHANGE_TYPE, data)                  │
│  8. updateFooterStatus(ctx)                 ← state.ts              │
│  9. ctx.ui.notify("Created worktree...")    ← TUI                   │
└──────────────────────────────────────────────────────────────────────┘
```

```
User
  │
  ▼
┌──────────────────────────────────────────────────────────────────────┐
│  /wt-merge feature/login                                             │
│                                                                      │
│  1. resolveMergeTarget(args, ctx, pi)                               │
│     ├── resolveTargetBranch(args, ctx)                              │
│     ├── validateBranchName(targetBranch)                            │
│     ├── ensureMainRepo(pi, ctx)           ← worktree.ts             │
│     ├── guard: target ≠ default branch                              │
│     ├── getWorktreeList(pi) → findWorktreeByBranch(worktrees, target)│
│     └── getMainWorktree(worktrees) → resolve mainBranch             │
│                                                                      │
│  2. ctx.ui.confirm("Merge worktree?")     ← aborts if declined     │
│                                                                      │
│  3. handleTrackedChanges(pi, ctx, wt.path)                          │
│     ├── hasTrackedChanges(pi, wt.path)   ← worktree.ts              │
│     │   └── gitExec(["status", "--porcelain"]) — filter out "?? "  │
│     └── if dirty + UI: ctx.ui.select →                              │
│         ├── "Let agent summarize & commit":                         │
│         │   autoCommitWithAIMessage(pi, wt.path) ← worktree.ts     │
│         │   ├── gitExec(["add", "-u"])                              │
│         │   ├── gitExec(["diff", "--cached"])                       │
│         │   ├── spawnSync("pi", ["--print"])  ← AI commit message  │
│         │   └── gitExec(["commit", "-m", msg])                      │
│         └── "Provide commit message":                               │
│             ctx.ui.input → gitExec(["add", "-u"]) → commit          │
│     └── if dirty + non-interactive: autoCommitWithAIMessage()        │
│                                                                      │
│  4. detectAndConfirmUntracked(pi, ctx, wt.path, mainRepoPath)       │
│     ├── getUntrackedFiles(pi, wt.path)   ← git.ts                  │
│     ├── filter: files not present in main (existsSync)              │
│     ├── analyzeFile(path) per file       ← worktree.ts              │
│     ├── formatFileListForConfirm(files)  ← worktree.ts              │
│     └── ctx.ui.confirm("Copy untracked files to main?")             │
│                                                                      │
│  5. stashMainIfDirty(pi, ctx)             ← checks tracked changes │
│     └── hasTrackedChanges(pi, mainRepoPath) → gitExec(["stash"])    │
│                                                                      │
│  6. getPreMergeHead(pi)                   ← gitExec(["rev-parse", "HEAD"])│
│                                                                      │
│  7. checkoutAndMerge(pi, ctx, mainBranch, targetBranch, didStash)   │
│     ├── gitExec(["checkout", mainBranch])                           │
│     ├── gitExec(["merge", targetBranch])                            │
│     ├── on conflict: gitExec(["diff", "--name-only", "--diff-filter=U"])│
│     │   └── notify conflicts, stash preserved, return {ok: false}  │
│     └── on checkout fail: gitExec(["stash", "apply"]) rollback      │
│                                                                      │
│  8. verifyOrFailMerge(pi, ctx, mainBranch, targetBranch, preHead)   │
│     ├── verifyMergeIntegrity(pi, mainRepoPath, ...) ← worktree.ts  │
│     │   ├── gitExec(["status", "--porcelain"]) — tracked dirty check│
│     │   └── gitExec(["merge-base", "--is-ancestor", ...])           │
│     └── on failure: gitExec(["reset", "--hard", preMergeHead])      │
│                                                                      │
│  9. if didStash: gitExec(["stash", "apply"]) → gitExec(["stash", "drop"])│
│                                                                      │
│ 10. finalizeMerge(pi, ctx, target, filesToCopy)                     │
│     ├── copyFilesWithOverwrite(files, wt.path, mainRepoPath)        │
│     ├── askToDeleteWorktree(ctx, target.branch)                     │
│     │   └── if yes: gitExec(["worktree", "remove", "-f", wt.path])  │
│     │       └── gitExec(["worktree", "prune"])                      │
│     ├── setCurrentBranch(target.mainBranch)  ← state.ts            │
│     ├── switchCwd(pi, ctx, mainRepoPath)     ← worktree.ts         │
│     ├── updateFooterStatus(ctx)              ← state.ts            │
│     └── ctx.ui.notify("Merged ... into ... and removed worktree")   │
└──────────────────────────────────────────────────────────────────────┘
```
---

## Closure State Model

The extension's runtime state lives as **module-level variables** in `state.ts`. Unlike pi-workflows which uses closure variables inside the default export, pi-worktrees centralizes all mutable state in a dedicated module with getter/setter accessors.

```
state.ts
┌──────────────────────────────────────────────────────┐
│  let mainRepoPath: string = "";                       │
│  let currentWorktreePath: string = "";                │
│  let currentBranch: string = "main";                  │
│  let defaultBranch: string = "main";                  │
│                                                      │
│  // Getters (read-only)                               │
│  getMainRepoPath(): string                            │
│  getCurrentWorktreePath(): string                     │
│  getCurrentBranch(): string                           │
│  getDefaultBranch(): string                           │
│                                                      │
│  // Setters (mutation)                                │
│  setMainRepoPath(path: string): void                  │
│  setCurrentWorktreePath(path: string): void            │
│  setCurrentBranch(branch: string): void               │
│  setDefaultBranch(branch: string): void               │
│                                                      │
│  // Lifecycle                                         │
│  resetState(): void                                   │
│  updateFooterStatus(ctx): void                        │
│  restoreWorktreeFromBranch(ctx): void                 │
└──────────────────────────────────────────────────────┘
```

### Where state is mutated

| Site                       | How                                                                      | Effect                                           |
| -------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------ |
| `session_start` handler    | `setMainRepoPath()`, `setDefaultBranch()`, `restoreWorktreeFromBranch()` | Detects repo, restores persisted worktree state  |
| `session_tree` handler     | `restoreWorktreeFromBranch()`                                            | Restores state when switching session branches   |
| `session_shutdown` handler | `resetState()`                                                           | Clears all state on session end                  |
| `/wt-create` command       | `setMainRepoPath()`, `setCurrentBranch()`, `switchCwd()`                 | Creates worktree and switches to it              |
| `/wt-switch` command       | `setMainRepoPath()`, `setCurrentBranch()`, `switchCwd()`                 | Switches to existing worktree                    |
| `/wt-merge` command        | `setMainRepoPath()`, `setCurrentBranch()`, `switchCwd()`                 | Merges, removes worktree, switches to default    |
| `/wt-cleanup` command      | `setMainRepoPath()`, `setCurrentBranch()`, `switchCwd()`                 | Removes worktree, optionally switches to default |

---

## Event Subscription Map

### Agent Lifecycle Events

| Event              | Handler              | Purpose                                                                                 | Returns |
| ------------------ | -------------------- | --------------------------------------------------------------------------------------- | ------- |
| `session_start`    | Inline in `index.ts` | Detect main repo from CWD, detect default branch, restore worktree state, update footer | `void`  |
| `session_tree`     | Inline in `index.ts` | Restore worktree state from session branch, update footer                               | `void`  |
| `session_shutdown` | Inline in `index.ts` | Reset all module-level state variables to defaults                                      | `void`  |

### Command Registrations

| Command       | Module                   | Description                                                                                             |
| ------------- | ------------------------ | ------------------------------------------------------------------------------------------------------- |
| `/wt-create`  | `commands/wt-create.ts`  | Create a new worktree (and branch if needed), switch to it. Tab-completes branch names.                 |
| `/wt-switch`  | `commands/wt-switch.ts`  | Switch to an existing worktree or back to the default branch. Tab-completes branch names.               |
| `/wt-merge`   | `commands/wt-merge.ts`   | Merge a worktree's branch into the default branch, auto-commit changes, remove worktree. Tab-completes. |
| `/wt-cleanup` | `commands/wt-cleanup.ts` | Remove a worktree (with confirmation), optionally delete branch. Tab-completes branch names.            |

---

## Git Interaction Pattern

All git commands are executed through the `gitExec` wrapper in `git.ts`, which calls `pi.exec("git", args, { cwd })`. This ensures that:

1. Commands run in the correct working directory (defaulting to `mainRepoPath`).
2. The pi agent runtime captures stdout/stderr and exit codes.
3. Commands are executed within the agent's process management system.

### Key git commands used

| Purpose               | Git command                                        | Module                                             |
| --------------------- | -------------------------------------------------- | -------------------------------------------------- |
| List worktrees        | `git worktree list --porcelain`                    | `git.ts`                                           |
| Create worktree       | `git worktree add [-b <branch>] <path> [<branch>]` | `wt-create.ts`                                     |
| Remove worktree       | `git worktree remove -f <path>`                    | `wt-merge.ts`, `wt-cleanup.ts`                     |
| Prune stale data      | `git worktree prune`                               | `wt-merge.ts`, `wt-cleanup.ts`                     |
| Check branch exists   | `git rev-parse --verify <branch>`                  | `wt-create.ts`                                     |
| Check dirty state     | `git status --porcelain`                           | `worktree.ts`                                      |
| Detect default branch | `git symbolic-ref refs/remotes/origin/HEAD`        | `worktree.ts`                                      |
| Stage tracked only    | `git add -u`                                       | `worktree.ts` (`autoCommitWithAIMessage`), `wt-merge.ts` |
| Get staged diff       | `git diff --cached`                                | `worktree.ts`                                      |
| Commit                | `git commit -m <message>`                          | `worktree.ts`                                      |
| Checkout branch       | `git checkout <branch>`                            | `wt-merge.ts`                                      |
| Merge branch          | `git merge <branch>`                               | `wt-merge.ts`                                      |
| Stash / apply / drop  | `git stash` / `git stash apply` / `git stash drop` | `wt-merge.ts`                                      |
| Delete branch         | `git branch -d <branch>`                           | `wt-cleanup.ts`                                    |
| List untracked files  | `git ls-files -z --others --exclude-standard`      | `git.ts`, used by `wt-create.ts` and `wt-merge.ts` |
| Check tracked changes | `git status --porcelain` (filter `?? `)            | `worktree.ts` (`hasTrackedChanges`)                |
| Verify ancestor        | `git merge-base --is-ancestor <branch> <main>`      | `worktree.ts` (`verifyMergeIntegrity`)             |
| Get current HEAD       | `git rev-parse HEAD`                                | `wt-merge.ts` (`getPreMergeHead`)                  |
| Rollback merge         | `git reset --hard <sha>`                            | `wt-merge.ts` (`verifyOrFailMerge`)                |
| List conflicted files  | `git diff --name-only --diff-filter=U`              | `wt-merge.ts` (`checkoutAndMerge`)                 |

---

## Tech Stack

### Runtime Packages

Only `@earendil-works/pi-coding-agent` is a **peer dependency** listed in `package.json`. The remaining packages are used at runtime through the pi agent dependency chain.

| Package                           | Type | Purpose                                                                                       | Used In                                        |
| --------------------------------- | ---- | --------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `@earendil-works/pi-coding-agent` | Peer | Extension API (`ExtensionAPI`, `ExtensionCommandContext`, `ExecResult`), command registration | All modules except `types.ts`, `validation.ts` |

### Standard Library Usage

| Module               | Purpose                                                                                                                                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node:child_process` | `spawnSync` — synchronous subprocess for AI commit message generation (`pi --print`)                                                                                                                              |
| `node:fs`            | `readFileSync`, `statSync`, `existsSync`, `copyFileSync`, `lstatSync`, `mkdirSync` — reading settings, checking directory existence, copying untracked files, binary detection and line counting in `analyzeFile` |
| `node:os`            | `homedir` — resolving `~` in paths and locating `~/.pi/agent/settings.json`                                                                                                                                       |
| `node:path`          | `isAbsolute`, `join`, `resolve`, `dirname` — path construction for worktree locations, settings resolution, and file copy dest paths                                                                              |

### Key convention: synchronous settings reads

The `resolveBaseDir` function in `worktree.ts` reads `~/.pi/agent/settings.json` **synchronously** at command invocation time. This is intentional — settings are small and rarely change, and the synchronous read avoids complexity in the command handler flow.

---

## Further Reading

- **[Commands Reference](commands.md)** — Detailed reference for all 4 slash commands.
- **[State Management](state-management.md)** — Module-level state, persistence via `pi.appendEntry`, and restoration.
- **[Configuration Reference](configuration-reference.md)** — The `worktrees.baseDir` setting.
- **[Testing](testing.md)** — Running and writing tests for the extension.
- **[Examples](examples.md)** — Typical workflows and usage patterns.
