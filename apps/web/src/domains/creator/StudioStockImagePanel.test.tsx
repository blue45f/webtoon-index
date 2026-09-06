// StudioStockImagePanel의 "마운트 시점" 렌더 계약 회귀 테스트.
//
// 이 스위트는 renderToStaticMarkup(1회성 SSR 렌더, components/author-line.test.tsx 등 이 저장소의
// 기존 .test.tsx가 쓰는 것과 동일한 패턴)만 쓴다 — package.json에 jsdom/happy-dom이 없어(확인됨)
// @testing-library/react의 render()/fireEvent(실제 DOM 이벤트로 재렌더를 유발하는 API)를 쓸 수
// 없다. 그래서 이 스위트가 증명하는 건 "컴포넌트가 처음 마운트되는 순간, Access Key 저장 여부에 따라
// 안내 문구/검색 입력 활성화 상태가 정확히 반대인가"까지다 — onOpenSettings 클릭 시 실제로 통합
// 설정 패널이 열리는지(StudioPage.tsx의 setMenu("integrations") 배선)는 이벤트 시뮬레이션이 필요해
// 이 스위트의 스코프 밖이다.
//
// 2026-07 API 키 등록 동선 통합: 이 패널은 더 이상 Access Key 입력 UI를 갖지 않는다(그 UI는
// StudioIntegrationsSettingsPanel로 옮겨졌다 — StudioIntegrationsSettingsPanel.test.tsx 참고). 이
// 테스트도 예전의 <details>/입력 필드 검증에서 "안내 문구 + 연동 설정 열기 진입점" 검증으로 갱신됐다.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, afterEach } from "vitest";

import { STUDIO_STOCK_IMAGE_ACCESS_KEY_STORAGE_KEY } from "./studio-stock-image-client";
import { StudioStockImagePanel } from "./StudioStockImagePanel";

// studio-stock-image-client.test.ts의 createMemoryStorage와 동일한 최소 stub. 이 저장소는 Node
// 환경(vitest.config.ts environment:"node")이라 globalThis.sessionStorage가 원래 존재하지 않으므로
// (studio-stock-image-client.ts의 loadStudioStockImageAccessKey가 그 경우 ""로 취급하는 것과
// 동일하게), 테스트마다 이 stub을 globalThis에 직접 얹었다가 afterEach에서 지운다.
function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

const noopInsert = () => {
  // 이 스위트는 정적 마운트 렌더만 검증한다 — onInsert는 절대 호출되지 않는다(클릭 이벤트가 없음).
};
const noopOpenSettings = () => {
  // 위와 동일한 이유로 onOpenSettings도 절대 호출되지 않는다.
};

describe("StudioStockImagePanel mount-time render contract", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "sessionStorage");
  });

  it("shows the settings guidance and disables search when no Access Key is saved", () => {
    globalThis.sessionStorage = fakeStorage() as unknown as Storage;

    const html = renderToStaticMarkup(
      <StudioStockImagePanel onInsert={noopInsert} onOpenSettings={noopOpenSettings} />
    );

    expect(html).toContain("설정에서 Unsplash Access Key를 등록하세요.");
    expect(html).toContain("연동 설정 열기");
    expect(html).toContain('aria-label="연동 설정 열기"');
    expect(html).toMatch(/<input type="text" placeholder="예: 도시 야경, 카페, 바다" disabled="" /);
    expect(html).toContain("Access Key를 먼저 등록하세요.");
    // Access Key 입력 UI(과거의 <details>/input[type=password])는 더 이상 없다.
    expect(html).not.toContain("<details");
    expect(html).not.toContain('type="password"');
  });

  it("hides the settings guidance and enables search when an Access Key is already saved", () => {
    globalThis.sessionStorage = fakeStorage({
      [STUDIO_STOCK_IMAGE_ACCESS_KEY_STORAGE_KEY]: "unsplash-existing-key",
    }) as unknown as Storage;

    const html = renderToStaticMarkup(
      <StudioStockImagePanel onInsert={noopInsert} onOpenSettings={noopOpenSettings} />
    );

    expect(html).not.toContain("설정에서 Unsplash Access Key를 등록하세요.");
    expect(html).toContain('aria-label="연동 설정 열기"'); // 설정 진입점은 등록 후에도 항상 보여야 한다.
    expect(html).toMatch(/<input type="text" placeholder="예: 도시 야경, 카페, 바다" class="/);
    expect(html).toContain("검색어를 입력해 무료 사진을 찾아보세요.");
    expect(html).not.toContain("<details");
    expect(html).not.toContain('type="password"');
  });
});
