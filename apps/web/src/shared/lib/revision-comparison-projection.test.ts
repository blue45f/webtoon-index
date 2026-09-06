import { describe, expect, it } from "vitest";

import {
  REVISION_COMPARISON_PROJECTION_LIMITS,
  REVISION_COMPARISON_AI_PROMPT_DIGEST_SENTINEL,
  REVISION_COMPARISON_RESOURCE_TOKEN_PREFIX,
  RevisionComparisonProjectionError,
  isRevisionComparisonResourceToken,
  projectRevisionComparisonValue,
} from "./revision-comparison-projection";

describe("revision comparison resource projection", () => {
  it("중첩 값과 객체 키의 data:/blob: 원문을 결정적인 SHA-256+길이 토큰으로 바꾼다", async () => {
    const dataUrl = "data:image/png;base64,AA==";
    const blobUrl = "blob:https://studio.example/private-id";
    const source = {
      coverElement: { src: dataUrl, duplicate: dataUrl },
      nested: [blobUrl, "일반 대사"],
      [dataUrl]: "resource-key",
    };

    const first = await projectRevisionComparisonValue(source);
    const second = await projectRevisionComparisonValue(source);
    const serialized = JSON.stringify(first);

    expect(first).toEqual(second);
    expect(serialized).not.toContain(dataUrl);
    expect(serialized).not.toContain(blobUrl);
    expect(serialized).toContain(REVISION_COMPARISON_RESOURCE_TOKEN_PREFIX);

    const projected = first as Record<string, unknown>;
    const coverElement = projected.coverElement as Record<string, unknown>;
    expect(coverElement.src).toBe(coverElement.duplicate);
    expect(isRevisionComparisonResourceToken(coverElement.src)).toBe(true);
    expect(isRevisionComparisonResourceToken((projected.nested as unknown[])[0])).toBe(true);
    expect(Object.keys(projected).some(isRevisionComparisonResourceToken)).toBe(true);
  });

  it("토큰 길이는 원문 UTF-8 바이트 길이를 사용한다", async () => {
    const source = "data:text/plain,한글";
    const projected = await projectRevisionComparisonValue(source);
    const byteLength = new TextEncoder().encode(source).byteLength;

    expect(projected).toMatch(
      new RegExp(`^${REVISION_COMPARISON_RESOURCE_TOKEN_PREFIX}${byteLength}:[0-9a-f]{64}$`, "u")
    );
  });

  it("순환 참조와 키 상한 초과는 원문을 보존하지 않는 안전 오류로 닫는다", async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const tooManyKeys = Object.fromEntries(
      Array.from(
        { length: REVISION_COMPARISON_PROJECTION_LIMITS.maxObjectKeys + 1 },
        (_, index) => [`key-${index}`, index]
      )
    );
    const oversizedKey = {
      ["x".repeat(REVISION_COMPARISON_PROJECTION_LIMITS.maxObjectKeyCodeUnits + 1)]: true,
    };

    for (const source of [cyclic, tooManyKeys, oversizedKey]) {
      const error = await projectRevisionComparisonValue(source).catch((cause: unknown) => cause);
      expect(error).toBeInstanceOf(RevisionComparisonProjectionError);
      expect(error).not.toHaveProperty("cause");
      expect(String(error)).not.toContain("key-4096");
    }
  });

  it("객체의 undefined 선택 필드는 JSON 규칙처럼 생략하고 배열 undefined는 거부한다", async () => {
    await expect(
      projectRevisionComparisonValue({ id: "page-1", master: undefined })
    ).resolves.toEqual({ id: "page-1" });
    await expect(projectRevisionComparisonValue([undefined])).rejects.toBeInstanceOf(
      RevisionComparisonProjectionError
    );
  });

  it("aiProvenance 경로만 raw prompt·요청 ID·seed·error를 제거하고 창작 text는 유지한다", async () => {
    const privatePromptDigest = "a".repeat(64);
    const privateRevisedPromptDigest = "b".repeat(64);
    const projected = await projectRevisionComparisonValue({
      pagesList: [{ id: "page-1", elements: [{ type: "text", text: "작품 속 실제 대사" }] }],
      aiProvenance: {
        version: 1,
        operations: [
          {
            id: "operation-1",
            kind: "image",
            task: "background-image",
            provider: "private-provider",
            model: "private-model",
            transport: "server",
            promptVersion: 7,
            prompt: {
              sha256: privatePromptDigest,
              raw: "노출 금지 raw prompt",
              text: "노출 금지 legacy prompt text",
            },
            revisedPrompt: {
              value: "노출 금지 revised prompt",
              sha256: privateRevisedPromptDigest,
            },
            promptHash: "c".repeat(64),
            revisedPromptSha256: "d".repeat(64),
            rawPrompt: "노출 금지 fallback prompt",
            promptText: "노출 금지 promptText",
            revisedPromptText: "노출 금지 revisedPromptText",
            requestId: "private-request-id",
            providerRequestId: "private-provider-request-id",
            seed: "private-seed",
            createdAt: "2026-07-13T00:00:00.000Z",
            updatedAt: "2026-07-13T00:00:01.000Z",
            usage: { totalTokens: 1234 },
            target: { pageId: "private-page-id", elementId: "private-element-id" },
            requestedSize: { width: 1024, height: 1536 },
            references: [{ assetId: "private-asset-id", sha256: "e".repeat(64) }],
            error: { message: "private-provider-error" },
            errorMessage: "private-provider-error-message",
            status: "failed",
          },
        ],
      },
    });
    const serialized = JSON.stringify(projected);

    expect(projected).toMatchObject({
      pagesList: [{ elements: [{ text: "작품 속 실제 대사" }] }],
      aiProvenance: {
        operations: [
          {
            id: "revision-comparison-operation-000001",
            kind: "image",
            task: "background-image",
            prompt: { sha256: REVISION_COMPARISON_AI_PROMPT_DIGEST_SENTINEL },
            promptVersion: 7,
            status: "failed",
            createdAt: "1970-01-01T00:00:00.000Z",
            requestedSize: { width: 1024, height: 1536 },
          },
        ],
      },
    });
    for (const secret of [
      "노출 금지",
      "private-request-id",
      "private-provider-request-id",
      "private-seed",
      "private-provider-error",
      "private-provider-error-message",
      "private-provider",
      "private-model",
      "private-page-id",
      "private-element-id",
      "private-asset-id",
      "2026-07-13T00:00:00.000Z",
      "2026-07-13T00:00:01.000Z",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).not.toContain(privatePromptDigest);
    expect(serialized).not.toContain(privateRevisedPromptDigest);
    expect(serialized).not.toContain("c".repeat(64));
    expect(serialized).not.toContain("d".repeat(64));
    expect(serialized).not.toContain("e".repeat(64));
    expect(serialized).not.toContain("totalTokens");
    expect(serialized).not.toContain("transport");
    expect(serialized).not.toContain("references");
    expect(serialized).not.toContain("target");
    expect(serialized).toContain("작품 속 실제 대사");
  });
});
