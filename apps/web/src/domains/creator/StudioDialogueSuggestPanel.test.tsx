// StudioDialogueSuggestPanel의 "마운트 시점" 렌더 계약 회귀 테스트.
//
// 이 스위트는 renderToStaticMarkup(1회성 SSR 렌더, StudioStockImagePanel.test.tsx/ad-slot.test.tsx가
// 쓰는 것과 동일한 패턴)만 쓴다 — package.json에 jsdom/happy-dom이 없어(vitest.config.ts
// environment:"node") @testing-library/react의 render()/fireEvent를 쓸 수 없다. 그래서 이 스위트가
// 증명하는 건 "컴포넌트가 처음 마운트되는 순간, props 조합에 따라 안내 문구/비활성화 상태/버튼 노출이
// 정확한가"까지다 — 버튼 클릭 시 onGenerate/onAddToScript/onInsertToSelected가 실제로 호출되는지는
// 이벤트 시뮬레이션이 필요해 이 스위트의 스코프 밖이다(콜백은 절대 호출되지 않는 no-op으로 넘긴다).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StudioDialogueSuggestPanel } from "./StudioDialogueSuggestPanel";

import type { DialogueSuggestionCandidate } from "./lettering/studio-dialogue-suggest";

const noop = () => {
  // 이 스위트는 정적 마운트 렌더만 검증한다 — 이벤트 콜백은 절대 호출되지 않는다.
};

const CANDIDATES: DialogueSuggestionCandidate[] = [
  { speaker: "민수", text: "나 전학왔어.", kind: "speech" },
  { speaker: "", text: "교실이 순간 조용해진다", kind: "narration" },
];

function renderPanel(overrides: Partial<Parameters<typeof StudioDialogueSuggestPanel>[0]> = {}) {
  return renderToStaticMarkup(
    <StudioDialogueSuggestPanel
      configured={false}
      situationText=""
      onSituationTextChange={noop}
      hasContext={false}
      includeContext={false}
      onIncludeContextChange={noop}
      busy={false}
      error={null}
      candidates={null}
      onGenerate={noop}
      canInsertToSelected={false}
      onAddToScript={noop}
      onInsertToSelected={noop}
      {...overrides}
    />
  );
}

describe("StudioDialogueSuggestPanel mount-time render contract", () => {
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

  it("disables the generate button when the situation text is blank even if configured", () => {
    const html = renderPanel({ configured: true, situationText: "   " });
    expect(html).toMatch(/대사 제안 받기[\s\S]*?<\/button>/);
    // 버튼 자체가 disabled 속성을 갖는지 앞부분에서 확인.
    const buttonMatch = /<button type="button"([^>]*)>[\s\S]*?대사 제안 받기/.exec(html);
    expect(buttonMatch?.[1]).toContain('disabled=""');
  });

  it("does not render the 'include context' checkbox when hasContext is false", () => {
    const html = renderPanel({ configured: true, hasContext: false });
    expect(html).not.toContain("이미 배치된 대사를 맥락으로 포함");
    expect(html).not.toContain('type="checkbox"');
  });

  it("renders the checked 'include context' checkbox when hasContext is true and includeContext is true", () => {
    const html = renderPanel({ configured: true, hasContext: true, includeContext: true });
    expect(html).toContain("이미 배치된 대사를 맥락으로 포함");
    expect(html).toMatch(/<input type="checkbox"[^>]*checked=""/);
  });

  it("renders an unchecked checkbox when includeContext is false", () => {
    const html = renderPanel({ configured: true, hasContext: true, includeContext: false });
    expect(html).toMatch(/<input type="checkbox"(?![^>]*checked)/);
  });

  it("shows the busy spinner label and disables the generate button while busy", () => {
    const html = renderPanel({ configured: true, situationText: "상황", busy: true });
    expect(html).toContain("구상하는 중…");
    const buttonMatch = /<button type="button"([^>]*)>[\s\S]*?구상하는 중/.exec(html);
    expect(buttonMatch?.[1]).toContain('disabled=""');
  });

  it("renders the error message when given", () => {
    const html = renderPanel({ configured: true, error: "설정에서 API 키를 등록하세요." });
    expect(html).toContain("설정에서 API 키를 등록하세요.");
  });

  it("renders no candidate cards when candidates is null or empty", () => {
    const cardClass = "rounded-lg border border-line bg-card/70 p-2";
    expect(renderPanel({ candidates: null })).not.toContain(cardClass);
    expect(renderPanel({ candidates: [] })).not.toContain(cardClass);
  });

  it("renders one card per candidate with the formatted mini-syntax line, always offering 'add to script'", () => {
    const html = renderPanel({ configured: true, candidates: CANDIDATES, canInsertToSelected: false });

    expect(html).toContain("민수: 나 전학왔어.");
    expect(html).toContain("(교실이 순간 조용해진다)");
    // 안내 문구에도 같은 문구가 나오므로(항상 1회), 카드마다 나오는 버튼 아이콘(lucide-plus)으로
    // 후보 개수를 센다 — 안내 문구엔 아이콘이 없다.
    expect(html.match(/lucide-plus/g)).toHaveLength(CANDIDATES.length);
    expect(html).not.toContain("선택한 말풍선에 삽입");
  });

  it("also offers 'insert into selected' per candidate when canInsertToSelected is true", () => {
    const html = renderPanel({ configured: true, candidates: CANDIDATES, canInsertToSelected: true });

    expect(html.match(/선택한 말풍선에 삽입/g)).toHaveLength(CANDIDATES.length);
  });
});
