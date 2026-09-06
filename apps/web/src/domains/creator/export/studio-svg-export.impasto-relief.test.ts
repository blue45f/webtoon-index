import { describe, expect, it } from "vitest";

import { STUDIO_OIL_IMPASTO_RELIEF_OVERLAY_VERSION } from "../brush/studio-oil-ribbon-carrier";

import {
  exportPageToSvg,
  type SvgExportEl,
  type SvgExportPageInput,
} from "./studio-svg-export";

function page(elements: SvgExportEl[]): SvgExportPageInput {
  return { width: 720, height: 1000, bg: "#ffffff", elements };
}

function oilStroke(
  brush: string,
  over: Partial<Extract<SvgExportEl, { type: "draw" }>> = {},
): Extract<SvgExportEl, { type: "draw" }> {
  return {
    id: `impasto-${brush}`,
    type: "draw",
    kind: "freehand",
    brush,
    points: [8, 60, 120, 64, 260, 52, 420, 66],
    pressures: [0.42, 0.78, 0.6, 0.7],
    stroke: "#8b3f31",
    strokeWidth: 24,
    fill: undefined,
    ...over,
  };
}

const OVERLAY_MARKER = `data-brush-engine-overlay="${STUDIO_OIL_IMPASTO_RELIEF_OVERLAY_VERSION}"`;

describe("SVG export — impastoRelief GGX 릴리프 오버레이 직렬화", () => {
  it("임파스토 릴리프 프로그램이 켜진 획은 오버레이 그룹을 직렬화하고 두 톤 계약을 지킨다", () => {
    const { svg } = exportPageToSvg(page([oilStroke("brush--impasto-relief")]));

    expect(svg).toContain('data-brush-engine="oil-ribbon-carrier-v1"');
    expect(svg).toContain(OVERLAY_MARKER);
    // dli 라이트 계약: 글린트=공유 화이트 상수 screen, 코어 섀도우=스트로크 색 multiply.
    const highlights = [...svg.matchAll(
      /<path data-paint-impasto-relief="highlight"[^>]*\/>/gu,
    )].map(([match]) => match);
    const shadows = [...svg.matchAll(
      /<path data-paint-impasto-relief="shadow"[^>]*\/>/gu,
    )].map(([match]) => match);
    expect(highlights.length).toBeGreaterThan(0);
    expect(shadows.length).toBeGreaterThan(0);
    // (kind × 톤 버킷) 양자화 — 레인당 페인트 1회, 최대 3 + 3.
    expect(highlights.length + shadows.length).toBeLessThanOrEqual(6);
    for (const path of highlights) {
      expect(path).toContain('stroke="#ffffff"');
      expect(path).toContain("mix-blend-mode:screen");
      expect(path).toContain('fill="none"');
    }
    for (const path of shadows) {
      expect(path).toContain('stroke="#8b3f31"');
      expect(path).toContain("mix-blend-mode:multiply");
      expect(path).toContain('fill="none"');
    }
    // 결정성: 같은 문서는 같은 바이트로 직렬화된다.
    expect(exportPageToSvg(page([oilStroke("brush--impasto-relief")])).svg).toBe(svg);
  });

  it("프로그램에 핀되지 않은 유화 형제 레인은 오버레이 없이 기존 바이트를 유지한다", () => {
    // oil--impasto-ribbon 은 2026-08-15 에 릴리프 프로그램에 합류해 이 목록에서 빠졌다 —
    // 이름만 임파스토였던 레인이라 릴리프 없이는 oil--filbert-ribbon 과 선언 필드가 동일했다.
    for (const brush of ["oil--filbert-ribbon", "brush--oil-lanes", "brush--bristle-depletion"]) {
      const { svg } = exportPageToSvg(page([oilStroke(brush)]));
      expect(svg, brush).toContain('data-brush-engine="oil-ribbon-carrier-v1"');
      expect(svg, brush).not.toContain(OVERLAY_MARKER);
      expect(svg, brush).not.toContain("data-paint-impasto-relief");
    }
  });

  it("oil--impasto-ribbon 도 같은 릴리프 오버레이를 직렬화한다", () => {
    const { svg } = exportPageToSvg(page([oilStroke("oil--impasto-ribbon")]));
    expect(svg).toContain('data-brush-engine="oil-ribbon-carrier-v1"');
    expect(svg).toContain("data-paint-impasto-relief");
    expect(svg).toContain(OVERLAY_MARKER);
    // 결정성은 brush--impasto-relief 와 동일하게 유지된다.
    expect(exportPageToSvg(page([oilStroke("oil--impasto-ribbon")])).svg).toBe(svg);
  });

  it.each(["oil", "acrylic"])(
    "세 프로그램을 모두 켜는 기본 유화 id(%s)도 릴리프 오버레이를 직렬화한다",
    (brush) => {
    // 2026-08-20 에 매트릭스에 들어온 기본 유화. 내보내기가 매트릭스가 아니라 옛 두-레인 목록을 보면
    // 여기서 오버레이가 빠진다.
    const { svg } = exportPageToSvg(page([oilStroke(brush)]));
    expect(svg, brush).toContain('data-brush-engine="oil-ribbon-carrier-v1"');
    expect(svg, brush).toContain(OVERLAY_MARKER);
    expect(svg, brush).toContain("data-paint-impasto-relief");
    },
  );

  it("오버레이 마크는 다른 재료 mark처럼 획 투명도를 곱해 받는다", () => {
    const opacityOf = (svg: string): number[] => [...svg.matchAll(
      /<path data-paint-impasto-relief="[a-z]+"[^>]* opacity="([0-9.]+)"/gu,
    )].map(([, value]) => Number(value));
    const full = opacityOf(
      exportPageToSvg(page([{ ...oilStroke("brush--impasto-relief"), opacity: 1 }])).svg,
    );
    const half = opacityOf(
      exportPageToSvg(page([{ ...oilStroke("brush--impasto-relief"), opacity: 0.5 }])).svg,
    );
    expect(full.length).toBeGreaterThan(0);
    expect(half.length).toBe(full.length);
    half.forEach((value, index) => {
      expect(Math.abs(value - full[index]! * 0.5)).toBeLessThanOrEqual(0.000001);
    });
  });
});
