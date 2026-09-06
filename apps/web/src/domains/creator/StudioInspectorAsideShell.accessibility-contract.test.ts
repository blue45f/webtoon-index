import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const asideSource = readFileSync(
  new URL("./StudioInspectorAsideShell.tsx", import.meta.url),
  "utf8",
);

const inspectorColumnSource = readFileSync(
  new URL(
    "./studio-cuttoon-editor/StudioCuttoonEditorInspectorColumn.tsx",
    import.meta.url,
  ),
  "utf8",
);

const walkthroughSource = readFileSync(
  new URL("../../../../../scripts/verify-studio-inspector-walkthrough.mts", import.meta.url),
  "utf8",
);

describe("StudioInspectorAsideShell mobile accessibility contract", () => {
  it("uses one accurate work-panel name across the dialog and drag handle", () => {
    expect(asideSource).toContain('aria-label="작업 패널"');
    expect(asideSource).toContain('label="작업 패널"');
    expect(asideSource).not.toContain('aria-label={isMobile ? "속성" : undefined}');
  });

  it("reopens a collapsed desktop Inspector before command-search navigation or palette focus", () => {
    // 세 경로(엣지 레일 onRequestOpen · 인스펙터 내비게이션 · 팔레트 펼치기)에 더해, 분리형 패널
    // 웨이브가 "인스펙터를 띄울 때도 접힌 패널을 먼저 편다"는 네 번째 경로를 넣었다.
    expect(asideSource.match(/setRightPanelOpen\(true\)/g)).toHaveLength(4);
    expect(asideSource).toContain("if (next) setRightPanelOpen(true);");
    expect(asideSource).toContain(
      "onRequestOpen={() => setRightPanelOpen(true)}",
    );
    expect(asideSource).toContain("globalThis.requestAnimationFrame?.(() => {");
    expect(asideSource).toContain("requestStudioInspectorFocus(");
  });
});

/**
 * 이 패널의 chrome 은 두 파일에 나뉘어 있다. 접기 버튼은 `StudioInspectorAsideShell`
 * 에, 다시 펼치는 엣지 레일과 너비 스플리터는 `StudioCuttoonEditorInspectorColumn`
 * 에 있다. PR #517 이 앞쪽만 "작업 패널"로 바꾸는 바람에, 패널을 접으면 되돌리는
 * 어포던스만 옛 이름("속성")으로 남아 접기/펼치기 짝의 이름이 갈라졌다.
 *
 * 두 번째 단언이 더 중요하다. 엣지 레일 `title` 은 순수 카피가 아니라
 * `scripts/verify-studio-inspector-walkthrough.mts` 가 접기→펼치기 왕복을 재현할 때
 * 쓰는 셀렉터다. 한쪽만 바꾸면 검증기가 조용히 "되돌릴 어포던스가 없다"고 보고한다.
 */
describe("작업 패널 접기/펼치기 짝은 한 이름을 쓰고, 검증기 셀렉터도 그 이름을 본다", () => {
  it("접기 버튼과 엣지 레일·스플리터가 모두 '작업 패널'이다", () => {
    expect(asideSource).toContain('aria-label="작업 패널 접기"');
    expect(asideSource).toContain('title="작업 패널 접기"');
    // 엣지 레일의 접근 이름은 `${label} 펼치기` 로 만들어진다(StudioEdgeRailButton).
    expect(inspectorColumnSource).toContain('label="작업 패널"');
    expect(inspectorColumnSource).toContain('title="작업 패널 펼치기"');
    expect(inspectorColumnSource).toContain('label="작업 패널 너비 조절"');
    expect(inspectorColumnSource).not.toContain('label="속성"');
    expect(inspectorColumnSource).not.toContain('title="속성 패널 펼치기"');
    expect(inspectorColumnSource).not.toContain('label="속성 패널 너비 조절"');
  });

  it("워크스루 검증기가 고르는 title 이 실제로 출하되는 title 이다", () => {
    const selected = [
      ...walkthroughSource.matchAll(/button\[title="([^"]+)"\]/gu),
    ].map((match) => match[1] as string);
    const panelChromeTitles = selected.filter((title) =>
      title.endsWith("패널 접기") || title.endsWith("패널 펼치기"),
    );
    expect(panelChromeTitles.length).toBeGreaterThan(0);
    const shippedChrome = `${asideSource}\n${inspectorColumnSource}`;
    for (const title of panelChromeTitles) {
      expect(shippedChrome, title).toContain(`title="${title}"`);
    }
  });
});
