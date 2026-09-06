import { describe, expect, it } from "vitest";

import {
  appendStudioAiOperation,
  createEmptyStudioAiProvenanceDocument,
  normalizeStudioAiProvenanceDocument,
  projectStudioAiProvenanceForPublish,
  serializeStudioAiProvenanceDocument,
  sha256StudioAiProvenanceText,
  STUDIO_AI_PROVENANCE_LIMITS,
  STUDIO_AI_PROVENANCE_VERSION,
  updateStudioAiOperation,
  type StudioAiOperationInput,
  type StudioAiProvenanceDocument,
} from "./studio-ai-provenance";

const NOW = new Date("2026-07-10T06:00:00.000Z");
const SECRET_PROMPT = "주인공 민지의 비공개 반전과 전화번호 010-1234-5678";
const REVISED_SECRET = "비공개 수정 프롬프트: 결말을 숨겨 주세요";

function operationInput(overrides: Partial<StudioAiOperationInput> = {}): StudioAiOperationInput {
  return {
    id: "op-1",
    kind: "text",
    task: "scenario",
    provider: "deepseek",
    model: "deepseek-chat",
    transport: "server",
    promptVersion: 1,
    prompt: SECRET_PROMPT,
    createdAt: NOW,
    status: "succeeded",
    ...overrides,
  };
}

function append(
  document = createEmptyStudioAiProvenanceDocument(),
  overrides: Partial<StudioAiOperationInput> = {}
): StudioAiProvenanceDocument {
  return appendStudioAiOperation(document, operationInput(overrides), { now: NOW });
}

describe("sha256StudioAiProvenanceText", () => {
  it("matches standard SHA-256 vectors for empty, ASCII, and UTF-8 text", () => {
    expect(sha256StudioAiProvenanceText("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
    expect(sha256StudioAiProvenanceText("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    expect(sha256StudioAiProvenanceText("툰 창작")).toBe(
      "4e31ead64289f8e3e848f4c4f77d8f06a4be30f899a070c932cf95de2aa7004c"
    );
  });
});

describe("appendStudioAiOperation", () => {
  it("stores a deterministic digest and content-free summary without raw prompts by default", () => {
    const document = append(createEmptyStudioAiProvenanceDocument(), {
      revisedPrompt: REVISED_SECRET,
    });
    const operation = document.operations[0];

    expect(operation.prompt).toEqual({
      sha256: sha256StudioAiProvenanceText(SECRET_PROMPT),
      summary: `텍스트 AI 프롬프트 · 내용 비공개 · ${SECRET_PROMPT.length}자`,
      characterCount: SECRET_PROMPT.length,
      retention: "hash-only",
    });
    expect(operation.revisedPrompt).toEqual({
      sha256: sha256StudioAiProvenanceText(REVISED_SECRET),
      summary: `텍스트 AI 프롬프트 · 내용 비공개 · ${REVISED_SECRET.length}자`,
      characterCount: REVISED_SECRET.length,
      retention: "hash-only",
    });
    expect(JSON.stringify(document)).not.toContain(SECRET_PROMPT);
    expect(JSON.stringify(document)).not.toContain(REVISED_SECRET);
  });

  it("retains raw prompts only under explicit, field-specific opt-in", () => {
    const document = appendStudioAiOperation(
      createEmptyStudioAiProvenanceDocument(),
      operationInput({ revisedPrompt: REVISED_SECRET }),
      { now: NOW, retainRawPrompt: true }
    );

    expect(document.operations[0].prompt).toMatchObject({
      retention: "raw-opt-in",
      raw: SECRET_PROMPT,
    });
    expect(document.operations[0].revisedPrompt).toMatchObject({ retention: "hash-only" });
    expect(document.operations[0].revisedPrompt).not.toHaveProperty("raw");
  });

  it("captures bounded operation metadata used by text and image tasks", () => {
    const digest = "A".repeat(64);
    const document = append(createEmptyStudioAiProvenanceDocument(), {
      id: "image-1",
      kind: "image",
      task: "character-image",
      provider: "image-provider",
      model: "image-model-v2",
      transport: "byok",
      promptVersion: 7,
      prompt: "character turnaround",
      target: { pageId: "page-1", frameId: "frame-2", elementId: "element-3" },
      requestedSize: { width: 1024, height: 1792 },
      references: [
        { assetId: "character-reference" },
        { sha256: digest.toLowerCase() },
      ],
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      seed: 42,
      requestId: "provider-request-private",
    });

    expect(document.operations[0]).toMatchObject({
      id: "image-1",
      kind: "image",
      task: "character-image",
      target: { pageId: "page-1", frameId: "frame-2", elementId: "element-3" },
      requestedSize: { width: 1024, height: 1792 },
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      seed: "42",
      requestId: "provider-request-private",
    });
    expect(document.operations[0].references).toHaveLength(2);
  });

  it("stores only controlled error text and enforces task/status invariants", () => {
    const document = append(createEmptyStudioAiProvenanceDocument(), {
      status: "failed",
      error: {
        category: "provider",
        code: "RATE_LIMIT",
        retriable: true,
        // Runtime provider payloads may contain extra fields; they must not be persisted.
        message: SECRET_PROMPT,
      } as StudioAiOperationInput["error"],
    });

    expect(document.operations[0].error).toEqual({
      category: "provider",
      code: "RATE_LIMIT",
      message: "AI 제공자 요청이 실패했습니다.",
      retriable: true,
    });
    expect(JSON.stringify(document)).not.toContain(SECRET_PROMPT);
    expect(() => append(createEmptyStudioAiProvenanceDocument(), {
      status: "failed",
      error: undefined,
    })).toThrow("오류 코드");
    expect(() => append(createEmptyStudioAiProvenanceDocument(), {
      kind: "text",
      task: "background-image",
    })).toThrow("일치하지");
  });

  it("rejects duplicate IDs, invalid dimensions, duplicate references, and oversized prompts", () => {
    const document = append();
    expect(() => append(document)).toThrow("이미 사용 중");
    expect(() => append(createEmptyStudioAiProvenanceDocument(), {
      requestedSize: { width: 0, height: 100 },
    })).toThrow();
    expect(() => append(createEmptyStudioAiProvenanceDocument(), {
      references: [{ assetId: "same" }, { assetId: "same" }],
    })).toThrow();
    expect(() => append(createEmptyStudioAiProvenanceDocument(), {
      prompt: "가".repeat(STUDIO_AI_PROVENANCE_LIMITS.maxPromptCodeUnits + 1),
    })).toThrow(`${STUDIO_AI_PROVENANCE_LIMITS.maxPromptCodeUnits}자`);
  });
});

describe("normalization, migration, deterministic order, and serialization", () => {
  it("migrates conservative v0 aliases and strips legacy raw prompts by default", () => {
    const normalized = normalizeStudioAiProvenanceDocument({
      version: 0,
      entries: [
        {
          operationId: "legacy-image",
          mediaKind: "image",
          taskName: "background",
          providerName: "legacy-provider",
          modelName: "legacy-model",
          transport: "browser",
          prompt_version: 2,
          rawPrompt: SECRET_PROMPT,
          revisedPrompt: REVISED_SECRET,
          status: "complete",
          timestamp: "2026-07-09T00:00:00+09:00",
          size: "1024x1792",
          pageId: "page-legacy",
          panelId: "panel-legacy",
          referenceAssetIds: ["asset-1", "asset-1"],
          referenceSha256Digests: ["b".repeat(64)],
          request_id: "legacy-request",
        },
      ],
    });

    expect(normalized).toMatchObject({
      version: STUDIO_AI_PROVENANCE_VERSION,
      operations: [
        {
          id: "legacy-image",
          kind: "image",
          task: "background-image",
          transport: "byok",
          promptVersion: 2,
          status: "succeeded",
          createdAt: "2026-07-08T15:00:00.000Z",
          requestedSize: { width: 1024, height: 1792 },
          target: { pageId: "page-legacy", frameId: "panel-legacy" },
        },
      ],
    });
    expect(normalized.operations[0].prompt.sha256).toBe(
      sha256StudioAiProvenanceText(SECRET_PROMPT)
    );
    expect(normalized.operations[0].references).toHaveLength(2);
    expect(JSON.stringify(normalized)).not.toContain(SECRET_PROMPT);
    expect(JSON.stringify(normalized)).not.toContain(REVISED_SECRET);
  });

  it("rejects malformed JSON and explicit future versions instead of guessing", () => {
    const empty = createEmptyStudioAiProvenanceDocument();
    expect(normalizeStudioAiProvenanceDocument("{broken")).toEqual(empty);
    expect(normalizeStudioAiProvenanceDocument({
      version: 2,
      operations: [{ id: "future", rawPrompt: SECRET_PROMPT }],
    })).toEqual(empty);
  });

  it("deduplicates by operation ID using latest updatedAt and sorts newest first with stable ID ties", () => {
    const values = [
      {
        ...operationInput({ id: "same", model: "older", createdAt: "2026-07-01T00:00:00.000Z" }),
        updatedAt: "2026-07-01T01:00:00.000Z",
      },
      operationInput({ id: "b", createdAt: "2026-07-03T00:00:00.000Z" }),
      operationInput({ id: "a", createdAt: "2026-07-03T00:00:00.000Z" }),
      {
        ...operationInput({ id: "same", model: "newer", createdAt: "2026-07-01T00:00:00.000Z" }),
        updatedAt: "2026-07-02T00:00:00.000Z",
      },
    ];
    const forward = normalizeStudioAiProvenanceDocument({ operations: values });
    const reverse = normalizeStudioAiProvenanceDocument({ operations: [...values].reverse() });

    expect(forward).toEqual(reverse);
    expect(forward.operations.map((operation) => operation.id)).toEqual(["a", "b", "same"]);
    expect(forward.operations.find((operation) => operation.id === "same")?.model).toBe("newer");
  });

  it("defaults to redacting raw opt-in fields during normalization and serialization", () => {
    const retained = appendStudioAiOperation(
      createEmptyStudioAiProvenanceDocument(),
      operationInput({ revisedPrompt: REVISED_SECRET }),
      { now: NOW, retainRawPrompt: true, retainRawRevisedPrompt: true }
    );

    const defaultNormalized = normalizeStudioAiProvenanceDocument(retained);
    const defaultSerialized = serializeStudioAiProvenanceDocument(retained);
    const optInSerialized = serializeStudioAiProvenanceDocument(retained, {
      retainRawPrompts: true,
    });

    expect(defaultNormalized.operations[0].prompt.retention).toBe("hash-only");
    expect(defaultSerialized).not.toContain(SECRET_PROMPT);
    expect(defaultSerialized).not.toContain(REVISED_SECRET);
    expect(optInSerialized).toContain(SECRET_PROMPT);
    expect(optInSerialized).toContain(REVISED_SECRET);
    expect(serializeStudioAiProvenanceDocument(defaultSerialized)).toBe(defaultSerialized);
  });

  it("enforces operation count and serialized byte limits while keeping deterministic newest data", () => {
    const operations = Array.from(
      { length: STUDIO_AI_PROVENANCE_LIMITS.maxOperations + 50 },
      (_, index) => operationInput({
        id: `op-${String(index).padStart(4, "0")}`,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
      })
    );
    const countBounded = normalizeStudioAiProvenanceDocument({ operations });
    expect(countBounded.operations).toHaveLength(STUDIO_AI_PROVENANCE_LIMITS.maxOperations);
    expect(countBounded.operations[0].id).toBe("op-0549");
    expect(countBounded.operations.at(-1)?.id).toBe("op-0050");

    const rawOperations = Array.from({ length: 80 }, (_, index) => ({
      ...operationInput({
        id: `raw-${index}`,
        prompt: `${index}:${"x".repeat(30_000)}`,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
      }),
      prompt: {
        raw: `${index}:${"x".repeat(30_000)}`,
        retention: "raw-opt-in",
      },
    }));
    const byteBounded = normalizeStudioAiProvenanceDocument(
      { operations: rawOperations },
      { retainRawPrompts: true }
    );
    expect(new TextEncoder().encode(JSON.stringify(byteBounded)).byteLength).toBeLessThanOrEqual(
      STUDIO_AI_PROVENANCE_LIMITS.maxSerializedBytes
    );
    expect(byteBounded.operations.length).toBeLessThan(rawOperations.length);
  });
});

describe("updateStudioAiOperation", () => {
  it("immutably completes pending work and adds privacy-safe revised prompt provenance", () => {
    const pending = append(createEmptyStudioAiProvenanceDocument(), {
      status: "pending",
      requestId: "pending-request",
    });
    const updated = updateStudioAiOperation(
      pending,
      "op-1",
      {
        status: "succeeded",
        usage: { promptTokens: 12, completionTokens: 8, totalTokens: 20 },
        revisedPrompt: REVISED_SECRET,
        model: "deepseek-chat-v2",
      },
      { now: new Date("2026-07-10T06:01:00.000Z") }
    );

    expect(updated).not.toBe(pending);
    expect(pending.operations[0]).not.toHaveProperty("usage");
    expect(updated.operations[0]).toMatchObject({
      status: "succeeded",
      model: "deepseek-chat-v2",
      updatedAt: "2026-07-10T06:01:00.000Z",
      usage: { promptTokens: 12, completionTokens: 8, totalTokens: 20 },
      revisedPrompt: { retention: "hash-only" },
    });
    expect(JSON.stringify(updated)).not.toContain(REVISED_SECRET);
  });

  it("adds controlled failure metadata, supports cancellation, and leaves unknown IDs unchanged", () => {
    const pending = append(createEmptyStudioAiProvenanceDocument(), { status: "pending" });
    const failed = updateStudioAiOperation(
      pending,
      "op-1",
      {
        status: "failed",
        error: { category: "network", code: "TIMEOUT", retriable: true },
      },
      { now: new Date("2026-07-10T06:01:00.000Z") }
    );
    expect(failed.operations[0].error).toMatchObject({
      category: "network",
      code: "TIMEOUT",
      retriable: true,
    });
    const cancelled = updateStudioAiOperation(
      failed,
      "op-1",
      { status: "cancelled", error: { category: "cancelled", code: "USER_CANCELLED" } },
      { now: new Date("2026-07-10T06:02:00.000Z") }
    );
    expect(cancelled.operations[0].status).toBe("cancelled");
    expect(updateStudioAiOperation(cancelled, "missing", {}, { now: NOW })).toBe(cancelled);
  });

  it("refuses time travel and failed updates without an error", () => {
    const pending = append(createEmptyStudioAiProvenanceDocument(), { status: "pending" });
    expect(() => updateStudioAiOperation(
      pending,
      "op-1",
      { status: "failed" },
      { now: new Date("2026-07-10T06:01:00.000Z") }
    )).toThrow("오류 코드");
    expect(() => updateStudioAiOperation(
      pending,
      "op-1",
      { status: "succeeded" },
      { now: new Date("2026-07-10T05:59:00.000Z") }
    )).toThrow("빠를 수 없");
  });
});

describe("projectStudioAiProvenanceForPublish", () => {
  it("keeps disclosure metadata while removing all correlating and prompt-sensitive fields", () => {
    const retained = appendStudioAiOperation(
      createEmptyStudioAiProvenanceDocument(),
      operationInput({
        id: "private-operation-id",
        kind: "image",
        task: "image-edit",
        provider: "provider-b",
        model: "model-b",
        transport: "byok",
        prompt: SECRET_PROMPT,
        revisedPrompt: REVISED_SECRET,
        target: { pageId: "private-page", frameId: "private-frame", elementId: "private-element" },
        requestedSize: { width: 1024, height: 1024 },
        references: [{ assetId: "private-asset", sha256: "c".repeat(64) }],
        seed: "private-seed",
        requestId: "private-request",
        status: "failed",
        error: { category: "provider", code: "PRIVATE_PROVIDER_CODE", retriable: false },
      }),
      { now: NOW, retainRawPrompt: true, retainRawRevisedPrompt: true }
    );
    const withText = append(retained, {
      id: "text-operation",
      createdAt: new Date("2026-07-10T07:00:00.000Z"),
      provider: "provider-a",
      model: "model-a",
    });

    const projection = projectStudioAiProvenanceForPublish(withText);
    const serialized = JSON.stringify(projection);

    expect(projection).toMatchObject({
      aiUsed: true,
      operationCount: 2,
      byKind: { text: 1, image: 1 },
      byStatus: { pending: 0, succeeded: 1, failed: 1, cancelled: 0 },
      providers: ["provider-a", "provider-b"],
      models: ["model-a", "model-b"],
    });
    expect(projection.operations[1]).toMatchObject({
      sequence: 2,
      referenceCount: 1,
      targetScopes: ["page", "frame", "element"],
      error: { category: "provider", retriable: false },
    });
    for (const privateValue of [
      SECRET_PROMPT,
      REVISED_SECRET,
      sha256StudioAiProvenanceText(SECRET_PROMPT),
      "private-operation-id",
      "private-page",
      "private-frame",
      "private-element",
      "private-asset",
      "c".repeat(64),
      "private-seed",
      "private-request",
      "PRIVATE_PROVIDER_CODE",
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  it("returns a stable empty disclosure for malformed input", () => {
    expect(projectStudioAiProvenanceForPublish({ version: 99, operations: [] })).toEqual({
      version: 1,
      sourceDocumentVersion: 1,
      aiUsed: false,
      operationCount: 0,
      byKind: { text: 0, image: 0 },
      byStatus: { pending: 0, succeeded: 0, failed: 0, cancelled: 0 },
      providers: [],
      models: [],
      operations: [],
    });
  });
});
