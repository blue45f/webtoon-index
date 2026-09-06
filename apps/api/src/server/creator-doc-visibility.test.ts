import { describe, expect, it } from "vitest";

import {
  appendStudioAiOperation,
  createEmptyStudioAiProvenanceDocument,
} from "../../../web/src/domains/creator/ai/studio-ai-provenance";

import { toPublicCreatorDoc } from "./creator-doc-visibility";

const PRIVATE_PROMPT = "독자에게 노출하면 안 되는 프롬프트";

function privateAiProvenance() {
  return appendStudioAiOperation(
    createEmptyStudioAiProvenanceDocument(),
    {
      id: "private-operation-id",
      kind: "image",
      task: "character-image",
      provider: "image-provider",
      model: "image-v2",
      transport: "byok",
      promptVersion: 4,
      prompt: PRIVATE_PROMPT,
      createdAt: "2026-07-10T00:00:00.000Z",
      target: { pageId: "private-page", frameId: "private-frame", elementId: "private-element" },
      references: [{ assetId: "private-asset", sha256: "a".repeat(64) }],
      seed: "private-seed",
      requestId: "private-request-id",
    },
    { retainRawPrompt: true }
  );
}

describe("toPublicCreatorDoc", () => {
  it("removes private editorial state while preserving render data and AI disclosure", () => {
    const source = {
      width: 720,
      comments: { version: 1, threads: [{ body: "비공개 수정 메모", assignee: { displayName: "편집자" } }] },
      characterBible: { characters: [{ name: "주인공", goal: "반전 비밀" }] },
      writerRoom: { stages: { premise: { text: "공개 전 결말" } }, suggestions: [{ rationale: "수정 이유" }] },
      releaseSchedule: { items: [{ title: "미공개 2화", localDate: "2026-08-01" }] },
      publicationAnalytics: { records: [{ title: "1화", views: 1234, revenue: 50 }] },
      publishPack: {
        profile: "webtoon",
        aiUsage: "assisted",
        disclosure: "AI 번역 초안을 작가가 검수함",
        compliance: { ownershipRightsConfirmed: true, attributionNotes: "계약 문서 위치" },
      },
      pagesList: [
        {
          id: "page-1",
          review: { status: "changes-requested", assignee: "편집자", note: "결말 수정" },
          elements: [{ id: "frame-1", type: "frame", storyBeat: { summary: "장면" } }],
        },
      ],
      fx: { bgmUrl: "/music.mp3" },
    };

    expect(toPublicCreatorDoc(source)).toEqual({
      width: 720,
      publishPack: {
        profile: "webtoon",
        aiUsage: "assisted",
        disclosure: "AI 번역 초안을 작가가 검수함",
      },
      pagesList: [
        {
          id: "page-1",
          elements: [{ id: "frame-1", type: "frame", storyBeat: { summary: "장면" } }],
        },
      ],
      fx: { bgmUrl: "/music.mp3" },
    });
    expect(source.comments.threads[0].body).toBe("비공개 수정 메모");
    expect(source.writerRoom.stages.premise.text).toBe("공개 전 결말");
    expect(source.pagesList[0].review.note).toBe("결말 수정");
  });

  it("fails closed for malformed documents and drops malformed publish metadata", () => {
    expect(toPublicCreatorDoc(null)).toEqual({});
    expect(toPublicCreatorDoc({ publishPack: "bad", pagesList: "bad", safe: true })).toEqual({ safe: true });
  });

  it("removes privateNote naming variants recursively while retaining unrelated custom fields", () => {
    expect(toPublicCreatorDoc({
      privateNote: "owner only",
      customPlugin: {
        private_note: "editor only",
        privateNotes: ["draft secret"],
        publicNote: "독자에게 보여도 됨",
      },
      pagesList: [{ id: "page-1", private_notes: "검수 메모", customLabel: "1화" }],
    })).toEqual({
      customPlugin: { publicNote: "독자에게 보여도 됨" },
      pagesList: [{ id: "page-1", customLabel: "1화" }],
    });
  });

  it("publishes only de-identified AI history and removes hashes and internal correlators", () => {
    const privateHistory = privateAiProvenance();
    const source = { width: 720, aiProvenance: privateHistory };
    const result = toPublicCreatorDoc(source);
    const serialized = JSON.stringify(result);

    expect(result.aiProvenance).toMatchObject({
      version: 1,
      aiUsed: true,
      operationCount: 1,
      operations: [
        {
          kind: "image",
          task: "character-image",
          provider: "image-provider",
          model: "image-v2",
          promptVersion: 4,
          referenceCount: 1,
          targetScopes: ["page", "frame", "element"],
        },
      ],
    });
    expect(serialized).not.toContain(PRIVATE_PROMPT);
    expect(serialized).not.toContain(privateHistory.operations[0].prompt.sha256);
    expect(serialized).not.toContain("private-operation-id");
    expect(serialized).not.toContain("private-page");
    expect(serialized).not.toContain("private-frame");
    expect(serialized).not.toContain("private-element");
    expect(serialized).not.toContain("private-asset");
    expect(serialized).not.toContain("private-seed");
    expect(serialized).not.toContain("private-request-id");
    expect(source.aiProvenance.operations[0].prompt.raw).toBe(PRIVATE_PROMPT);
  });

  it("redacts nested page and master provider correlators without removing safe provenance", () => {
    const textProvenance = {
      provider: "zai",
      model: "glm-5.1",
      transport: "server",
      promptVersion: 1,
      createdAt: "2026-07-10T00:00:00.000Z",
      requestId: "provider-request-private",
      seed: "private-seed",
      prompt: "private prompt text",
      referenceAssets: [{ id: "private-reference", sha256: "b".repeat(64) }],
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    };
    const source = {
      pagesList: [{
        id: "page-1",
        elements: [{
          id: "frame-1",
          type: "frame",
          storyBeat: { type: "transition", summary: "장면", textAiProvenance: textProvenance },
        }],
      }],
      master: {
        elements: [{
          id: "master-image",
          type: "image",
          src: "data:image/png;base64,public-render-data",
          aiProvenance: {
            action: "generated",
            provider: "provider",
            model: "image-v1",
            request_id: "private-master-request",
            apiKey: "private-key",
          },
        }],
      },
    };

    const result = toPublicCreatorDoc(source);
    const serialized = JSON.stringify(result);

    expect(result).toMatchObject({
      pagesList: [{
        elements: [{
          storyBeat: {
            textAiProvenance: {
              provider: "zai",
              model: "glm-5.1",
              transport: "server",
              promptVersion: 1,
              usage: { totalTokens: 30 },
            },
          },
        }],
      }],
      master: {
        elements: [{
          src: "data:image/png;base64,public-render-data",
          aiProvenance: { action: "generated", provider: "provider", model: "image-v1" },
        }],
      },
    });
    expect(serialized).not.toContain("provider-request-private");
    expect(serialized).not.toContain("private-master-request");
    expect(serialized).not.toContain("private-seed");
    expect(serialized).not.toContain("private prompt text");
    expect(serialized).not.toContain("private-reference");
    expect(serialized).not.toContain("private-key");
    expect(textProvenance.requestId).toBe("provider-request-private");
  });
});
