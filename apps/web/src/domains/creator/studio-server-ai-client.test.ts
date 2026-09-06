import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  canonicalStudioServerAiOperationId,
  completeStudioServerText,
  getStudioServerAiStatus,
  parseStudioServerAiCompletion,
  parseStudioServerAiFailoverMetadata,
} from "./studio-server-ai-client";

const OPERATION_ID = "composition-00000000-0000-4000-8000-000000000001";

const { apiGet, apiPost, toApiError } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  toApiError: vi.fn(async (error: unknown) => (error instanceof Error ? error : new Error("실패"))),
}));

vi.mock("@/src/infrastructure/api", () => ({
  api: { get: apiGet, post: apiPost },
  toApiError,
}));

describe("studio-server-ai-client", () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    toApiError.mockClear();
  });

  it("키가 없는 공개 상태 정보만 읽는다", async () => {
    apiGet.mockResolvedValue({
      configured: true,
      provider: "deepseek",
      model: "deepseek-v4-flash",
      providers: [
        { id: "zai", label: "Z.ai", configured: false, model: "glm-5.1" },
        { id: "deepseek", label: "DeepSeek", configured: true, model: "deepseek-v4-flash" },
      ],
      selection: { default: "auto", order: ["zai", "deepseek"], fallback: true },
      capabilities: ["composition"],
      requiresAuth: true,
    });
    await expect(getStudioServerAiStatus()).resolves.toMatchObject({ configured: true, provider: "deepseek" });
    expect(apiGet).toHaveBeenCalledWith("/studio-ai/status", { signal: undefined });
  });

  it("서버 텍스트 응답을 정규화한다", async () => {
    apiPost.mockResolvedValue({
      content: "  결과  ",
      provider: "zai",
      model: "glm-5.1",
      requestId: "zai-request-1",
    });
    const result = await completeStudioServerText({
      task: "composition",
      promptVersion: 1,
      system: "구도를 제안하세요.",
      user: "옥상 장면",
      provider: "zai",
      operationId: OPERATION_ID,
    });
    expect(result).toEqual({
      ok: true,
      data: { content: "결과", provider: "zai", model: "glm-5.1", requestId: "zai-request-1" },
    });
    expect(apiPost).toHaveBeenCalledWith(
      "/studio-ai/chat",
      {
        task: "composition",
        promptVersion: 1,
        system: "구도를 제안하세요.",
        user: "옥상 장면",
        provider: "zai",
      },
      {
        signal: undefined,
        headers: { "Idempotency-Key": OPERATION_ID },
      }
    );
  });

  it("서버 계약에 맞는 operation ID만 canonical retry key로 허용한다", () => {
    expect(canonicalStudioServerAiOperationId(OPERATION_ID)).toBe(OPERATION_ID);
    expect(canonicalStudioServerAiOperationId(`  ${OPERATION_ID}  `)).toBeNull();
    expect(canonicalStudioServerAiOperationId("a".repeat(16))).toBe("a".repeat(16));
    expect(canonicalStudioServerAiOperationId("a".repeat(128))).toBe("a".repeat(128));
    expect(canonicalStudioServerAiOperationId("a".repeat(15))).toBeNull();
    expect(canonicalStudioServerAiOperationId("a".repeat(129))).toBeNull();
    expect(canonicalStudioServerAiOperationId("작업-0000000000000000")).toBeNull();
    expect(canonicalStudioServerAiOperationId("operation id with spaces")).toBeNull();
  });

  it.each([
    undefined,
    "too-short",
    "a".repeat(129),
    "작업-0000000000000000",
    "operation id with spaces",
  ])("잘못된 operation ID(%s)는 HTTP 전에 fail-closed 한다", async (operationId) => {
    await expect(completeStudioServerText({
      task: "composition",
      promptVersion: 1,
      system: "구도를 제안하세요.",
      user: "옥상 장면",
      operationId,
    })).resolves.toEqual({
      ok: false,
      code: "invalid_input",
      error: "서버 AI 요청 식별자가 올바르지 않아요.",
    });
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("잔액 소진으로 대체 공급자가 응답한 이력을 안전한 구조로 보존한다", async () => {
    apiPost.mockResolvedValue({
      content: "  대체 공급자 결과  ",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      requestId: "deepseek-request-1",
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      failover: {
        attemptedProvider: "zai",
        attemptedModel: "glm-5.1",
        actualProvider: "deepseek",
        actualModel: "deepseek-v4-flash",
        reason: "billing_quota_exhausted",
        providerError: "provider-private-error",
      },
      apiKey: "server-secret-key",
      providerError: "provider-private-error",
    });

    const result = await completeStudioServerText({
      task: "scenario",
      promptVersion: 1,
      system: "JSON 장면을 만드세요.",
      user: "비 오는 옥상",
      operationId: "scenario-00000000-0000-4000-8000-000000000002",
    });

    expect(result).toEqual({
      ok: true,
      data: {
        content: "대체 공급자 결과",
        provider: "deepseek",
        model: "deepseek-v4-flash",
        requestId: "deepseek-request-1",
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        failover: {
          attemptedProvider: "zai",
          attemptedModel: "glm-5.1",
          actualProvider: "deepseek",
          actualModel: "deepseek-v4-flash",
          reason: "billing_quota_exhausted",
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain("server-secret-key");
    expect(JSON.stringify(result)).not.toContain("provider-private-error");
  });

  it("최상위 실제 공급자와 불일치하거나 허용되지 않은 전환 사유는 폐기한다", () => {
    expect(parseStudioServerAiFailoverMetadata(
      {
        attemptedProvider: "zai",
        attemptedModel: "glm-5.1",
        actualProvider: "deepseek",
        actualModel: "wrong-model",
        reason: "billing_quota_exhausted",
      },
      { provider: "deepseek", model: "deepseek-v4-flash" }
    )).toBeUndefined();
    expect(parseStudioServerAiFailoverMetadata(
      {
        attemptedProvider: "zai",
        attemptedModel: "glm-5.1",
        actualProvider: "deepseek",
        actualModel: "deepseek-v4-flash",
        reason: "raw-provider-error",
      },
      { provider: "deepseek", model: "deepseek-v4-flash" }
    )).toBeUndefined();
  });

  it("선택 메타데이터가 손상돼도 본문과 실제 provider/model은 유지하되 원문 필드는 전파하지 않는다", () => {
    const parsed = parseStudioServerAiCompletion({
      content: "완료",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      usage: { promptTokens: -1, completionTokens: 3.5, totalTokens: 8 },
      failover: {
        attemptedProvider: "zai",
        attemptedModel: "glm-5.1",
        actualProvider: "deepseek",
        actualModel: "mismatch",
        reason: "billing_quota_exhausted",
        rawError: "private-upstream-body",
      },
      rawError: "private-upstream-body",
    });

    expect(parsed).toEqual({
      content: "완료",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      usage: { totalTokens: 8 },
    });
    expect(JSON.stringify(parsed)).not.toContain("private-upstream-body");
  });

  it("openrouter 공급자 응답도 파싱한다 — 서버가 openrouter로 응답하면 클라이언트 파싱이 실패해 유료 결과가 사라졌었다", () => {
    const parsed = parseStudioServerAiCompletion({
      content: "팔레트 제안",
      provider: "openrouter",
      model: "stealth/ox-alpha",
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    });
    expect(parsed).toEqual({
      content: "팔레트 제안",
      provider: "openrouter",
      model: "stealth/ox-alpha",
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    });
  });

  it("필수 실제 provider/model이 잘못된 응답은 비밀값을 반사하지 않는 parse_error로 거부한다", async () => {
    apiPost.mockResolvedValue({
      content: "결과",
      provider: "server-secret-key",
      model: "deepseek-v4-flash",
    });

    const result = await completeStudioServerText({
      task: "composition",
      promptVersion: 1,
      system: "구도를 제안하세요.",
      user: "옥상 장면",
      operationId: "composition-00000000-0000-4000-8000-000000000003",
    });

    expect(result).toEqual({
      ok: false,
      code: "parse_error",
      error: "서버 AI 응답 형식을 확인하지 못했어요.",
    });
    expect(JSON.stringify(result)).not.toContain("server-secret-key");
  });

  it("API 오류를 UI용 결과로 변환한다", async () => {
    apiPost.mockRejectedValue(new Error("로그인이 필요해요."));
    await expect(
      completeStudioServerText({
        task: "palette",
        promptVersion: 1,
        system: "JSON 팔레트를 만드세요.",
        user: "새벽 바다",
        operationId: "palette-00000000-0000-4000-8000-000000000004",
      })
    ).resolves.toMatchObject({ ok: false, code: "http_error", error: "로그인이 필요해요." });
  });
});
