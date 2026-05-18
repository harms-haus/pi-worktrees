import { vi } from "vitest";

// Mock pi-coding-agent — no real runtime needed
vi.mock("@earendil-works/pi-coding-agent", () => ({
  createLocalBashOperations: vi.fn(() => ({
    exec: vi.fn(),
  })),
}));
