// 저장소 Vitest 환경은 node이므로 정적 렌더로 고급 채우기 패널의 접근성·모바일 제어 계약을
// 검증한다. 픽셀 계산은 studio-advanced-fill 테스트가, 실제 캔버스 이벤트 연결은 StudioPage가 맡는다.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DEFAULT_STUDIO_ADVANCED_FILL_SETTINGS } from "./studio-advanced-fill-settings";
import {
  StudioFloodFillPanel,
  type StudioFloodFillPanelProps,
} from "./StudioFloodFillPanel";

import type { AdvancedFillDiagnostics } from "./studio-advanced-fill";

const noop = () => {
  // 정적 렌더 테스트에서는 콜백을 실행하지 않는다.
};

const DIAGNOSTICS: AdvancedFillDiagnostics = {
  status: "applied",
  width: 100,
  height: 100,
  referenceSource: "reference-image",
  requestedSeedCount: 1,
  uniqueSeedCount: 1,
  acceptedSeedCount: 1,
  rejectedSeedCount: 0,
  paintedPixelCount: 1_250,
  matched: {
    pixelCount: 1_200,
    areaRatio: 0.12,
    touchesCanvasEdge: false,
    bounds: { x: 10, y: 10, width: 40, height: 30 },
  },
  final: {
    pixelCount: 1_250,
    areaRatio: 0.125,
    touchesCanvasEdge: true,
    bounds: { x: 9, y: 9, width: 42, height: 32 },
  },
  mask: {
    supplied: false,
    mode: "allow",
    threshold: 0,
    constrainExpansion: true,
  },
  leakGuard: {
    triggered: false,
    phase: null,
    maxAreaRatio: 0.65,
    maxPixelCount: 6_500,
  },
  closeGapRadius: 0,
  areaAdjustment: 1.5,
};

function renderPanel(overrides: Partial<StudioFloodFillPanelProps> = {}): string {
  const props: StudioFloodFillPanelProps = {
    active: false,
    busy: false,
    fillColor: "#ff6b6b",
    settings: { ...DEFAULT_STUDIO_ADVANCED_FILL_SETTINGS },
    referenceLayerCount: 0,
    visibleRasterCount: 0,
    selectedIsReference: false,
    onToggleActive: noop,
    onFillColorChange: noop,
    onSettingsChange: noop,
    onToggleSelectedReference: noop,
    onResetSettings: noop,
    ...overrides,
  };
  return renderToStaticMarkup(<StudioFloodFillPanel {...props} />);
}

function openingTagForLabel(html: string, tagName: string, ariaLabel: string): string {
  const labelIndex = html.indexOf(`aria-label="${ariaLabel}"`);
  if (labelIndex < 0) return "";
  const start = html.lastIndexOf(`<${tagName}`, labelIndex);
  const end = html.indexOf(">", labelIndex);
  return html.slice(start, end + 1);
}

function openingButtonForText(html: string, text: string): string {
  const textIndex = html.indexOf(text);
  if (textIndex < 0) return "";
  const start = html.lastIndexOf("<button", textIndex);
  const end = html.indexOf(">", start);
  return html.slice(start, end + 1);
}

describe("StudioFloodFillPanel advanced-fill presentation", () => {
  it("renders a main-canvas tool shell without the retired independent preview canvas", () => {
    const html = renderPanel();

    expect(html).toContain("고급 채우기");
    expect(html).toContain("메인 캔버스에서 선화 안쪽을 바로 채웁니다.");
    expect(html).toContain("브라우저 로컬");
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("캔버스에서 채우기");
    expect(html).not.toContain("<canvas");
    expect(html).not.toContain("이미지를 클릭해 같은 색 영역");
  });

  it("keeps primary, color, scope, reference, disclosure, reset, and slider targets mobile-safe", () => {
    const html = renderPanel();

    expect(html).toContain('aria-label="채우기 색상 선택"');
    expect(html).toContain("채우기 색상");
    expect(html).toContain("참조 범위");
    expect(html).toContain("고급 설정");
    expect(html).toContain("선택 레이어를 참조로 설정");
    expect(html).toContain("고급 채우기 설정 초기화");
    expect(html.match(/type="range"/g)).toHaveLength(4);
    expect(html.match(/h-11/g)?.length).toBeGreaterThanOrEqual(13);
    expect(html).toContain("허용 오차");
    expect(html).toContain("확장·축소");
    expect(html).toContain("틈 닫기");
    expect(html).toContain("연결된 영역만");
    expect(html).toContain("가장자리 부드럽게");
    expect(html).toContain("연속 채우기");
    expect(html).toContain("채우기 누수 보호");
    expect(html).toContain("캔버스 가장자리를 경계로 사용");
  });

  it("does not expose a selected-layer reference action when no layer is selected", () => {
    const html = renderPanel({ canToggleSelectedReference: false });

    expect(html).not.toContain("선택 레이어를 참조로 설정");
    expect(html).toContain("참조 범위");
  });

  it("disables unavailable reference scopes while retaining an escape to the current layer", () => {
    const emptyHtml = renderPanel();
    const referenceOption = emptyHtml.match(/<option value="reference"[^>]*>/)?.[0] ?? "";
    const visibleOption = emptyHtml.match(/<option value="all-visible"[^>]*>/)?.[0] ?? "";
    const currentOption = emptyHtml.match(/<option value="current"[^>]*>/)?.[0] ?? "";

    expect(referenceOption).toContain('disabled=""');
    expect(visibleOption).toContain('disabled=""');
    expect(currentOption).not.toContain("disabled");

    const availableHtml = renderPanel({ referenceLayerCount: 2, visibleRasterCount: 5 });
    expect(availableHtml).toContain("참조 레이어 · 2");
    expect(availableHtml).toContain("표시 래스터(편집 대상 제외) · 5");
    expect(availableHtml.match(/<option value="reference"[^>]*>/)?.[0]).not.toContain("disabled");
    expect(availableHtml.match(/<option value="all-visible"[^>]*>/)?.[0]).not.toContain(
      "disabled"
    );
  });

  it("exposes busy, active, unsupported-target, and selected-reference states honestly", () => {
    const html = renderPanel({
      active: true,
      busy: true,
      selectedIsReference: true,
      targetUnsupportedReason: "선택한 요소는 래스터 이미지가 아니에요.",
    });
    const colorTag = openingTagForLabel(html, "input", "채우기 색상 선택");
    const cancelButton = openingButtonForText(html, "계산 취소");

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("계산 취소");
    expect(cancelButton).not.toContain(' disabled=""');
    expect(html).toContain('role="alert"');
    expect(html).toContain("선택한 요소는 래스터 이미지가 아니에요.");
    expect(html).toContain("선택 레이어 참조 해제");
    expect(colorTag).toContain('disabled=""');
    expect(html).toContain("<fieldset disabled=\"\"");
    expect(html).toContain('role="status"');
  });

  it("keeps cancellation available only when the fill tool is active", () => {
    const activeBusyHtml = renderPanel({ active: true, busy: true });
    const cancelButton = openingButtonForText(activeBusyHtml, "계산 취소");
    expect(cancelButton).not.toContain('disabled=""');
    expect(activeBusyHtml).toContain(
      "진행 중에도 이 버튼으로 계산과 채우기 도구를 종료할 수 있습니다."
    );

    const inactiveBusyHtml = renderPanel({ active: false, busy: true });
    const busyButton = openingButtonForText(inactiveBusyHtml, "계산 중…");
    expect(busyButton).toContain('disabled=""');
    expect(inactiveBusyHtml).not.toContain("계산 취소");
    expect(inactiveBusyHtml).toContain("이전 계산이 끝나면 채우기 도구를 다시 켤 수 있습니다.");
  });

  it("documents the current compositing boundary and summarizes engine diagnostics", () => {
    const html = renderPanel({
      referenceLayerCount: 1,
      visibleRasterCount: 3,
      statusMessage: "참조 선화를 기준으로 채웠어요.",
      diagnostics: DIAGNOSTICS,
    });

    expect(html).toContain("보이는 래스터 원본만 합성하고 편집 대상은 제외합니다.");
    expect(html).toContain("필터·마스크·기울임");
    expect(html).toContain("혼합 모드·아래 레이어 클리핑·페이지 색보정");
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("참조 선화를 기준으로 채웠어요.");
    expect(html).toContain("1,250px");
    expect(html).toContain("12.5%");
    expect(html).toContain("합성");
    expect(html).toContain("캔버스 접촉");
  });

  it("labels diagnostics as the current run when the preview summary spans multiple regions", () => {
    const html = renderPanel({
      statusMessage: "누적 미리보기 · 2개 영역 · 25.0% · 2,500px",
      diagnostics: DIAGNOSTICS,
    });

    expect(html).toContain("누적 미리보기 · 2개 영역");
    expect(html).toContain("이번 적용");
    expect(html).toContain("1,250px");
  });
});
