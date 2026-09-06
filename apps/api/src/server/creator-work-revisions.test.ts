import { describe, expect, it } from "vitest";

import { REVISION_COMPARISON_AI_PROMPT_DIGEST_SENTINEL } from "../../../web/src/shared/lib/revision-comparison-projection";

import {
  CREATOR_WORK_REVISION_RETENTION,
  CreatorWorkRevisionConflictError,
  createCreatorWorkRevisionComparisonSnapshot,
  createCreatorWorkRevisionSnapshot,
  creatorWorkRevisionRetentionCutoff,
  parseCreatorWorkRevision,
} from "./creator-work-revisions";

describe("creator work revision helpers", () => {
  it("복원 가능한 콘텐츠만 snapshot에 담고 관리자·반응 필드는 포함하지 않는다", () => {
    const source = {
      title: "1화",
      description: "설명",
      cover: "data:image/webp;base64,AA==",
      tags: ["판타지", 1, "액션"],
      format: "cuttoon",
      pages: ["page-a", null, "page-b"],
      doc: { pagesList: [{ id: "p1" }], privateNote: "owner only" },
      status: "draft",
      seriesId: "series-1",
      episodeNo: 3,
      challengeId: "",
      remixFromId: null,
      hidden: true,
      views: 999,
      userId: "owner-secret",
    };
    const snapshot = createCreatorWorkRevisionSnapshot(source);

    expect(snapshot).toEqual({
      titleId: null,
      title: "1화",
      description: "설명",
      cover: "data:image/webp;base64,AA==",
      tags: ["판타지", "액션"],
      format: "cuttoon",
      pages: ["page-a", "page-b"],
      doc: { pagesList: [{ id: "p1" }], privateNote: "owner only" },
      status: "draft",
      seriesId: "series-1",
      episodeNo: 3,
      challengeId: null,
      remixFromId: null,
    });
    expect(snapshot).not.toHaveProperty("hidden");
    expect(snapshot).not.toHaveProperty("views");
    expect(snapshot).not.toHaveProperty("userId");
  });

  it("revision은 Postgres integer의 양의 범위만 허용한다", () => {
    expect(parseCreatorWorkRevision(1)).toBe(1);
    expect(parseCreatorWorkRevision("42")).toBe(42);
    for (const invalid of [0, -1, 1.5, Number.NaN, 2_147_483_648, "x", null]) {
      expect(() => parseCreatorWorkRevision(invalid)).toThrow(/정수/);
    }
  });

  it("비교 projection은 렌더 에셋을 제거하고 doc 내부 리소스 URL도 토큰화한다", async () => {
    const comparison = await createCreatorWorkRevisionComparisonSnapshot({
      titleId: "title-1",
      title: "1화",
      description: "설명",
      cover: "data:image/webp;base64,private-cover",
      tags: ["판타지"],
      format: "cuttoon",
      pages: ["data:image/webp;base64,private-page"],
      doc: {
        pagesList: [{ id: "page-1", src: "data:image/png;base64,private-doc-image" }],
        previewUrl: "blob:https://studio.example/private-preview",
        aiProvenance: {
          operations: [
            {
              prompt: { sha256: "a".repeat(64), raw: "private-opt-in-prompt" },
              requestId: "private-provider-request",
              status: "succeeded",
            },
          ],
        },
      },
      status: "draft",
      seriesId: "series-1",
      episodeNo: 3,
      challengeId: "challenge-1",
      remixFromId: "origin-1",
    });

    expect(comparison).toEqual({
      titleId: "title-1",
      title: "1화",
      description: "설명",
      tags: ["판타지"],
      format: "cuttoon",
      doc: {
        pagesList: [
          {
            id: "page-1",
            src: expect.stringMatching(
              /^toonspectrum:resource-sha256:v1:\d+:[0-9a-f]{64}$/u
            ),
          },
        ],
        previewUrl: expect.stringMatching(
          /^toonspectrum:resource-sha256:v1:\d+:[0-9a-f]{64}$/u
        ),
        aiProvenance: {
          operations: [
            {
              id: "revision-comparison-operation-000001",
              prompt: { sha256: REVISION_COMPARISON_AI_PROMPT_DIGEST_SENTINEL },
              createdAt: "1970-01-01T00:00:00.000Z",
              status: "succeeded",
            },
          ],
        },
      },
      status: "draft",
      seriesId: "series-1",
      episodeNo: 3,
      challengeId: "challenge-1",
      remixFromId: "origin-1",
    });
    expect(comparison).not.toHaveProperty("cover");
    expect(comparison).not.toHaveProperty("pages");
    expect(JSON.stringify(comparison)).not.toContain("private-cover");
    expect(JSON.stringify(comparison)).not.toContain("private-page");
    expect(JSON.stringify(comparison)).not.toContain("private-doc-image");
    expect(JSON.stringify(comparison)).not.toContain("private-preview");
    expect(JSON.stringify(comparison)).not.toContain("private-opt-in-prompt");
    expect(JSON.stringify(comparison)).not.toContain("private-provider-request");
    expect(JSON.stringify(comparison)).not.toContain("a".repeat(64));
  });

  it("손상된 snapshot의 상태·포맷 값은 복원 가능한 허용값으로 닫아 둔다", () => {
    expect(createCreatorWorkRevisionSnapshot({ format: "private-format", status: "hidden" }))
      .toMatchObject({ format: "cuttoon", status: "draft" });
    expect(createCreatorWorkRevisionSnapshot({ format: "upload", status: "published" }))
      .toMatchObject({ format: "upload", status: "published" });
  });

  it("보존 상한을 넘긴 뒤에는 최신 N개만 남기는 inclusive cutoff를 계산한다", () => {
    expect(creatorWorkRevisionRetentionCutoff(CREATOR_WORK_REVISION_RETENTION)).toBeNull();
    expect(creatorWorkRevisionRetentionCutoff(CREATOR_WORK_REVISION_RETENTION + 1)).toBe(1);
    expect(creatorWorkRevisionRetentionCutoff(CREATOR_WORK_REVISION_RETENTION + 7)).toBe(7);
  });

  it("충돌 오류는 비밀 문서 없이 현재 revision만 구조적으로 보존한다", () => {
    const error = new CreatorWorkRevisionConflictError(9);
    expect(error.currentRevision).toBe(9);
    expect(error.message).not.toContain("prompt");
    expect(error).not.toHaveProperty("snapshot");
  });
});
