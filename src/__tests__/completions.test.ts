import { describe, it, expect, vi, beforeEach } from "vitest";
import { getBranchCompletions } from "../completions.js";
import { createMockAPI } from "./helpers/mocks.js";
import type { WorktreeInfo } from "../types.js";

// ---------------------------------------------------------------------------
// Mock helpers.getWorktreeList and state.getMainRepoPath
// ---------------------------------------------------------------------------
const { getWorktreeList } = vi.hoisted(() => ({
  getWorktreeList: vi.fn(),
}));

vi.mock("../helpers.js", () => ({
  getWorktreeList,
}));

vi.mock("../state.js", () => ({
  getMainRepoPath: vi.fn(() => "/repo"),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("getBranchCompletions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const sampleWorktrees: WorktreeInfo[] = [
    { path: "/repo", head: "aaa", branch: "refs/heads/main", branchName: "main" },
    {
      path: "/repo/.git/worktrees/feature",
      head: "bbb",
      branch: "refs/heads/feature",
      branchName: "feature",
    },
    {
      path: "/repo/.git/worktrees/bugfix",
      head: "ccc",
      branch: "refs/heads/bugfix-123",
      branchName: "bugfix-123",
    },
  ];

  it("returns branch names matching prefix", async () => {
    getWorktreeList.mockResolvedValue(sampleWorktrees);

    const { api } = createMockAPI();
    const result = await getBranchCompletions("feat", api);

    expect(result).not.toBeNull();
    expect(result!.length).toBe(1);
    expect(result![0]).toEqual({ label: "feature", value: "feature" });
  });

  it("returns null when no matches", async () => {
    getWorktreeList.mockResolvedValue(sampleWorktrees);

    const { api } = createMockAPI();
    const result = await getBranchCompletions("zzz", api);

    expect(result).toBeNull();
  });

  it("includes 'main' when prefix matches", async () => {
    getWorktreeList.mockResolvedValue(sampleWorktrees);

    const { api } = createMockAPI();
    const result = await getBranchCompletions("ma", api);

    expect(result).not.toBeNull();
    const labels = result!.map((item) => item.label);
    expect(labels).toContain("main");
  });

  it("doesn't duplicate 'main' if already in list", async () => {
    // main is always added explicitly, make sure it doesn't appear twice
    getWorktreeList.mockResolvedValue(sampleWorktrees);

    const { api } = createMockAPI();
    const result = await getBranchCompletions("", api);

    expect(result).not.toBeNull();
    const mainCount = result!.filter((item) => item.label === "main").length;
    expect(mainCount).toBe(1);
  });
});
