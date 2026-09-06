import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  loadStudioServerRevisions,
  restoreStudioServerRevision,
  serverRevisionWorkId,
} from "./studio-production-server-revisions";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  getApiErrorMessage: vi.fn(async (_error: unknown, fallback: string) => fallback),
}));

vi.mock("@/src/infrastructure/api", () => ({
  api: { get: mocks.get, post: mocks.post },
  getApiErrorMessage: mocks.getApiErrorMessage,
}));

describe("studio production server revisions", () => {
  beforeEach(() => {
    mocks.get.mockReset();
    mocks.post.mockReset();
    mocks.getApiErrorMessage.mockClear();
  });

  it("enables authoritative revisions only for concrete work scope", () => {
    expect(serverRevisionWorkId("work:abc-123")).toBe("abc-123");
    expect(serverRevisionWorkId("draft")).toBeNull();
    expect(serverRevisionWorkId("remix:abc-123")).toBeNull();
    expect(serverRevisionWorkId("work: ")).toBeNull();
  });

  it("loads owner head and revision history without confusing local checkpoints", async () => {
    mocks.get
      .mockResolvedValueOnce({ revision: 12, isOwner: true })
      .mockResolvedValueOnce([
        { revision: 12, restoredFromRevision: null, createdAt: "2026-09-06T00:00:00.000Z" },
        { revision: 11, restoredFromRevision: 8, createdAt: "2026-09-05T23:00:00.000Z" },
      ]);
    await expect(loadStudioServerRevisions("work:work/with space")).resolves.toEqual({
      workId: "work/with space",
      currentRevision: 12,
      revisions: [
        { revision: 12, restoredFromRevision: null, createdAt: "2026-09-06T00:00:00.000Z" },
        { revision: 11, restoredFromRevision: 8, createdAt: "2026-09-05T23:00:00.000Z" },
      ],
    });
    expect(mocks.get).toHaveBeenNthCalledWith(1, "/creator/works/work%2Fwith%20space");
    expect(mocks.get).toHaveBeenNthCalledWith(2, "/creator/works/work%2Fwith%20space/revisions", { params: { limit: 50 } });
  });

  it("uses the observed current revision as the optimistic restore base", async () => {
    mocks.post.mockResolvedValueOnce({ revision: 13 });
    const next = await restoreStudioServerRevision({
      workId: "work-a",
      currentRevision: 12,
      revisions: [],
    }, 7);
    expect(next).toBe(13);
    expect(mocks.post).toHaveBeenCalledWith(
      "/creator/works/work-a/revisions/7/restore",
      { baseRevision: 12 },
    );
  });

  it("rejects malformed server data instead of presenting a false revision state", async () => {
    mocks.get.mockResolvedValueOnce({ revision: 4, isOwner: true }).mockResolvedValueOnce([
      { revision: 0, restoredFromRevision: null, createdAt: "invalid" },
    ]);
    await expect(loadStudioServerRevisions("work:x")).rejects.toThrow("서버 원고 버전을 불러오지 못했습니다.");
  });
});
