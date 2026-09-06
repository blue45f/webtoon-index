import { describe, expect, it } from "vitest";

import {
  createMergeTemplate,
  executeDataMerge,
  substituteTemplateTokens,
} from "./studio-bulk-create-data-merge";

describe("Studio Bulk Create & Data Merge Engine", () => {
  it("substitutes template tokens in text strings", () => {
    const raw = "안녕하세요, {characterName}님! 오늘 목적지는 {location}입니다.";
    const res = substituteTemplateTokens(raw, {
      characterName: "서윤",
      location: "중앙 도서관",
    });
    expect(res).toBe("안녕하세요, 서윤님! 오늘 목적지는 중앙 도서관입니다.");
  });

  it("executes batch merge with template slots and data records", () => {
    const template = createMergeTemplate({
      templateId: "tmpl_dialogue_card",
      templateName: "대사 카드 템플릿",
      rawTemplateText: "[{speaker}] {message}",
      slots: [
        { slotId: "s_speaker", slotType: "text", targetElementId: "el_speaker", fieldName: "speaker", required: true },
        { slotId: "s_message", slotType: "dialogue-bubble", targetElementId: "el_bubble", fieldName: "message", required: true },
        { slotId: "s_show_bg", slotType: "visibility-toggle", targetElementId: "el_bg", fieldName: "showBackground", defaultValue: false },
      ],
    });

    const dataset = [
      { speaker: "민우", message: "비가 오네...", showBackground: true },
      { speaker: "서윤", message: "우산 챙겼어?", showBackground: false },
      { speaker: "지호", message: "빨리 뛰자!", showBackground: true },
    ];

    const result = executeDataMerge(template, dataset, { idPrefix: "card" });

    expect(result.totalGenerated).toBe(3);
    expect(result.diagnostics).toHaveLength(0);

    expect(result.instances[0].instanceId).toBe("card_1");
    expect(result.instances[0].resolvedText).toBe("[민우] 비가 오네...");
    expect(result.instances[0].boundValues.s_show_bg).toBe(true);

    expect(result.instances[1].instanceId).toBe("card_2");
    expect(result.instances[1].resolvedText).toBe("[서윤] 우산 챙겼어?");
    expect(result.instances[1].boundValues.s_show_bg).toBe(false);
  });

  it("reports diagnostic error on missing required slot values", () => {
    const template = createMergeTemplate({
      templateId: "tmpl_req",
      templateName: "필수 슬롯 템플릿",
      slots: [
        { slotId: "s_id", slotType: "text", targetElementId: "el_id", fieldName: "requiredId", required: true },
      ],
    });

    const dataset = [
      { requiredId: "valid_01" },
      { requiredId: "" }, // missing
    ];

    const result = executeDataMerge(template, dataset);
    expect(result.totalGenerated).toBe(2);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toContain("필수 슬롯 'requiredId'");
  });
});
