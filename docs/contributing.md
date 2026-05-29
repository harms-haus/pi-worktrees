# Contributing to pi-worktrees

Thank you for your interest in contributing. This guide covers everything you need to set up a development environment, understand the codebase, and submit changes.

## Development Setup

**Prerequisites:** [Node.js](https://nodejs.org/) (v20+ recommended) and npm.

```bash
git clone <repo-url>
cd pi-worktrees
npm install
```

There is **no build step**. The pi framework loads TypeScript source files directly via `src/index.ts` (declared as `"main"` in `package.json`). TypeScript is used for type-checking only (`noEmit: true` in `tsconfig.json`).

**Run tests:**

```bash
npm test
```

This runs `vitest run` — tests live in `src/__tests__/` and are matched by the pattern `src/**/*.test.ts`.

## Project Structure

```
pi-worktrees/
├── src/
│   ├── index.ts              # Extension entry point & event wiring
│   ├── types.ts              # Type definitions (WorktreeInfo, WorktreeChangeData)
│   ├── state.ts              # Module-level state, accessors, restoration, footer status
│   ├── git.ts                # Git execution wrapper, porcelain parser, worktree queries
│   ├── worktree.ts           # Worktree operations (base dir, switch, detect, auto-commit)
│   ├── validation.ts         # Branch name validation, tilde expansion
│   ├── completions.ts        # Tab-completion for branch names
│   ├── commands/
│   │   ├── wt-create.ts      # /wt-create handler
│   │   ├── wt-switch.ts      # /wt-switch handler
│   │   ├── wt-merge.ts       # /wt-merge handler
│   │   └── wt-cleanup.ts     # /wt-cleanup handler
│   └── __tests__/
│       ├── index.test.ts
│       ├── state.test.ts
│       ├── helpers.test.ts
│       ├── worktree.test.ts
│       ├── completions.test.ts
│       ├── setup.ts
│       ├── commands/
│       │   ├── wt-create.test.ts
│       │   ├── wt-switch.test.ts
│       │   ├── wt-merge.test.ts
│       │   └── wt-cleanup.test.ts
│       └── helpers/
│           ├── mocks.ts
│           └── fixtures.ts
├── docs/                     # Documentation
│   ├── architecture.md
│   ├── commands.md
│   ├── configuration-reference.md
│   ├── contributing.md
│   ├── examples.md
│   ├── state-management.md
│   └── testing.md
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

For a detailed explanation of how these modules interact, see [architecture.md](architecture.md).

## Code Style

- **TypeScript with ESM modules** — `"type": "module"` in `package.json`, `module: "ESNext"` in `tsconfig.json`.
- **Explicit return types** on all exported functions.
- **JSDoc comments** on public/exported functions describing purpose and parameters.
- **`const`** for bindings that are never reassigned; `let` only when reassignment is required.
- **No runtime build** — the project relies on `"noEmit": true` and the host framework's TypeScript loader.
- **ESLint + Prettier** — Run `npm run lint` and `npm run format:check` before pushing.

Example of expected style:

```typescript
/**
 * Validate a proposed git branch name.
 * Returns null if valid, or an error message string if invalid.
 */
export function validateBranchName(name: string): string | null {
  // ...
}
```

## Module Ownership

When adding new functionality, place code in the module that owns that domain:

| Domain                  | Module           | Examples                                                                                                                                            |
| ----------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Type definitions        | `types.ts`       | `WorktreeInfo`, `WorktreeChangeData`, `UntrackedFileInfo`                                                                                           |
| Mutable state           | `state.ts`       | getters, setters, `resetState`, `updateFooterStatus`                                                                                                |
| Git command execution   | `git.ts`         | `gitExec`, `parseWorktreePorcelain`, `getWorktreeList`, `getUntrackedFiles`                                                                         |
| Worktree business logic | `worktree.ts`    | `resolveBaseDir`, `switchCwd`, `autoCommitWithAIMessage`, `copyUntrackedFiles`, `analyzeFile`, `copyFilesWithOverwrite`, `formatFileListForConfirm` |
| Input validation        | `validation.ts`  | `validateBranchName`, `expandTilde`                                                                                                                 |
| Tab-completion          | `completions.ts` | `getBranchCompletions`                                                                                                                              |
| Command handlers        | `commands/`      | One file per command (`wt-*.ts`)                                                                                                                    |

## Adding a New Command

Follow these steps in order:

1. **Create the command handler** — Add a new file `src/commands/wt-<name>.ts` with an exported `async function handleWt<Name>(args, ctx, pi): Promise<void>`.

2. **Implement the logic** — Use functions from `git.ts`, `worktree.ts`, `validation.ts`, and `state.ts` as needed. Follow the patterns established by existing commands (validate args → ensure main repo → perform git operations → update state → notify user).

3. **Wire into `index.ts`** — Import the handler and register it with `pi.registerCommand("wt-<name>", { description, getArgumentCompletions, handler })`.

4. **Add tests** — Create `src/__tests__/commands/wt-<name>.test.ts` using the mock helpers from `helpers/mocks.ts`.

5. **Update documentation** — Add the command to [commands.md](commands.md), [examples.md](examples.md), and the README command table.

## PR Guidelines

- **Focused PRs** — One concern per pull request. Avoid mixing refactors, features, and documentation updates in a single PR unless tightly coupled.
- **All tests pass** — Run `npm test` before pushing. CI will validate this.
- **New features include tests** — Every new exported function or behavior change should have corresponding test coverage.
- **Docs in the same PR** — Documentation updates should accompany the code they describe, not follow in a separate PR.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](https://opensource.org/licenses/MIT), consistent with the project's `"license": "MIT"` in `package.json`.
