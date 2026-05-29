import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Hoisted mocks (must be available at import time) ────────────────
const { getMainRepoPath } = vi.hoisted(() => ({
  getMainRepoPath: vi.fn(),
}));

vi.mock("../state.js", () => ({ getMainRepoPath }));

// ── Imports (after mocks registered) ────────────────────────────────
import { getUntrackedFiles } from "../git.js";
import { createMockAPI } from "./helpers/mocks.js";

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks();
  getMainRepoPath.mockReturnValue("/repo");
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// getUntrackedFiles
// ============================================================================
describe("getUntrackedFiles", () => {
  it("returns empty array when git command fails", async () => {
    const { api, exec } = createMockAPI();
    exec.mockResolvedValue({ stdout: "", stderr: "error", code: 128, killed: false });

    const result = await getUntrackedFiles(api, "/repo");

    expect(result).toEqual([]);
  });

  it("returns empty array when stdout is empty", async () => {
    const { api, exec } = createMockAPI();
    exec.mockResolvedValue({ stdout: "", stderr: "", code: 0, killed: false });

    const result = await getUntrackedFiles(api, "/repo");

    expect(result).toEqual([]);
  });

  it("parses NUL-separated file paths", async () => {
    const { api, exec } = createMockAPI();
    exec.mockResolvedValue({
      stdout: "file1.txt\0dir/file2.txt\0",
      stderr: "",
      code: 0,
      killed: false,
    });

    const result = await getUntrackedFiles(api, "/repo");

    expect(result).toEqual(["file1.txt", "dir/file2.txt"]);
  });

  it("filters out empty strings from NUL splitting", async () => {
    const { api, exec } = createMockAPI();
    exec.mockResolvedValue({
      stdout: "\0file.txt\0\0",
      stderr: "",
      code: 0,
      killed: false,
    });

    const result = await getUntrackedFiles(api, "/repo");

    expect(result).toEqual(["file.txt"]);
  });

  it("handles paths with spaces", async () => {
    const { api, exec } = createMockAPI();
    exec.mockResolvedValue({
      stdout: "path with space.txt\0",
      stderr: "",
      code: 0,
      killed: false,
    });

    const result = await getUntrackedFiles(api, "/repo");

    expect(result).toEqual(["path with space.txt"]);
  });

  it("calls git with correct arguments", async () => {
    const { api, exec } = createMockAPI();
    exec.mockResolvedValue({ stdout: "", stderr: "", code: 0, killed: false });

    await getUntrackedFiles(api, "/my/cwd");

    expect(exec).toHaveBeenCalledWith("git", ["ls-files", "-z", "--others", "--exclude-standard"], {
      cwd: "/my/cwd",
    });
  });
});
