import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StudioOriginalAssetMarketplacePanel } from "./StudioOriginalAssetMarketplacePanel";

const succeed = () => true;
const panelSource = readFileSync(
  new URL("./StudioOriginalAssetMarketplacePanel.tsx", import.meta.url),
  "utf8",
);

function renderPanel() {
  return renderToStaticMarkup(
    <StudioOriginalAssetMarketplacePanel onUseAsset={succeed} initialOpen />
  );
}

describe("StudioOriginalAssetMarketplacePanel", () => {
  it("renders a local-only original catalog without implying checkout or cloud sync", () => {
    const html = renderPanel();

    expect(html).toContain('data-studio-original-marketplace="local-phase-1"');
    expect(html).toContain("독자 무료 스타터 마켓");
    expect(html).toContain("24 FREE");
    expect(html).toContain("LOCAL PHASE 1");
    expect(html).toContain("결제·클라우드 동기화 없이");
    expect(html).toContain("결제 기능도 비활성");
    expect(html).toContain("로그인 동기화·결제·구독·판매자 정산은 Phase 1 범위에 포함되지 않습니다.");
    expect(html).not.toContain("구매 완료");
    expect(html).not.toContain("결제 완료");
    expect(html).not.toContain("클라우드 저장 완료");
  });

  it("shows package provenance, license, version, compatibility and update boundaries", () => {
    const html = renderPanel();

    expect(html).not.toContain("일상 공간 블록아웃");
    expect(html).toContain("매일 쓰는 생활 소품");
    expect(html).toContain("날씨와 감정 오버레이");
    expect(html).toContain("판타지·SF 장르 소품");
    expect(html).toContain("ToonSpectrum Lab");
    expect(html).toContain("original-procedural · CC0");
    expect(html).toContain("Canvas 2D · SVG · 모든 기기");
    expect(html).toContain("기기 로컬 · 클라우드 미지원");
    expect(html).toContain("v1.0.0 변경 사항");
    expect(html).toContain("메타데이터 전용 로컬 명세 내보내기");
  });

  it("renders all 24 selectable, draggable starter assets with real placement actions", () => {
    const html = renderPanel();

    expect(html.match(/data-studio-original-asset=/g)).toHaveLength(24);
    expect(html).not.toContain('data-studio-original-asset="original-compact-studio-room"');
    expect(html).toContain('data-studio-original-asset="original-city-bicycle"');
    expect(html).toContain('data-studio-original-asset="original-night-bokeh"');
    expect(html).toContain('data-studio-original-asset="original-sci-fi-airlock"');
    expect(html).toContain("선택한 컷 또는 현재 보이는 위치에 추가");
    expect(html).toContain("캔버스로 끌어 배치할 수 있습니다.");
    expect(html).toContain('draggable="true"');
    expect(html).toContain("클릭·탭");
    expect(html).toContain("끌어 놓기");
  });

  it("provides search, multi-filter, local library, updates and pricing states", () => {
    const html = renderPanel();

    expect(html).toContain('aria-label="독자 무료 스타터 에셋 검색"');
    expect(html).toContain('aria-controls="studio-original-marketplace-filters"');
    expect(html).toContain("카테고리 · 복수 선택");
    expect(html).toContain("<option");
    expect(html).toContain("무료 (3)");
    expect(html).toContain("유료 (0)");
    expect(html).toContain("구독 (0)");
    expect(html).toContain("내 라이브러리");
    expect(html).toContain("업데이트");
    expect(html).toContain("로컬 라이브러리에 추가");
  });

  it("uses the V12 SQLite product repository and never reads or writes localStorage", () => {
    expect(panelSource).toContain("getProductStudioMarketplaceLibrarySqliteRepository");
    expect(panelSource).toContain("repository.list()");
    expect(panelSource).toContain("repository.save(nextState");
    expect(panelSource).not.toContain("globalThis.localStorage");
    expect(panelSource).not.toContain("loadStudioMarketplaceLibrary(currentStorage())");
    expect(panelSource).not.toContain("saveStudioMarketplaceLibrary(storage");
  });

  it("keeps the upload/share rights boundary visible and explicit", () => {
    const html = renderPanel();

    expect(html).toContain("업로드·공유 권리 체크");
    expect(html).toContain("직접 만든 원본·절차형 자료");
    expect(html).toContain("CC0 또는 재배포를 명시적으로 허용한 라이선스");
    expect(html).toContain("권리자의 명시적 재배포 허가와 증빙");
    expect(html).toContain("다른 마켓에서 받은 소재와 구매 파일은 무료 여부와 관계없이 재배포할 수 없습니다.");
    expect(html).toContain("서버 판매·정산·권리 인증 기능은 아직 제공하지 않습니다.");
  });

  it("owns preview focus, Escape, tab trapping and success-only dismissal through the shared modal contract", () => {
    expect(panelSource).toContain("useStudioModalSheet({");
    expect(panelSource).toContain('data-studio-modal-backdrop="true"');
    expect(panelSource).toContain('data-autofocus="true"');
    expect(panelSource).toContain("if (inserted) setPreviewAsset(null)");
  });
});
