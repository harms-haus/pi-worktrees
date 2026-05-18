import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { statSync, existsSync } from "node:fs";

vi.mock("node:fs", () => ({
  statSync: vi.fn(),
  existsSync: vi.fn(),
}));

import {
  getMainRepoPath,
  setMainRepoPath,
  getCurrentWorktreePath,
  setCurrentWorktreePath,
  getCurrentBranch,
  setCurrentBranch,
  resetState,
  updateFooterStatus,
  restoreWorktreeFromBranch,
} from "../state.js";
import { createMockContext } from "./helpers/mocks.js";
import { WORKTREE_CHANGE_TYPE } from "../types.js";

// ============================================================================
// Helpers
// ============================================================================
function makeWorktreeChangeEntry(
  mainRepoPath: string,
  currentWorktreePath: string,
  currentBranch: string,
) {
  return {
    type: "custom" as const,
    customType: WORKTREE_CHANGE_TYPE,
    data: { mainRepoPath, currentWorktreePath, currentBranch },
  };
}

// ============================================================================
// Reset module-level mutable state between tests
// ============================================================================
beforeEach(() => {
  resetState();
});

afterEach(() => {
  resetState();
  vi.restoreAllMocks();
});

// ============================================================================
// Getters / Setters
// ============================================================================
describe("getters and setters", () => {
  it("getMainRepoPath initially returns empty string", () => {
    expect(getMainRepoPath()).toBe("");
  });

  it("setMainRepoPath → getMainRepoPath returns the set value", () => {
    setMainRepoPath("/repo");
    expect(getMainRepoPath()).toBe("/repo");
  });

  it("getCurrentWorktreePath initially returns empty string", () => {
    expect(getCurrentWorktreePath()).toBe("");
  });

  it("setCurrentWorktreePath → getCurrentWorktreePath returns the set value", () => {
    setCurrentWorktreePath("/repo/.git/worktrees/feature");
    expect(getCurrentWorktreePath()).toBe("/repo/.git/worktrees/feature");
  });

  it("getCurrentBranch initially returns 'main'", () => {
    expect(getCurrentBranch()).toBe("main");
  });

  it("setCurrentBranch → getCurrentBranch returns the set value", () => {
    setCurrentBranch("feature");
    expect(getCurrentBranch()).toBe("feature");
  });

  it("resetState clears all values to defaults", () => {
    setMainRepoPath("/repo");
    setCurrentWorktreePath("/repo/.git/worktrees/feature");
    setCurrentBranch("feature");

    resetState();

    expect(getMainRepoPath()).toBe("");
    expect(getCurrentWorktreePath()).toBe("");
    expect(getCurrentBranch()).toBe("main");
  });
});

// ============================================================================
// updateFooterStatus
// ============================================================================
describe("updateFooterStatus", () => {
  it("branch is 'main' AND path matches main → clears status", () => {
    setMainRepoPath("/repo");
    setCurrentWorktreePath("/repo");
    setCurrentBranch("main");

    const ctx = createMockContext();
    updateFooterStatus(ctx);

    expect(ctx.ui.setStatus).toHaveBeenCalledWith("worktree", undefined);
  });

  it("branch is not 'main' → sets status with theme.fg", () => {
    setMainRepoPath("/repo");
    setCurrentWorktreePath("/repo/.git/worktrees/feature");
    setCurrentBranch("feature");

    const ctx = createMockContext();
    updateFooterStatus(ctx);

    expect(ctx.ui.setStatus).toHaveBeenCalledWith("worktree", expect.any(String));
    expect(ctx.ui.theme.fg).toHaveBeenCalledWith("accent", expect.stringContaining("feature"));
  });

  it("hasUI: false → no setStatus call", () => {
    setMainRepoPath("/repo");
    setCurrentWorktreePath("/repo/.git/worktrees/feature");
    setCurrentBranch("feature");

    const ctx = createMockContext({ hasUI: false });
    updateFooterStatus(ctx);

    expect(ctx.ui.setStatus).not.toHaveBeenCalled();
  });
});

// ============================================================================
// restoreWorktreeFromBranch
// ============================================================================
describe("restoreWorktreeFromBranch", () => {
  const originalCwd = "/original/cwd";

  it("valid entry → restores state", () => {
    setMainRepoPath(""); // start clean

    const ctx = createMockContext({
      sessionManager: {
        getBranch: vi.fn(() => [
          makeWorktreeChangeEntry("/repo", "/repo/.git/worktrees/feature", "feature"),
        ]),
      },
    });

    vi.mocked(statSync).mockReturnValue({ isDirectory: () => true } as ReturnType<typeof statSync>);
    vi.mocked(existsSync).mockReturnValue(true);

    restoreWorktreeFromBranch(ctx, originalCwd);

    expect(getMainRepoPath()).toBe("/repo");
    expect(getCurrentWorktreePath()).toBe("/repo/.git/worktrees/feature");
    expect(getCurrentBranch()).toBe("feature");
  });

  it("entry with deleted worktree path → falls back to mainRepoPath", () => {
    setMainRepoPath("");

    const ctx = createMockContext({
      sessionManager: {
        getBranch: vi.fn(() => [
          makeWorktreeChangeEntry("/repo", "/repo/.git/worktrees/deleted", "feature"),
        ]),
      },
    });

    vi.mocked(statSync).mockReturnValue({ isDirectory: () => true } as ReturnType<typeof statSync>);
    // existsSync returns false for the deleted worktree path
    vi.mocked(existsSync).mockReturnValue(false);

    restoreWorktreeFromBranch(ctx, originalCwd);

    expect(getMainRepoPath()).toBe("/repo");
    expect(getCurrentWorktreePath()).toBe("/repo");
    expect(getCurrentBranch()).toBe("main");
  });

  it("empty branch → no state change", () => {
    setMainRepoPath("");

    const ctx = createMockContext({
      sessionManager: {
        getBranch: vi.fn(() => []),
      },
    });

    restoreWorktreeFromBranch(ctx, originalCwd);

    expect(getMainRepoPath()).toBe("");
    expect(getCurrentWorktreePath()).toBe("");
    expect(getCurrentBranch()).toBe("main");
  });

  it("getBranch() throws → no crash", () => {
    setMainRepoPath("");

    const ctx = createMockContext({
      sessionManager: {
        getBranch: vi.fn(() => {
          throw new Error("branch error");
        }),
      },
    });

    // Should not throw
    expect(() => {
      restoreWorktreeFromBranch(ctx, originalCwd);
    }).not.toThrow();
    expect(getMainRepoPath()).toBe("");
  });

  it("multiple entries → uses last valid one", () => {
    setMainRepoPath("");

    const ctx = createMockContext({
      sessionManager: {
        getBranch: vi.fn(() => [
          makeWorktreeChangeEntry("/repo1", "/repo1/.git/worktrees/first", "first"),
          makeWorktreeChangeEntry("/repo2", "/repo2/.git/worktrees/second", "second"),
          makeWorktreeChangeEntry("/repo3", "/repo3/.git/worktrees/third", "third"),
        ]),
      },
    });

    vi.mocked(statSync).mockReturnValue({ isDirectory: () => true } as ReturnType<typeof statSync>);
    vi.mocked(existsSync).mockReturnValue(true);

    restoreWorktreeFromBranch(ctx, originalCwd);

    // Should use the LAST entry (iterates from the end)
    expect(getMainRepoPath()).toBe("/repo3");
    expect(getCurrentWorktreePath()).toBe("/repo3/.git/worktrees/third");
    expect(getCurrentBranch()).toBe("third");
  });
});
