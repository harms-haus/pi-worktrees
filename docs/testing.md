# Testing

Test suite for pi-worktrees, covering command handlers, state management, git helpers, tab-completion, and the extension entry point.

---

## Test Framework

|                 |                                                            |
| --------------- | ---------------------------------------------------------- |
| **Runner**      | [Vitest](https://vitest.dev/) ^4.1.6                     |
| **Config**      | `vitest.config.ts`                                         |
| **Setup**       | `src/__tests__/setup.ts` — mocks `@earendil-works/pi-coding-agent` |
| **Location**    | `src/**/*.test.ts`                                         |
| **Coverage**    | v8 provider, 90% threshold on all metrics                  |

---

## Running Tests

```bash
# Run all tests
npx vitest run

# Watch mode
npx vitest

# Run a single test file
npx vitest run src/__tests__/commands/wt-create.test.ts

# Run with coverage
npx vitest run --coverage
```

---

## Test Files

| File | What it tests |
| --- | --- |
| `src/__tests__/index.test.ts` | Extension entry point — command registration, event handler wiring |
| `src/__tests__/helpers.test.ts` | Git utilities — `gitExec`, `parseWorktreePorcelain`, `getWorktreeList`, `findWorktreeByBranch`, `getMainWorktree`, `validateBranchName`, `expandTilde` |
| `src/__tests__/worktree.test.ts` | Worktree operations — `resolveBaseDir`, `switchCwd`, `detectMainRepo`, `hasUncommittedChanges`, `detectDefaultBranch`, `ensureMainRepo`, `autoCommitWithAIMessage` |
| `src/__tests__/state.test.ts` | State module — getters/setters, `resetState`, `updateFooterStatus`, `restoreWorktreeFromBranch` |
| `src/__tests__/completions.test.ts` | Tab-completion — branch name filtering, prefix matching, detached HEAD handling |
| `src/__tests__/commands/wt-create.test.ts` | `/wt-create` — branch validation, new vs existing branch, directory conflicts, error flows |
| `src/__tests__/commands/wt-switch.test.ts` | `/wt-switch` — default branch target, missing worktree, branch lookup |
| `src/__tests__/commands/wt-merge.test.ts` | `/wt-merge` — auto-commit, stash/restore, merge conflicts, confirmation flow |
| `src/__tests__/commands/wt-cleanup.test.ts` | `/wt-cleanup` — uncommitted changes guard, locked worktree fallback, branch deletion |

---

## Test Helpers

### `src/__tests__/helpers/mocks.ts`

Mock factories and utilities for creating test doubles:

| Export | Purpose |
| --- | --- |
| `createMockAPI()` | Returns a mock `ExtensionAPI` with all methods as `vi.fn()`, plus individual fn references for assertions |
| `createMockContext(overrides?)` | Returns a mock `ExtensionCommandContext` with `hasUI: true`, stubbed `ui`, `sessionManager`, and `cwd` |
| `captureHandlers(onMock)` | Extracts event handlers registered via `pi.on()` into a keyed object by event name |
| `captureCommand(registerCommandMock)` | Extracts the name and options from the first `registerCommand` call |
| `successResult(stdout?, stderr?)` | Creates a successful `ExecResult` (`code: 0`) |
| `errorResult(stderr?, stdout?)` | Creates a failed `ExecResult` (`code: 1`) |

#### Usage Example

```typescript
import { describe, it, expect, vi } from "vitest";
import { createMockAPI, createMockContext, successResult } from "../helpers/mocks.js";

describe("my feature", () => {
  it("does something", async () => {
    const { api, exec } = createMockAPI();
    exec.mockResolvedValue(successResult("worktree /some/path\nHEAD abc123\n"));

    const ctx = createMockContext();
    // ... call the function under test ...

    expect(exec).toHaveBeenCalledWith("git", expect.any(Array), expect.any(Object));
  });
});
```

### `src/__tests__/setup.ts`

Global setup file that mocks the `@earendil-works/pi-coding-agent` module to avoid importing the real runtime:

```typescript
import { vi } from "vitest";

vi.mock("@earendil-works/pi-coding-agent", () => ({
  createLocalBashOperations: vi.fn(() => ({
    exec: vi.fn(),
  })),
}));
```

---

## Coverage

The project enforces **90% coverage** across all metrics:

| Metric | Threshold |
| --- | --- |
| Statements | 90% |
| Branches | 90% |
| Functions | 90% |
| Lines | 90% |

**Coverage scope** — what's measured:

```
Include:  src/**/*.ts
Exclude:  src/__tests__/**
          src/**/*.test.ts
          src/**/setup.ts
          src/**/helpers/**     (test helpers)
          src/**/*.d.ts
          src/types.ts          (type-only)
```

---

## Adding Tests

### 1. Create a test file

Place it next to the module or in the appropriate `__tests__` subdirectory:

```
src/__tests__/commands/wt-mycommand.test.ts
```

### 2. Import test helpers

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockAPI, createMockContext, successResult, errorResult } from "../helpers/mocks.js";
```

### 3. Mock `../git.js`, `../worktree.js`, `../validation.js`, or `../state.js` as needed

Command tests typically mock the source modules and state module:

```typescript
vi.mock("../git.js", () => ({
  gitExec: vi.fn(),
  getWorktreeList: vi.fn(),
  findWorktreeByBranch: vi.fn(),
  getMainWorktree: vi.fn(),
}));

vi.mock("../worktree.js", () => ({
  resolveBaseDir: vi.fn(),
  switchCwd: vi.fn(),
  detectMainRepo: vi.fn(),
  ensureMainRepo: vi.fn(),
  hasUncommittedChanges: vi.fn(),
  autoCommitWithAIMessage: vi.fn(),
}));

vi.mock("../validation.js", () => ({
  validateBranchName: vi.fn(() => null),
  expandTilde: vi.fn((p: string) => p),
}));

vi.mock("../state.js", () => ({
  getMainRepoPath: vi.fn(() => "/repo"),
  setMainRepoPath: vi.fn(),
  setCurrentBranch: vi.fn(),
  updateFooterStatus: vi.fn(),
  getDefaultBranch: vi.fn(() => "main"),
}));
```

### 4. Write tests organized by command phases

Follow the command's implementation phases (validate → detect → resolve → execute → update state):

```typescript
describe("/wt-mycommand", () => {
  let api: ExtensionAPI;
  let ctx: ExtensionCommandContext;

  beforeEach(() => {
    const mock = createMockAPI();
    api = mock.api;
    ctx = createMockContext();
  });

  it("validates branch name", async () => {
    await handleWtMyCommand("bad..name", ctx, api);
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("invalid"), "error");
  });

  it("succeeds end-to-end", async () => {
    // ... setup mocks ...
    await handleWtMyCommand("feature/x", ctx, api);
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("feature/x"), "info");
  });
});
```

### 5. Verify coverage

```bash
npx vitest run --coverage
```

Ensure your new tests bring coverage back to ≥90% on all metrics.
