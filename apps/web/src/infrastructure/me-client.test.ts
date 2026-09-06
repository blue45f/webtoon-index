import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { updateMyProfile } from "./me-client";

import { getAuthSession, persistSession } from "@/src/compat/auth-session-state";

const apiPatch = vi.hoisted(() => vi.fn());

vi.mock("@/src/infrastructure/api", () => ({
  api: {
    patch: apiPatch,
    raw: vi.fn(),
  },
  apiPath: (path: string) => `/api${path}`,
  toApiError: async (error: unknown) => (
    error instanceof Error ? error : new Error("프로필을 저장하지 못했어요.")
  ),
}));

describe("me profile session merge", () => {
  beforeEach(() => {
    apiPatch.mockReset();
    persistSession({
      user: { id: "profile-user", name: "이전 이름", role: "creator" },
      token: "profile-session-token",
    });
  });

  afterEach(() => {
    persistSession(null);
  });

  it("프로필 저장 응답을 현재 세션에 즉시 병합한다", async () => {
    const profile = {
      id: "profile-user",
      name: "수정한 이름",
      image: "https://images.example/new.webp",
      avatar: "#123456",
      email: "profile@example.com",
      bio: "새 소개",
    };
    apiPatch.mockResolvedValue({ profile });

    await expect(updateMyProfile({ name: "수정한 이름" })).resolves.toEqual(profile);

    expect(getAuthSession()).toEqual({
      user: {
        id: "profile-user",
        name: "수정한 이름",
        image: "https://images.example/new.webp",
        email: "profile@example.com",
        role: "creator",
      },
      token: null,
    });
  });
});
