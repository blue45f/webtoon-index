import { describe, expect, it } from "vitest";

import { STUDIO_AI_ASSIST_TOOLS } from "./studio-ai-assist-ux";
import {
  planStudioAiExecutionPreflight,
  STUDIO_AI_EXECUTION_COST_CATEGORIES,
} from "./studio-ai-execution-preflight";

describe("planStudioAiExecutionPreflight", () => {
  it("describes a configured background generation without inventing an exact price", () => {
    const plan = planStudioAiExecutionPreflight({
      activeTool: "background",
      imageConfigured: true,
      textConfigured: false,
      connectionLabel: "이미지 API 연결됨",
      connectionOk: true,
    });

    expect(plan).toMatchObject({
      available: true,
      costCategory: "제공자 과금 가능",
      estimatedTimeCategory: "보통",
      externalTransfer: true,
      outputCount: 1,
      outputCountLabel: "배경 이미지 1개",
    });
    expect(plan.processingRoute).toContain("새 배경 이미지 요소");
    expect(plan.sourceNonDestructivePolicy).toContain("덮어쓰지 않고");
    expect(plan.costCategory).not.toMatch(/[₩$€¥]|\d+\.\d+/);
  });

  it("discloses reference-image transfer for character generation", () => {
    const plan = planStudioAiExecutionPreflight({
      activeTool: "character",
      imageConfigured: true,
      textConfigured: false,
      connectionLabel: "이미지 API 연결됨",
      connectionOk: true,
    });

    expect(plan.processingRoute).toContain("선택 참고 이미지");
    expect(plan.externalTransferLabel).toContain("선택한 참고 이미지");
    expect(plan.sourceNonDestructivePolicy).toContain("참고 이미지");
  });

  it("uses server quota for a server-provided text connection", () => {
    const plan = planStudioAiExecutionPreflight({
      activeTool: "composition",
      imageConfigured: false,
      textConfigured: true,
      connectionLabel: "DeepSeek 연결됨",
      connectionOk: true,
    });

    expect(plan.costCategory).toBe("서버 쿼터");
    expect(plan.outputCountLabel).toBe("구도 제안 1세트");
  });

  it("uses provider billing disclosure for a personal text API connection", () => {
    const plan = planStudioAiExecutionPreflight({
      activeTool: "dialogue",
      imageConfigured: false,
      textConfigured: true,
      connectionLabel: "내 API 연결됨",
      connectionOk: true,
    });

    expect(plan.costCategory).toBe("제공자 과금 가능");
  });

  it("reports the relevant image connection as unavailable even when text is connected", () => {
    const plan = planStudioAiExecutionPreflight({
      activeTool: "background",
      imageConfigured: false,
      textConfigured: true,
      connectionLabel: "Z.ai 연결됨",
      connectionOk: true,
    });

    expect(plan.available).toBe(false);
    expect(plan.unavailableReason).toContain("이미지 API가 연결되지 않아");
  });

  it("reports the relevant text connection as unavailable even when image is connected", () => {
    const plan = planStudioAiExecutionPreflight({
      activeTool: "palette",
      imageConfigured: true,
      textConfigured: false,
      connectionLabel: "이미지 API 연결됨",
      connectionOk: true,
    });

    expect(plan.available).toBe(false);
    expect(plan.unavailableReason).toContain("텍스트 AI가 연결되지 않아");
  });

  it("reports a failed connection check and bounds the displayed label", () => {
    const plan = planStudioAiExecutionPreflight({
      activeTool: "composition",
      imageConfigured: false,
      textConfigured: true,
      connectionLabel: `  연결   점검 중 ${"x".repeat(180)}  `,
      connectionOk: false,
    });

    expect(plan.available).toBe(false);
    expect(plan.connectionLabel.length).toBeLessThanOrEqual(120);
    expect(plan.connectionLabel).not.toContain("  ");
    expect(plan.unavailableReason).toContain(plan.connectionLabel);
    expect(plan.unavailableReason).toContain("정상으로 확인되지 않았습니다");
  });

  it("keeps every assist tool explicit, external, non-destructive, and manually retried", () => {
    for (const tool of STUDIO_AI_ASSIST_TOOLS) {
      const plan = planStudioAiExecutionPreflight({
        activeTool: tool.id,
        imageConfigured: true,
        textConfigured: true,
        connectionLabel: "연결됨",
        connectionOk: true,
      });

      expect(plan.processingRoute.length).toBeGreaterThan(10);
      expect(plan.externalTransfer).toBe(true);
      expect(plan.externalTransferLabel).toContain("실행 시");
      expect(plan.outputCount).toBe(1);
      expect(plan.outputCountLabel).toContain("1");
      expect(plan.fallbackRetryPolicy).toContain("자동 재시도 없음");
      expect(plan.sourceNonDestructivePolicy).toMatch(/자동 변경하지 않고|덮어쓰지 않고|바꾸지 않고/);
      expect(STUDIO_AI_EXECUTION_COST_CATEGORIES).toContain(plan.costCategory);
    }
  });

  it("defines the complete approved cost vocabulary", () => {
    expect(STUDIO_AI_EXECUTION_COST_CATEGORIES).toEqual([
      "로컬 0원",
      "제공자 과금 가능",
      "서버 쿼터",
    ]);
  });
});
