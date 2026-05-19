# Configuration Reference

Complete reference for the `worktrees.baseDir` setting used by pi-worktrees.

---

## Overview

pi-worktrees reads a single configuration value from `~/.pi/agent/settings.json`. This setting controls where git worktrees are stored on disk.

---

## Settings File

The extension reads settings from `~/.pi/agent/settings.json` at the path `worktrees.baseDir`. If the file does not exist or the setting is absent, a default value is used.

### `worktrees.baseDir`

| Property    | Value                                 |
| ----------- | ------------------------------------- |
| **Type**    | `string`                              |
| **Default** | `"./.git/worktrees/"`                 |
| **Required**| No                                    |

**Description:** The filesystem directory where new git worktrees are created. When a user runs `/wt-create feature/login`, the worktree is created at `<baseDir>/<branch-name>/`.

---

## Path Resolution

The base directory is resolved relative to the **main repository root** (the path returned by `detectMainRepo`). The resolution rules are:

1. **Absolute path** — Used as-is. For example, `/tmp/worktrees/` results in worktrees at `/tmp/worktrees/feature-login/`.
2. **Relative path** — Resolved against the main repository root via `path.resolve(mainRepoPath, baseDir)`. For example, `"./.git/worktrees/"` for a repo at `/home/user/project` resolves to `/home/user/project/.git/worktrees/`.
3. **Trailing slash** — A trailing `/` is appended automatically if the resolved path does not already end with one. This ensures consistent path joining when appending the branch name.

### Resolution algorithm (in `worktree.ts` → `resolveBaseDir`)

```
1. Read ~/.pi/agent/settings.json
2. Parse JSON, extract settings.worktrees.baseDir
3. If missing or empty → use "./.git/worktrees/"
4. If absolute → use directly
5. If relative → resolve against mainRepoPath
6. Append "/" if not already trailing
7. Return resolved path
```

---

## Example Configurations

### Default (in-repo worktrees)

```json
{
  "worktrees": {
    "baseDir": "./.git/worktrees/"
  }
}
```

Worktrees are created inside the main repository's `.git/worktrees/` directory. This is the default if no setting is provided.

```
/home/user/project/           ← main repo
  .git/
    worktrees/
      feature-login/          ← /wt-create feature-login
      feature-signup/         ← /wt-create feature-signup
```

### Sibling directory

```json
{
  "worktrees": {
    "baseDir": "../worktrees/"
  }
}
```

Worktrees are created as sibling directories to the main repo.

```
/home/user/
  project/                    ← main repo
  worktrees/
    feature-login/            ← /wt-create feature-login
    feature-signup/           ← /wt-create feature-signup
```

### Absolute path

```json
{
  "worktrees": {
    "baseDir": "/tmp/pi-worktrees/"
  }
}
```

All worktrees are placed in a shared temporary directory regardless of repo location.

### Project-specific worktrees folder

```json
{
  "worktrees": {
    "baseDir": "../project-worktrees/"
  }
}
```

```
/home/user/
  my-project/                 ← main repo
  project-worktrees/
    feature-login/            ← /wt-create feature-login
```

---

## Edge Cases

### Settings file missing

If `~/.pi/agent/settings.json` does not exist, the extension silently falls back to the default `./.git/worktrees/`. No error is raised.

### Settings file malformed

If the file exists but is not valid JSON, or if `settings.worktrees` is not an object, the extension silently falls back to the default. The parse error is caught and ignored.

### Empty `baseDir`

If `baseDir` is present but is an empty string (`""`), the extension falls back to the default. The check is `baseDir.length > 0`.

### `baseDir` is not a string

If `baseDir` is present but is not a `string` type (e.g., `null`, `number`, `object`), the extension falls back to the default.

### Trailing slash

The trailing slash is **added automatically** if missing. These two configurations are equivalent:

```json
{ "worktrees": { "baseDir": "./.git/worktrees" } }
{ "worktrees": { "baseDir": "./.git/worktrees/" } }
```

Both resolve to `<repo>/.git/worktrees/`.

---

## Related Documentation

- **[Architecture](architecture.md)** — Module map and dependency graph showing where `resolveBaseDir` is implemented.
- **[Commands Reference](commands.md)** — How `/wt-create` uses the resolved base directory.
- **[Examples](examples.md)** — Custom directory configuration in a full workflow example.
