import { describe, expect, it } from "vitest";

import {
  STUDIO_AI_GENERATION_LABEL_DEFAULT_LOCALE,
  STUDIO_AI_GENERATION_LABEL_DISCLAIMER,
  STUDIO_AI_GENERATION_LABEL_RULESET_VERSION,
  STUDIO_AI_GENERATION_LABEL_STATUTE,
  planStudioAiGenerationLabel,
} from "./studio-ai-generation-label";

describe("planStudioAiGenerationLabel", () => {
  it("AI를 쓰지 않으면 표기 대상이 없고 워터마크 사양도 만들지 않는다", () => {
    const plan = planStudioAiGenerationLabel({ usage: "none", locale: "ko-KR" });

    expect(plan.obligation).toBe("not-required");
    expect(plan.key).toBe("ai-label/none/v1");
    expect(plan.labelText).toBe("");
    expect(plan.visibleMark).toBeNull();
    expect(plan.citations).toEqual([]);
    expect(plan.unverified).toEqual([]);
  });

  it("한국 로케일의 AI 생성물은 결과물 자체 표기를 요구하고 조문을 인용한다", () => {
    const plan = planStudioAiGenerationLabel({ usage: "generated", locale: "ko-KR" });

    expect(plan.obligation).toBe("required-on-result");
    expect(plan.jurisdiction).toBe("kr");
    expect(plan.key).toBe("ai-label/kr/generated/on-result/v1");
    expect(plan.labelText).toBe("이 콘텐츠는 생성형 AI로 만들어졌습니다.");
    expect(plan.citations).toEqual([STUDIO_AI_GENERATION_LABEL_STATUTE]);
    expect(plan.rationale).toContain(STUDIO_AI_GENERATION_LABEL_STATUTE.provision);
    expect(plan.rationale).toContain(STUDIO_AI_GENERATION_LABEL_STATUTE.decree);
    // 이 판정은 확인된 조문 하나에만 기대므로 미확인 전제가 남아 있으면 안 된다.
    expect(plan.unverified).toEqual([]);
  });

  it("AI 보조는 같은 관할에서도 권고에 그치고 미확인 전제를 남긴다", () => {
    const plan = planStudioAiGenerationLabel({ usage: "assisted", locale: "ko" });

    expect(plan.obligation).toBe("advisory");
    expect(plan.key).toBe("ai-label/kr/assisted/advisory/v1");
    expect(plan.labelText).toBe("이 콘텐츠의 제작에 생성형 AI가 사용되었습니다.");
    expect(plan.unverified).toHaveLength(1);
    expect(plan.unverified[0]).toContain("확인하지 못했습니다");
  });

  it("근거가 없는 관할은 요구로 단정하지 않고 조문도 인용하지 않는다", () => {
    const generated = planStudioAiGenerationLabel({ usage: "generated", locale: "en-US" });
    const assisted = planStudioAiGenerationLabel({ usage: "assisted", locale: "en-US" });

    expect(generated.jurisdiction).toBe("unverified");
    expect(generated.obligation).toBe("advisory");
    expect(generated.key).toBe("ai-label/unverified/generated/advisory/v1");
    expect(generated.labelText).toBe("This content was created with generative AI.");
    expect(generated.citations).toEqual([]);
    expect(generated.unverified[0]).toContain("의무가 없다는 뜻이 아니므로");

    expect(assisted.key).toBe("ai-label/unverified/assisted/advisory/v1");
    expect(assisted.labelText).toBe(
      "Generative AI was used in the making of this content."
    );
  });

  it("로케일을 생략하거나 비우면 확인된 관할인 한국으로 접는다", () => {
    for (const locale of [undefined, "", "   ", 42, null]) {
      const plan = planStudioAiGenerationLabel({ usage: "generated", locale });
      expect(plan.locale).toBe(STUDIO_AI_GENERATION_LABEL_DEFAULT_LOCALE);
      expect(plan.jurisdiction).toBe("kr");
      expect(plan.obligation).toBe("required-on-result");
    }
  });

  it("POSIX 구분자·대소문자·문자체계 서브태그를 정규화해 같은 판정을 낸다", () => {
    expect(planStudioAiGenerationLabel({ usage: "generated", locale: "ko_kr" }).locale).toBe("ko-KR");
    expect(planStudioAiGenerationLabel({ usage: "generated", locale: "KO-Kore-KR" }).locale).toBe(
      "ko-KR"
    );
    // 언어가 한국어가 아니어도 배포 지역이 KR이면 확인된 관할로 본다.
    const enKr = planStudioAiGenerationLabel({ usage: "generated", locale: "en-KR" });
    expect(enKr.jurisdiction).toBe("kr");
    expect(enKr.obligation).toBe("required-on-result");
    // 다만 문구는 독자가 읽을 수 있어야 하므로 영어를 준다.
    expect(enKr.labelText).toBe("This content was created with generative AI.");
  });

  it("알 수 없는 사용 방식은 표기 대상 없음으로 접는다", () => {
    expect(planStudioAiGenerationLabel({ usage: "GENERATED" }).obligation).toBe("not-required");
    expect(planStudioAiGenerationLabel({}).obligation).toBe("not-required");
    expect(planStudioAiGenerationLabel().obligation).toBe("not-required");
  });

  it("워터마크 사양은 판정 문구를 그대로 싣되 기본으로 켜지지 않는다", () => {
    const plan = planStudioAiGenerationLabel({ usage: "generated", locale: "ko" });

    expect(plan.visibleMark).not.toBeNull();
    expect(plan.visibleMark?.enabledByDefault).toBe(false);
    expect(plan.visibleMark?.text).toBe(plan.labelText);
    // [WCAG 2.2 SC 1.4.3] 일반 텍스트 최소 명암비.
    expect(plan.visibleMark?.minContrastRatio).toBe(4.5);
    expect(plan.visibleMark?.minHeightRatioOfShortEdge).toBeGreaterThan(0);
    expect(plan.visibleMark?.minPaddingRatioOfShortEdge).toBeGreaterThan(0);
  });

  it("결과와 워터마크 사양은 freeze 되어 호출자가 판정을 덧칠할 수 없다", () => {
    const plan = planStudioAiGenerationLabel({ usage: "generated", locale: "ko" });

    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.visibleMark)).toBe(true);
    expect(Object.isFrozen(STUDIO_AI_GENERATION_LABEL_STATUTE)).toBe(true);
  });

  it("모든 판정에 버전과 면책 문구가 붙는다", () => {
    for (const usage of ["none", "assisted", "generated"] as const) {
      for (const locale of ["ko", "en"]) {
        const plan = planStudioAiGenerationLabel({ usage, locale });
        expect(plan.version).toBe(STUDIO_AI_GENERATION_LABEL_RULESET_VERSION);
        expect(plan.disclaimer).toBe(STUDIO_AI_GENERATION_LABEL_DISCLAIMER);
        // 면책은 법적 충족을 약속하지 않는다는 것을 문장으로 말해야 한다.
        expect(plan.disclaimer).toContain("법률 자문");
      }
    }
  });
});
