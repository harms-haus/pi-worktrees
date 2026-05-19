# State Management

How pi-worktrees tracks and restores worktree state across session boundaries.

---

## Overview

pi-worktrees uses **module-level closure variables** to track the active worktree during a session, and **session branch entries** to persist that state across session restarts. There is no database or external store — state lives in memory and is restored from the session branch on each new session.

---

## Module-Level State Variables

Defined in `src/state.ts`, these four closure variables are the single source of truth during a session:

| Variable | Type | Default | Purpose |
| --- | --- | --- | --- |
| `mainRepoPath` | `string` | `""` | Absolute path to the main git worktree (repo root). Set once on `session_start`. |
| `currentWorktreePath` | `string` | `""` | Absolute path to the currently active worktree. Same as `mainRepoPath` when on the default branch. |
| `currentBranch` | `string` | `"main"` | Branch name of the active worktree. Set to the default branch name when on main. |
| `defaultBranch` | `string` | `"main"` | Detected default branch name (e.g. `"main"`, `"master"`, `"develop"`). |

Each variable has a getter and setter exported from `src/state.ts`:

```typescript
export function getMainRepoPath(): string;
export function setMainRepoPath(path: string): void;

export function getCurrentWorktreePath(): string;
export function setCurrentWorktreePath(path: string): void;

export function getCurrentBranch(): string;
export function setCurrentBranch(branch: string): void;

export function getDefaultBranch(): string;
export function setDefaultBranch(branch: string): void;
```

### `resetState()`

Resets all four variables to their defaults. Called on `session_shutdown` to ensure clean state for the next session.

---

## Persistence via `pi.appendEntry`

When the user switches worktrees (via any command that calls `switchCwd`), the extension writes a `WorktreeChangeData` entry to the session branch:

```typescript
pi.appendEntry(WORKTREE_CHANGE_TYPE, {
  mainRepoPath: getMainRepoPath(),
  currentWorktreePath: targetPath,
  currentBranch: getCurrentBranch(),
  defaultBranch: getDefaultBranch(),
});
```

This entry is typed as a custom entry in the session branch, using the `worktree-change` custom type.

### `WorktreeChangeData` Schema

Defined in `src/types.ts`:

```typescript
export const WORKTREE_CHANGE_TYPE = "worktree-change" as const;

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
```

| Field | Required | Description |
| --- | --- | --- |
| `mainRepoPath` | ✓ | Absolute path to the main repo. Validated as an existing directory during restoration. |
| `currentWorktreePath` | ✓ | Absolute path to the active worktree. Falls back to `mainRepoPath` if the path no longer exists. |
| `currentBranch` | ✓ | Branch name of the active worktree. |
| `defaultBranch` | ✗ | Detected default branch. Restored when present in the entry data. |

---

## Restoration from Session Branch

`restoreWorktreeFromBranch(ctx)` is called on both `session_start` and `session_tree`. It:

1. Reads the session branch entries via `ctx.sessionManager.getBranch()`.
2. Iterates entries in **reverse chronological order** (newest first).
3. Finds the first entry with `customType === "worktree-change"` that passes validation.
4. Validates the entry data:
   - `mainRepoPath` must be an existing directory (`statSync` check).
   - `currentWorktreePath` must exist (`existsSync` check). If not, falls back to `mainRepoPath` with the default branch.
5. Restores all four state variables from the entry data.
6. Returns immediately after the first valid entry.

If no valid entry is found, state remains at defaults and will be populated when the user runs a command.

### Validation Function

```typescript
function isValidWorktreeData(data: unknown): data is WorktreeChangeData {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.mainRepoPath === "string" &&
    typeof d.currentWorktreePath === "string" &&
    typeof d.currentBranch === "string"
  );
}
```

---

## Lifecycle

```
session_start
  │
  ├── detectMainRepo()    → setMainRepoPath()
  ├── detectDefaultBranch() → setDefaultBranch()
  ├── restoreWorktreeFromBranch()  → restores from session entries
  └── updateFooterStatus() → shows 🌳 indicator if not on default
  │
  ... commands run, state changes, entries appended ...
  │
session_tree
  │
  ├── restoreWorktreeFromBranch()  → re-restores from session entries
  └── updateFooterStatus()
  │
session_shutdown
  │
  └── resetState()         → clears all state to defaults
```

---

## Footer Status

`updateFooterStatus(ctx)` updates the pi TUI footer:

- **On the default branch**: calls `ctx.ui.setStatus("worktree", undefined)` — removes the indicator.
- **On a worktree**: calls `ctx.ui.setStatus("worktree", ctx.ui.theme.fg("accent", "🌳 " + currentBranch))` — shows the branch name.

Only runs when `ctx.hasUI` is `true` (no-op in headless mode).

---

## Who Writes State

| Operation | Who | What changes |
| --- | --- | --- |
| `session_start` | `src/index.ts` | Sets `mainRepoPath`, `defaultBranch`; restores from session |
| `/wt-create` | `src/commands/wt-create.ts` | Sets `currentBranch`, calls `switchCwd` (which sets `currentWorktreePath` + appends entry) |
| `/wt-switch` | `src/commands/wt-switch.ts` | Sets `currentBranch`, calls `switchCwd` |
| `/wt-merge` | `src/commands/wt-merge.ts` | Sets `currentBranch` to default, calls `switchCwd` |
| `/wt-cleanup` | `src/commands/wt-cleanup.ts` | Sets `currentBranch` to default if removed current worktree, calls `switchCwd` |
| `session_shutdown` | `src/index.ts` | Calls `resetState()` |
