import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";

import { StudioBg3dProSuitePanel } from "./StudioBg3dProSuitePanelContent";

describe("StudioBg3dProSuitePanel content", () => {
  it("renders all professional suite tabs: Grip, Dynamic, Lens, Director, Character, Cloner, Particle, Text, MatCap, Screentone, Deform, PostFX, MultiPass, Culling, Hair", () => {
    const markup = renderToStaticMarkup(<StudioBg3dProSuitePanel />);

    expect(markup).toContain("소품 그립");
    expect(markup).toContain("인터랙션");
    expect(markup).toContain("만화 렌즈");
    expect(markup).toContain("컷 디렉터");
    expect(markup).toContain("캐릭터/표정");
    expect(markup).toContain("3D 클로너");
    expect(markup).toContain("3D 파티클");
    expect(markup).toContain("3D 효과음");
    expect(markup).toContain("맷캡 재질");
    expect(markup).toContain("3D 망점/톤");
    expect(markup).toContain("디포머");
    expect(markup).toContain("렌즈 PostFX");
    expect(markup).toContain("멀티패스");
    expect(markup).toContain("배경 컬링");
    expect(markup).toContain("헤어 가닥");

    // Default Grip Tab
    expect(markup).toContain("6종 만화 손 그립 아키타입");
    expect(markup).toContain("검/칼 파워 그립");
    expect(markup).toContain("권총 방아쇠 그립");
    expect(markup).toContain("손가락 쥐는 악력 (Tightness)");
  });

  it("renders new startup-benchmarked webtoon tools: SHAPER, Tooning, Speedlines, Webtoon Filters, Foot Contact Lock", () => {
    const markup = renderToStaticMarkup(<StudioBg3dProSuitePanel />);

    expect(markup).toContain("셰이퍼 3D");
    expect(markup).toContain("투닝 연출");
    expect(markup).toContain("2.5D 집중선");
    expect(markup).toContain("웹툰 필터");
    expect(markup).toContain("지면 착지락");

    // Category navigation and search
    expect(markup).toContain("전체 (20)");
    expect(markup).toContain("캐릭터/포즈");
    expect(markup).toContain("연출/스토리");
    expect(markup).toContain("필터/이펙트");
    expect(markup).toContain("오브젝트/에셋");
    expect(markup).toContain("3D 프로 툴 검색");
  });

  it("renders properly in disabled mode", () => {
    const markup = renderToStaticMarkup(<StudioBg3dProSuitePanel disabled />);
    expect(markup).toContain("disabled");
  });
});
