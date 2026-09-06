// StudioPaletteSuggestPanel의 "마운트 시점" 렌더 계약 회귀 테스트.
//
// StudioDialogueSuggestPanel.test.tsx와 동일한 제약(vitest.config.ts environment:"node", jsdom/
// happy-dom 없음)이라 renderToStaticMarkup(1회성 SSR 렌더)만 쓴다 — 버튼 클릭 시 onGenerate/
// onSaveToLibrary가 실제로 호출되는지는 이벤트 시뮬레이션이 필요해 이 스위트의 스코프 밖이다(콜백은
// 절대 호출되지 않는 no-op으로 넘긴다).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StudioPaletteSuggestPanel } from "./StudioPaletteSuggestPanel";

import type { PaletteSuggestion } from "./studio-palette-suggest";

const noop = () => {
  // 이 스위트는 정적 마운트 렌더만 검증한다 — 이벤트 콜백은 절대 호출되지 않는다.
};

const SUGGESTION: PaletteSuggestion = {
  name: "스릴러 - 어둡고 차가운",
  colors: [
    { hex: "#101820", role: "주조색" },
    { hex: "#c94f4f", role: "포인트색" },
  ],
};

function renderPanel(overrides: Partial<Parameters<typeof StudioPaletteSuggestPanel>[0]> = {}) {
  return renderToStaticMarkup(
    <StudioPaletteSuggestPanel
      configured={false}
      moodText=""
      onMoodTextChange={noop}
      busy={false}
      error={null}
      suggestion={null}
      savedMessage={null}
      onGenerate={noop}
      onSaveToLibrary={noop}
      {...overrides}
    />
  );
}

describe("StudioPaletteSuggestPanel mount-time render contract", () => {
  it("shows the settings guidance and disables the textarea/button when not configured", () => {
    const html = renderPanel({ configured: false });

    expect(html).toContain("AI 어시스트 설정");
    expect(html).toContain("로그인해 서버 AI를 사용하거나");
    expect(html).toContain("내 API 키를 등록하면 쓸 수 있어요");
    expect(html).toMatch(/<textarea[^>]*disabled=""/);
    expect(html).toMatch(/<button type="button"[^>]*disabled=""/);
  });

  it("hides the settings guidance and enables the textarea when configured", () => {
    const html = renderPanel({ configured: true });

    expect(html).not.toContain("API 키를 등록하면 이");
    expect(html).not.toMatch(/<textarea[^>]*disabled=""/);
  });

  it("disables the generate button when the mood text is blank even if configured", () => {
    const html = renderPanel({ configured: true, moodText: "   " });
    const buttonMatch = /<button type="button"([^>]*)>[\s\S]*?팔레트 추천받기/.exec(html);
    expect(buttonMatch?.[1]).toContain('disabled=""');
  });

  it("shows the busy spinner label and disables the generate button while busy", () => {
    const html = renderPanel({ configured: true, moodText: "스릴러", busy: true });
    expect(html).toContain("배색을 구상하는 중…");
    const buttonMatch = /<button type="button"([^>]*)>[\s\S]*?배색을 구상하는 중/.exec(html);
    expect(buttonMatch?.[1]).toContain('disabled=""');
  });

  it("renders the error message when given", () => {
    const html = renderPanel({ configured: true, error: "설정에서 API 키를 등록하세요." });
    expect(html).toContain("설정에서 API 키를 등록하세요.");
  });

  it("renders no suggestion card when suggestion is null or has no colors", () => {
    const cardClass = "rounded-lg border border-line bg-card/70 p-2";
    expect(renderPanel({ suggestion: null })).not.toContain(cardClass);
    expect(renderPanel({ suggestion: { name: "빈 팔레트", colors: [] } })).not.toContain(cardClass);
  });

  it("renders the suggestion name, one swatch per color, and the save button", () => {
    const html = renderPanel({ configured: true, suggestion: SUGGESTION });

    expect(html).toContain("스릴러 - 어둡고 차가운");
    expect(html).toContain("주조색");
    expect(html).toContain("포인트색");
    expect(html.match(/#101820/g)?.length).toBeGreaterThanOrEqual(1);
    expect(html.match(/#c94f4f/g)?.length).toBeGreaterThanOrEqual(1);
    expect(html).toContain("내 팔레트에 저장");
  });

  it("falls back to a default label when the suggested name is blank", () => {
    const html = renderPanel({ configured: true, suggestion: { ...SUGGESTION, name: "" } });
    expect(html).toContain("이름 없는 팔레트");
  });

  it("does not render the saved message by default, and renders it when given", () => {
    expect(renderPanel({ configured: true, suggestion: SUGGESTION, savedMessage: null })).not.toMatch(
      /role="status"/
    );
    const html = renderPanel({ configured: true, suggestion: SUGGESTION, savedMessage: "저장했어요." });
    expect(html).toContain("저장했어요.");
    expect(html).toMatch(/role="status"/);
  });
});
