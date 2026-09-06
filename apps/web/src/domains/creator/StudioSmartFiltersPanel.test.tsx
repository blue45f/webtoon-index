import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { StudioSmartFiltersPanel } from "./StudioSmartFiltersPanel";

describe("StudioSmartFiltersPanel", () => {
  // Catalogue titles are the #771 (c9ef0ff7) vocabulary; the former names remain search keywords.
  it("renders a searchable, grouped catalog with every new local filter", () => {
    const html = renderToStaticMarkup(
      <StudioSmartFiltersPanel stack={undefined} onChange={vi.fn()} />,
    );
    expect(html).toContain('type="search"');
    expect(html).toContain("필터 이름·효과 검색");
    expect(html).toContain("사용 가능한 필터 77개");
    expect(html).toContain("섀도우/하이라이트");
    expect(html).toContain("노출 / 감마 / 오프셋");
    expect(html).toContain("언샤프 마스크");
    expect(html).toContain("팽창 / 침식");
    expect(html).toContain("픽셀 오프셋");
    expect(html).toContain("사용자 컨볼루션");
    expect(html).toContain("구름 텍스처");
    expect(html).toContain("회전 블러");
    expect(html).toContain("줌 블러");
    expect(html).toContain("모자이크 / 픽셀화");
    expect(html).toContain("선화 추출");
    expect(html).toContain("스케치 선화 정리");
    expect(html).toContain("스크린톤 제거");
    expect(html).toContain("JPEG 압축 깨짐 제거");
    expect(html).toContain("윤곽 보존 노이즈 제거");
    expect(html).toContain("컬러 하프톤");
    expect(html).toContain("미디언 잡티 제거");
    expect(html).toContain("표면 보존 블러");
    expect(html).toContain("빛나는 외곽선");
    expect(html).toContain("종이 컷아웃");
    expect(html).toContain("수채화");
    expect(html).toContain("확산 글로우");
    expect(html).toContain("렌즈 블러");
    expect(html).toContain("영역 초점 블러");
    expect(html).toContain("틸트 시프트 블러");
    expect(html).toContain("선택적 가우시안 블러");
    expect(html).toContain("이음매 없는 블러");
    expect(html).toContain("먼지와 스크래치 제거");
    expect(html).toContain("가우시안 차분 선화");
    expect(html).toContain("색상 투명화");
    expect(html).toContain("물결 왜곡");
    expect(html).toContain("스테인드글라스");
    expect(html).toContain("빛줄기");
    expect(html).toContain("극좌표 변환");
  });

  it("keeps the catalog available after more than 100 stack entries", () => {
    const html = renderToStaticMarkup(
      <StudioSmartFiltersPanel
        stack={{
          version: 1,
          entries: Array.from({ length: 101 }, (_, index) => ({
            id: `invert-${index}`,
            engine: "invert" as const,
            enabled: true,
            params: {},
          })),
        }}
        onChange={vi.fn()}
      />,
    );
    expect(html).toContain("101개");
    expect(html).not.toContain("스택이 가득 찼습니다");
    expect(html).toContain("사용 가능한 필터 77개");
  });

  it("renders bounded controls for all advanced blur engines", () => {
    const html = renderToStaticMarkup(
      <StudioSmartFiltersPanel
        stack={{
          version: 1,
          entries: [
            {
              id: "lens-1",
              engine: "lens-blur",
              enabled: true,
              params: { radius: 6, sampleCount: 20, apertureBlades: 7, apertureRotationRadians: 0 },
            },
            {
              id: "iris-1",
              engine: "field-iris-blur",
              enabled: true,
              params: {
                focusCenterX: 0.5,
                focusCenterY: 0.5,
                focusRadius: 0.2,
                feather: 0.3,
                maximumBlurRadius: 8,
                sampleCount: 24,
                apertureBlades: 7,
              },
            },
            {
              id: "tilt-1",
              engine: "tilt-shift-blur",
              enabled: true,
              params: {
                axisRadians: 0,
                focusWidth: 0.25,
                feather: 0.3,
                maximumBlurRadius: 8,
                sampleCount: 24,
              },
            },
            {
              id: "selective-1",
              engine: "selective-gaussian-blur",
              enabled: true,
              params: { radius: 4, spatialSigma: 2.5, edgeThreshold: 28, edgeSoftness: 0.7 },
            },
          ],
        }}
        onChange={vi.fn()}
      />,
    );
    expect(html).toContain("렌즈 블러 끄기");
    // Stack chips read the catalogue title, so the #771 (c9ef0ff7) names match the add-list rows.
    expect(html).toContain("영역 초점 블러 끄기");
    expect(html).toContain("틸트 시프트 블러 끄기");
    expect(html).toContain("선택적 가우시안 블러 끄기");
    expect(html).toContain("조리개 날");
    expect(html).toContain("초점 X");
    expect(html).toContain("초점 폭");
    expect(html).toContain("경계 임계");
    expect(html.match(/type="range"/g)?.length).toBe(20);
  });

  it("renders editable threshold and sharpening controls for line cleanup", () => {
    const html = renderToStaticMarkup(
      <StudioSmartFiltersPanel
        stack={{
          version: 1,
          entries: [{
            id: "line-cleanup-1",
            engine: "line-cleanup",
            enabled: true,
            params: { threshold: 0.6, strength: 0.5 },
          }],
        }}
        onChange={vi.fn()}
      />,
    );
    expect(html).toContain("스케치 선화 정리 끄기");
    expect(html).toContain("이진화 임계");
    expect(html).toContain("선명도");
    expect(html.match(/type="range"/g)?.length).toBe(2);
  });

  it("renders bounded controls and a reproducible seed for composite media filters", () => {
    const html = renderToStaticMarkup(
      <StudioSmartFiltersPanel
        stack={{
          version: 1,
          entries: [{
            id: "watercolor-1",
            engine: "watercolor",
            enabled: true,
            params: { strength: 78, spread: 4, bleed: 62, granulation: 52, paper: 46, seed: 112 },
          }],
        }}
        onChange={vi.fn()}
      />,
    );
    expect(html).toContain("안료 농도");
    expect(html).toContain("가장자리 번짐");
    expect(html).toContain("안료 과립");
    expect(html).toContain("종이 질감");
    expect(html).toContain(">시드</span>");
    expect(html).toContain('max="9999"');
    expect(html.match(/type="range"/g)?.length).toBe(5);
  });

  it("renders bounded controls for all tone and compression cleanup engines", () => {
    const html = renderToStaticMarkup(
      <StudioSmartFiltersPanel
        stack={{
          version: 1,
          entries: [
            {
              id: "tone-remove-1",
              engine: "screentone-removal",
              enabled: true,
              params: { radius: 2, strength: 0.88, inkLumaThreshold: 72 },
            },
            {
              id: "jpeg-clean-1",
              engine: "jpeg-artifact-reduction",
              enabled: true,
              params: {
                deblockStrength: 0.72,
                deringStrength: 0.45,
                boundaryThreshold: 6,
                protectedEdgeThreshold: 88,
                ringingThreshold: 18,
                inkLumaThreshold: 64,
              },
            },
            {
              id: "edge-denoise-1",
              engine: "edge-aware-denoise",
              enabled: true,
              params: { radius: 1, strength: 0.78, rangeThreshold: 72 },
            },
          ],
        }}
        onChange={vi.fn()}
      />,
    );
    expect(html).toContain("스크린톤 제거 끄기");
    expect(html).toContain("JPEG 압축 깨짐 제거 끄기");
    expect(html).toContain("윤곽 보존 노이즈 제거 끄기");
    expect(html).toContain("블록 제거");
    expect(html).toContain("링잉 제거");
    expect(html).toContain("색 경계 보호");
    expect(html.match(/type="range"/g)?.length).toBe(12);
  });

  it("renders editable controls and accessible stack actions for an active entry", () => {
    const html = renderToStaticMarkup(
      <StudioSmartFiltersPanel
        stack={{
          version: 1,
          entries: [{
            id: "unsharp-1",
            engine: "unsharp-mask",
            enabled: true,
            params: { amount: 0.8, radius: 2, threshold: 8 },
          }],
        }}
        onChange={vi.fn()}
      />,
    );
    expect(html).toContain("언샤프 마스크 끄기");
    expect(html).toContain("언샤프 마스크 위로 이동");
    expect(html).toContain("언샤프 마스크 아래로 이동");
    expect(html).toContain("언샤프 마스크 삭제");
    expect(html.match(/type="range"/g)?.length).toBe(3);
    expect(html).toContain("임계값");
    expect(html).toContain("pointer-coarse:min-h-11");
  });

  it("shows preset and 3x3 custom-convolution controls", () => {
    const html = renderToStaticMarkup(
      <StudioSmartFiltersPanel
        stack={{
          version: 1,
          entries: [{
            id: "conv-1",
            engine: "custom-convolution",
            enabled: true,
            params: { k4: 5, divisor: 1, bias: 0 },
          }],
        }}
        onChange={vi.fn()}
      />,
    );
    expect(html).toContain("3 × 3 커널");
    expect(html.match(/type="number"/g)?.length).toBe(9);
    expect(html).toContain(">엠보스</button>");
    expect(html).toContain(">박스 블러</button>");
    expect(html).toContain(">하이패스</button>");
  });

  it("shows distinct radial blur and color-halftone controls", () => {
    const html = renderToStaticMarkup(
      <StudioSmartFiltersPanel
        stack={{
          version: 1,
          entries: [
            {
              id: "spin-1",
              engine: "spin-blur",
              enabled: true,
              params: { radius: 18, strength: 85 },
            },
            {
              id: "halftone-1",
              engine: "color-halftone",
              enabled: true,
              params: { dotSize: 4, angle: 15, mode: "cmyk", strength: 100 },
            },
          ],
        }}
        onChange={vi.fn()}
      />,
    );
    expect(html).toContain("회전 범위");
    expect(html).toContain("색상 모드");
    expect(html).toContain("CMYK 컬러 망점");
    expect(html).toContain("망점 크기");
    expect(html.match(/type="range"/g)?.length).toBe(5);
  });
});
