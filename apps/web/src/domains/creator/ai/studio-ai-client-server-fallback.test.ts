import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  generateScenarioScenes,
  STUDIO_AI_DEFAULT_SETTINGS,
} from "./studio-ai-client";

const SCENARIO_OPERATION_ID = "scenario-00000000-0000-4000-8000-000000000011";

const { completeStudioServerTextMock } = vi.hoisted(() => ({
  completeStudioServerTextMock: vi.fn(),
}));

vi.mock("../studio-server-ai-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../studio-server-ai-client")>();
  return {
    ...actual,
    completeStudioServerText: completeStudioServerTextMock,
  };
});

describe("studio-ai-client server failover provenance", () => {
  beforeEach(() => {
    completeStudioServerTextMock.mockReset();
  });

  it("records the provider/model that actually produced the result and the allowlisted balance failover", async () => {
    completeStudioServerTextMock.mockResolvedValue({
      ok: true,
      data: {
        content: JSON.stringify({
          characterDescription: "검은 우산을 든 주인공",
          scenes: [{ imagePrompt: "빗속 옥상", dialogue: "주인공: 늦었어." }],
        }),
        provider: "deepseek",
        model: "deepseek-v4-flash",
        requestId: "actual-provider-request",
        usage: { promptTokens: 80, completionTokens: 40, totalTokens: 120 },
        failover: {
          attemptedProvider: "zai",
          attemptedModel: "glm-5.1",
          actualProvider: "deepseek",
          actualModel: "deepseek-v4-flash",
          reason: "billing_quota_exhausted",
        },
        providerError: "must-not-propagate",
        apiKey: "must-not-propagate",
      },
    });

    const result = await generateScenarioScenes(
      STUDIO_AI_DEFAULT_SETTINGS,
      "비 오는 옥상에서 재회한다.",
      {},
      { mode: "server", provider: "zai", operationId: SCENARIO_OPERATION_ID }
    );

    expect(result).toMatchObject({
      ok: true,
      data: {
        textProvenance: {
          provider: "deepseek",
          model: "deepseek-v4-flash",
          transport: "server",
          requestId: "actual-provider-request",
          usage: { promptTokens: 80, completionTokens: 40, totalTokens: 120 },
          failover: {
            attemptedProvider: "zai",
            attemptedModel: "glm-5.1",
            actualProvider: "deepseek",
            actualModel: "deepseek-v4-flash",
            reason: "billing_quota_exhausted",
          },
        },
      },
    });
    expect(completeStudioServerTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        task: "scenario",
        provider: "zai",
        operationId: SCENARIO_OPERATION_ID,
      }),
      undefined
    );
    expect(JSON.stringify(result)).not.toContain("must-not-propagate");
  });

  it("does not retain inconsistent failover metadata even when a caller bypasses the response parser", async () => {
    completeStudioServerTextMock.mockResolvedValue({
      ok: true,
      data: {
        content: JSON.stringify({
          characterDescription: "주인공",
          scenes: [{ imagePrompt: "옥상", dialogue: "" }],
        }),
        provider: "deepseek",
        model: "deepseek-v4-flash",
        failover: {
          attemptedProvider: "zai",
          attemptedModel: "glm-5.1",
          actualProvider: "deepseek",
          actualModel: "mismatched-model",
          reason: "billing_quota_exhausted",
          rawError: "private-provider-payload",
        },
      },
    });

    const result = await generateScenarioScenes(
      STUDIO_AI_DEFAULT_SETTINGS,
      "옥상 장면",
      {},
      {
        mode: "server",
        operationId: "scenario-00000000-0000-4000-8000-000000000012",
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.textProvenance.provider).toBe("deepseek");
    expect(result.data.textProvenance.model).toBe("deepseek-v4-flash");
    expect(result.data.textProvenance.failover).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("private-provider-payload");
  });

  it("reuses the exact tracked operation ID when an existing operation is deliberately retried", async () => {
    completeStudioServerTextMock.mockResolvedValue({
      ok: true,
      data: {
        content: JSON.stringify({
          characterDescription: "주인공",
          scenes: [{ imagePrompt: "옥상", dialogue: "" }],
        }),
        provider: "zai",
        model: "glm-5.1",
      },
    });
    const transport = {
      mode: "server" as const,
      provider: "zai" as const,
      operationId: SCENARIO_OPERATION_ID,
    };

    await generateScenarioScenes(STUDIO_AI_DEFAULT_SETTINGS, "옥상 장면", {}, transport);
    await generateScenarioScenes(STUDIO_AI_DEFAULT_SETTINGS, "옥상 장면", {}, transport);

    expect(completeStudioServerTextMock).toHaveBeenCalledTimes(2);
    for (const [request] of completeStudioServerTextMock.mock.calls) {
      expect(request).toMatchObject({ operationId: SCENARIO_OPERATION_ID });
    }
  });
});
