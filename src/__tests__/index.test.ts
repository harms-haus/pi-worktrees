import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock command handler modules ────────────────────────────────────
vi.mock("../commands/wt-create.js", () => ({ handleWtCreate: vi.fn() }));
vi.mock("../commands/wt-switch.js", () => ({ handleWtSwitch: vi.fn() }));
vi.mock("../commands/wt-merge.js", () => ({ handleWtMerge: vi.fn() }));
vi.mock("../commands/wt-cleanup.js", () => ({ handleWtCleanup: vi.fn() }));

// ── Mock helpers module ─────────────────────────────────────────────
vi.mock("../worktree.js", () => ({
  detectMainRepo: vi.fn(),
  detectDefaultBranch: vi.fn(),
}));

// ── Mock state module ───────────────────────────────────────────────
vi.mock("../state.js", () => ({
  getMainRepoPath: vi.fn(),
  setMainRepoPath: vi.fn(),
  setDefaultBranch: vi.fn(),
  resetState: vi.fn(),
  updateFooterStatus: vi.fn(),
  restoreWorktreeFromBranch: vi.fn(),
}));

// ── Mock completions module ─────────────────────────────────────────
vi.mock("../completions.js", () => ({
  getBranchCompletions: vi.fn(() => Promise.resolve([])),
}));

// ── Imports (after mocks are registered) ─────────────────────────────
import { handleWtCreate } from "../commands/wt-create.js";
import { handleWtSwitch } from "../commands/wt-switch.js";
import { handleWtMerge } from "../commands/wt-merge.js";
import { handleWtCleanup } from "../commands/wt-cleanup.js";
import { detectMainRepo, detectDefaultBranch } from "../worktree.js";
import {
  setMainRepoPath,
  setDefaultBranch,
  resetState,
  updateFooterStatus,
  restoreWorktreeFromBranch,
} from "../state.js";
import extension from "../index.js";
import { createMockAPI, createMockContext, captureHandlers } from "./helpers/mocks.js";

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// Helpers
// ============================================================================

/** Register the extension against a fresh mock API and return captured data */
function setup() {
  const { api, registerCommand, on } = createMockAPI();
  extension(api);

  // Extract registered commands by name
  const commands: Record<string, { options: Record<string, unknown>; index: number }> = {};
  for (let i = 0; i < registerCommand.mock.calls.length; i++) {
    const [name, options] = registerCommand.mock.calls[i];
    commands[name as string] = { options, index: i };
  }

  // Extract event handlers
  const handlers = captureHandlers(on);

  return { api, registerCommand, on, commands, handlers };
}

// ============================================================================
// Tests
// ============================================================================

describe("pi-worktrees extension entry point", () => {
  // ── 1. Registers 4 commands with correct names ───────────────────
  it("registers 4 commands with correct names", () => {
    const { registerCommand, commands } = setup();

    expect(registerCommand).toHaveBeenCalledTimes(4);
    expect(commands).toHaveProperty("wt-create");
    expect(commands).toHaveProperty("wt-switch");
    expect(commands).toHaveProperty("wt-merge");
    expect(commands).toHaveProperty("wt-cleanup");
  });

  // ── 2. Each command has a description ─────────────────────────────
  it("each command has a description", () => {
    const { commands } = setup();

    for (const name of ["wt-create", "wt-switch", "wt-merge", "wt-cleanup"]) {
      const cmd = commands[name];
      expect(cmd.options).toHaveProperty("description");
      expect(typeof cmd.options.description).toBe("string");
      expect((cmd.options.description as string).length).toBeGreaterThan(0);
    }
  });

  // ── 3. Each command has getArgumentCompletions ────────────────────
  it("each command has getArgumentCompletions", () => {
    const { commands } = setup();

    for (const name of ["wt-create", "wt-switch", "wt-merge", "wt-cleanup"]) {
      const cmd = commands[name];
      expect(cmd.options).toHaveProperty("getArgumentCompletions");
      expect(typeof cmd.options.getArgumentCompletions).toBe("function");
    }
  });

  // ── 4. Registers session_start, session_tree, session_shutdown handlers
  it("registers session_start, session_tree, session_shutdown handlers", () => {
    const { on } = setup();

    expect(on).toHaveBeenCalledTimes(3);
    expect(on).toHaveBeenCalledWith("session_start", expect.any(Function));
    expect(on).toHaveBeenCalledWith("session_tree", expect.any(Function));
    expect(on).toHaveBeenCalledWith("session_shutdown", expect.any(Function));
  });

  // ── 5. Command handlers call the correct imported handler functions
  it("command handlers call the correct imported handler functions", async () => {
    const { commands } = setup();
    const ctx = createMockContext();

    // wt-create
    const createHandler = commands["wt-create"].options.handler as (
      args: string,
      ctx: unknown,
    ) => Promise<void>;
    await createHandler("feature", ctx);
    expect(handleWtCreate).toHaveBeenCalledWith("feature", ctx, expect.anything());

    vi.clearAllMocks();

    // wt-switch
    const switchHandler = commands["wt-switch"].options.handler as (
      args: string,
      ctx: unknown,
    ) => Promise<void>;
    await switchHandler("main", ctx);
    expect(handleWtSwitch).toHaveBeenCalledWith("main", ctx, expect.anything());

    vi.clearAllMocks();

    // wt-merge
    const mergeHandler = commands["wt-merge"].options.handler as (
      args: string,
      ctx: unknown,
    ) => Promise<void>;
    await mergeHandler("feature", ctx);
    expect(handleWtMerge).toHaveBeenCalledWith("feature", ctx, expect.anything());

    vi.clearAllMocks();

    // wt-cleanup
    const cleanupHandler = commands["wt-cleanup"].options.handler as (
      args: string,
      ctx: unknown,
    ) => Promise<void>;
    await cleanupHandler("feature", ctx);
    expect(handleWtCleanup).toHaveBeenCalledWith("feature", ctx, expect.anything());
  });

  // ── 6. session_start handler detects main repo and restores state
  it("session_start handler detects main repo and restores state", async () => {
    const { handlers } = setup();
    const ctx = createMockContext();

    // Mock detectMainRepo to return a known path
    vi.mocked(detectMainRepo).mockResolvedValue("/path/to/repo");
    vi.mocked(detectDefaultBranch).mockResolvedValue("main");

    // Call the captured session_start handler
    const sessionStartHandler = handlers["session_start"];
    await sessionStartHandler({}, ctx);

    // Assert detectMainRepo was called with pi and ctx.cwd
    expect(detectMainRepo).toHaveBeenCalledWith(expect.anything(), ctx.cwd);

    // Assert detectDefaultBranch was called
    expect(detectDefaultBranch).toHaveBeenCalledWith(expect.anything(), ctx.cwd);

    // Assert state management functions were called
    expect(setMainRepoPath).toHaveBeenCalledWith("/path/to/repo");
    expect(setDefaultBranch).toHaveBeenCalledWith("main");
    expect(restoreWorktreeFromBranch).toHaveBeenCalledWith(ctx);
    expect(updateFooterStatus).toHaveBeenCalledWith(ctx);
  });

  // ── session_start when detectMainRepo returns null ────────────────
  it("session_start does not call setMainRepoPath when detectMainRepo returns null", async () => {
    const { handlers } = setup();
    const ctx = createMockContext();

    vi.mocked(detectMainRepo).mockResolvedValue(null);

    const sessionStartHandler = handlers["session_start"];
    await sessionStartHandler({}, ctx);

    expect(setMainRepoPath).not.toHaveBeenCalled();
    expect(setDefaultBranch).not.toHaveBeenCalled();
    // restoreWorktreeFromBranch and updateFooterStatus should still be called
    expect(restoreWorktreeFromBranch).toHaveBeenCalledWith(ctx);
    expect(updateFooterStatus).toHaveBeenCalledWith(ctx);
  });

  // ── session_tree handler restores state ───────────────────────────
  it("session_tree handler restores worktree and updates footer", () => {
    const { handlers } = setup();
    const ctx = createMockContext();

    const sessionTreeHandler = handlers["session_tree"];
    sessionTreeHandler({}, ctx);

    expect(restoreWorktreeFromBranch).toHaveBeenCalledWith(ctx);
    expect(updateFooterStatus).toHaveBeenCalledWith(ctx);
  });

  // ── session_shutdown handler resets state ─────────────────────────
  it("session_shutdown handler resets state", () => {
    const { handlers } = setup();

    const sessionShutdownHandler = handlers["session_shutdown"];
    sessionShutdownHandler();

    expect(resetState).toHaveBeenCalled();
  });

  // ── getArgumentCompletions calls getBranchCompletions ──────────────
  it("getArgumentCompletions delegates to getBranchCompletions", async () => {
    const { commands } = setup();

    for (const name of ["wt-create", "wt-switch", "wt-merge", "wt-cleanup"]) {
      const cmd = commands[name];
      const completionsFn = cmd.options.getArgumentCompletions as (
        prefix: string,
      ) => Promise<unknown>;
      await completionsFn("feat");
    }

    // getBranchCompletions should have been called once per command (4 times)
    // Note: we mocked getBranchCompletions to resolve to []
    const { getBranchCompletions } = await import("../completions.js");
    expect(getBranchCompletions).toHaveBeenCalledTimes(4);
  });
});
