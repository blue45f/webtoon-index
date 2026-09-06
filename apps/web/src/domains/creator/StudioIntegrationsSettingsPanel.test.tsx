// StudioIntegrationsSettingsPanel의 "마운트 시점" 렌더 계약 회귀 테스트.
//
// components/author-line.test.tsx 등 이 저장소 기존 .test.tsx와 동일하게 renderToStaticMarkup만
// 쓴다(jsdom/happy-dom 미보유 — StudioStockImagePanel.test.tsx 상단 주석 참고). 이 스위트가
// 증명하는 건 "AI 어시스트 설정(합성한 StudioAiSettingsPanel)과 무료 스톡 이미지(Unsplash) 두 섹션이
// 모두 렌더되고, 각각 props/storage로 주입한 값을 정확히 반영하는가"까지다 — 입력 이벤트로 값이
// 바뀌는 상호작용은 이벤트 시뮬레이션이 필요해 스코프 밖이다(StudioStockImagePanel.test.tsx와 동일한
// 한계).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, afterEach } from "vitest";

import { STUDIO_AI_DEFAULT_SETTINGS, type StudioAiSettings } from "./ai/studio-ai-client";
import { STUDIO_STOCK_IMAGE_ACCESS_KEY_STORAGE_KEY } from "./studio-stock-image-client";
import { StudioIntegrationsSettingsPanel } from "./StudioIntegrationsSettingsPanel";

// StudioStockImagePanel.test.tsx의 fakeStorage와 동일한 최소 stub(중복 정의 — 두 BYOK 기능을 코드
// 레벨에서도 독립적으로 유지하는 studio-stock-image-client.ts의 설계 원칙과 결을 맞췄다).
function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}

const noopChange = (_next: StudioAiSettings) => {
  // 이 스위트는 정적 마운트 렌더만 검증한다 — onAiSettingsChange는 절대 호출되지 않는다(입력 이벤트가
  // 없다).
};

describe("StudioIntegrationsSettingsPanel mount-time render contract", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "localStorage");
    Reflect.deleteProperty(globalThis, "sessionStorage");
  });

  it("renders both the AI assist section and the Unsplash section, unconfigured by default", () => {
    globalThis.localStorage = fakeStorage() as unknown as Storage;
    globalThis.sessionStorage = fakeStorage() as unknown as Storage;

    const html = renderToStaticMarkup(
      <StudioIntegrationsSettingsPanel aiSettings={STUDIO_AI_DEFAULT_SETTINGS} onAiSettingsChange={noopChange} />
    );

    // AI 어시스트 설정 섹션 — 기존 StudioAiSettingsPanel을 그대로 합성했으므로 그 헤더·기본 baseURL이
    // 그대로 나와야 한다(로직 재구현이 아니라 재사용임을 증명).
    expect(html).toContain("AI 어시스트 설정");
    expect(html).toContain(STUDIO_AI_DEFAULT_SETTINGS.baseUrl);
    expect(html).toContain("연결 테스트");

    // 무료 스톡 이미지(Unsplash) 섹션 — 헤더·미등록 상태.
    expect(html).toContain("무료 스톡 이미지 (Unsplash)");
    expect(html).toContain("Unsplash Access Key");
    expect(html).toContain("AI 키와 Unsplash 키는 현재 탭 세션에만");
    expect(html).toContain("min-h-11 w-full");
    expect(html).toContain("size-11");
    expect(html).not.toContain("Access Key 등록됨");
  });

  it("reflects a saved AI API key and a saved Unsplash Access Key", () => {
    globalThis.localStorage = fakeStorage({
      [STUDIO_STOCK_IMAGE_ACCESS_KEY_STORAGE_KEY]: "legacy-key-must-not-import",
    }) as unknown as Storage;
    globalThis.sessionStorage = fakeStorage({
      [STUDIO_STOCK_IMAGE_ACCESS_KEY_STORAGE_KEY]: "unsplash-existing-key",
    }) as unknown as Storage;
    const aiSettings: StudioAiSettings = { ...STUDIO_AI_DEFAULT_SETTINGS, apiKey: "sk-test-123" };

    const html = renderToStaticMarkup(
      <StudioIntegrationsSettingsPanel aiSettings={aiSettings} onAiSettingsChange={noopChange} />
    );

    // AI 섹션에 전달한 apiKey가 (마스킹되어도) 실제로 그 값으로 채워졌는지 — type="password" 필드라
    // 화면엔 점으로 보이지만 DOM value 속성 자체엔 원문이 들어간다.
    expect(html).toContain('value="sk-test-123"');
    // 스톡 이미지 섹션은 현재 탭의 sessionStorage 값만 반영해 "등록됨" 배지가 뜬다.
    expect(html).toContain("Access Key 등록됨");
    expect(html).toContain('value="unsplash-existing-key"');
    expect(html).not.toContain("legacy-key-must-not-import");
  });
});
