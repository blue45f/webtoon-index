import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  normalizeStudioBrushDynamicsSettings,
  resolveStudioBrushDynamicsPresetId,
  STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V2,
  STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3,
  studioBrushDynamicsPresetSettings,
  studioBrushDynamicsSeedFromKey,
  studioBrushDynamicsSettingsForBrushId,
  studioDryMediaUnionComposableProgramPin,
  type StudioDynamicBrushDab,
  type StudioBrushDynamicsPresetId,
} from "../brush/studio-brush-dynamics";
import { resolveStudioStrokeSymmetry } from "../brush/studio-brush-intrinsic-symmetry";
import {
  planStudioDynamicBrushRenderBudget,
  STUDIO_DYNAMIC_BRUSH_CAUSAL_CONTINUATION_MARK_BUDGET,
  STUDIO_DYNAMIC_BRUSH_CAUSAL_MARK_BUDGET,
} from "../brush/studio-brush-render-budget";
import {
  rasterizeStudioBrushSoftFalloffMaskRgba,
  STUDIO_BRUSH_SOFT_FALLOFF_LINEAR_ACCUMULATION_TONE,
  STUDIO_BRUSH_SOFT_FALLOFF_STAMP_RESOLUTION,
  type StudioBrushSoftFalloffStampTone,
} from "../brush/studio-brush-soft-falloff-stamp";
import { studioDynamicBrushDabVariations } from "../brush/studio-brush-symmetry";
import {
  encodeStudioBrushTipAlphaMapBase64,
  studioBrushTipAlphaMapToBase64,
} from "../brush/studio-brush-tip-stamp";
import { STUDIO_WET_RIBBON_OPACITY_BUCKET_COUNT } from "../brush/studio-wet-ribbon-carrier";
import { bubblePathData, doubleBubblePathData } from "../lettering/studio-bubble-path";
import { parsePngChunks } from "../studio-apng-encoder";
import { screentoneDotsForStroke } from "../studio-brush";
import {
  planStudioCausalDynamicBrushDepositSegmentsV3,
  planStudioCausalDynamicBrushDepositsV2,
  STUDIO_CAUSAL_DYNAMIC_BRUSH_MAX_DABS,
} from "../studio-causal-dynamic-brush-deposit-v2";
import {
  planStudioDynamicBrushCoverageAndLegacyMarks,
  type StudioDynamicBrushCoverageMark,
} from "../studio-dynamic-brush-coverage-renderer";
import { planStudioDynamicBrushRender } from "../studio-dynamic-brush-render-plan";
import {
  planGlowBrushPasses,
  planNeonBrushPasses,
  studioLuminousCoreColor,
} from "../studio-fx-brush";
import { STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1 } from "../studio-material-pressure-model";
import {
  captureStudioOutlineStrokeContractV1,
  planStudioPerfectFreehandRender,
} from "../studio-outline-stroke-contract";
import { peekStudioPerfectFreehandStroker } from "../studio-perfect-freehand";
import {
  planStudioPixelPencilCells,
  STUDIO_PIXEL_PENCIL_RENDER_MODE,
} from "../studio-pixel-pencil";
import { buildStudioRoughSvgParityPlan } from "../studio-rough-svg-parity";
import {
  planStudioWebDrawingKitOwnedDabs,
  STUDIO_WEB_DRAWING_KIT_OWNED_BRUSH_IDS,
} from "../studio-web-drawing-stroke-bridge";

import {
  SVG_EXPORT_MIME,
  escapeXml,
  exportPageToSvg,
  svgExportFileName,
  svgExportResultMessage,
  type SvgExportEl,
  type SvgExportPageInput,
  type SvgExportResult,
} from "./studio-svg-export";


import type { StudioDynamicBrushMaterialIdentity } from "../brush/studio-dry-media-dynamic-bridge";
import type { DrawEl, El } from "../studio-element-model";

// ---------------------------------------------------------------------------
// 헬퍼 — 페이지 입력/요소 빌더
// ---------------------------------------------------------------------------

function page(elements: SvgExportEl[], over: Partial<SvgExportPageInput> = {}): SvgExportPageInput {
  return { width: 720, height: 1000, bg: "#ffffff", elements, ...over };
}

function rectEl(over: Partial<Extract<SvgExportEl, { type: "draw" }>> = {}): Extract<SvgExportEl, { type: "draw" }> {
  return {
    id: "d1",
    type: "draw",
    kind: "rect",
    points: [10, 20, 110, 80],
    stroke: "#111111",
    strokeWidth: 2,
    fill: "#ff0000",
    ...over,
  };
}

/** Legacy solid-ellipse dab path — isolates affine/opacity geometry from textured tip stamps. */
function ellipseDynamics(preset: StudioBrushDynamicsPresetId) {
  return normalizeStudioBrushDynamicsSettings({
    ...studioBrushDynamicsPresetSettings(preset),
    tip: { shape: "round", softness: 0.35 },
    // Material presets may carry production grain. These geometry/opacity tests intentionally
    // exercise the solid-ellipse route, so make that fixture contract explicit.
    grain: { amount: 0 },
  });
}

interface DynamicEllipseAttributes {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  angle: number;
}

/** 동적 브러시 variation마다 생성되는 `<g>`에서 타원 지오메트리만 수치로 읽는다. */
function dynamicEllipseGroups(svg: string): DynamicEllipseAttributes[][] {
  return Array.from(svg.matchAll(/<g>(.*?)<\/g>/g), (groupMatch) =>
    Array.from(
      groupMatch[1]!.matchAll(
        /<ellipse data-brush-coverage="ellipse" cx="([^"]+)" cy="([^"]+)" rx="([^"]+)" ry="([^"]+)"[^>]*transform="rotate\(([^ ]+) [^)]+\)"\/>/g
      ),
      (ellipseMatch) => ({
        cx: Number(ellipseMatch[1]),
        cy: Number(ellipseMatch[2]),
        rx: Number(ellipseMatch[3]),
        ry: Number(ellipseMatch[4]),
        angle: Number(ellipseMatch[5]),
      })
    )
  ).filter((group) => group.length > 0);
}

function expectNear(actual: number, expected: number, tolerance = 0.02) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

function referenceCoverageNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 1_000_000) / 1_000_000 + 0;
  return rounded.toFixed(6).replace(/\.?0+$/u, "");
}

function referenceDabOpacity(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const bounded = Math.min(1, Math.max(0, value));
  const rounded = Math.round(bounded * 1_000_000) / 1_000_000;
  const visible = bounded > 0 && rounded === 0 ? 0.000001 : rounded;
  return visible.toFixed(6).replace(/\.?0+$/u, "");
}

/** 프로덕션과 같은 공식 — 재질 주석은 pastel 계열만 carrier를 더하고 brushId를 그대로 싣는다. */
function referenceMaterialAttributes(
  materialIdentity?: StudioDynamicBrushMaterialIdentity,
): string {
  if (!materialIdentity) return "";
  return (
    (materialIdentity.dryMediaPresetId === "pastel"
      ? ` data-brush-carrier="soft-pigment-fiber"`
      : "")
    + ` data-brush-material="${escapeXml(materialIdentity.brushId)}"`
  );
}

function appendReferenceEllipseCoverage(
  hash: ReturnType<typeof createHash>,
  mark: StudioDynamicBrushCoverageMark,
  materialIdentity?: StudioDynamicBrushMaterialIdentity,
): void {
  const angleDegrees = mark.angleRadians * 180 / Math.PI;
  const transform =
    `rotate(${referenceCoverageNumber(angleDegrees)}`
    + ` ${referenceCoverageNumber(mark.x)}`
    + ` ${referenceCoverageNumber(mark.y)})`;
  hash.update(
    `<ellipse data-brush-coverage="ellipse"`
      + ` cx="${referenceCoverageNumber(mark.x)}"`
      + ` cy="${referenceCoverageNumber(mark.y)}"`
      + ` rx="${referenceCoverageNumber(mark.radiusX)}"`
      + ` ry="${referenceCoverageNumber(mark.radiusY)}"`
      + referenceMaterialAttributes(materialIdentity)
      + ` fill="${escapeXml(mark.color)}"`
      + ` opacity="${referenceDabOpacity(mark.alpha)}"`
      + ` transform="${transform}"/>`,
  );
}

function axisVector(angle: number): { x: number; y: number } {
  const radians = angle * Math.PI / 180;
  return { x: Math.cos(radians), y: Math.sin(radians) };
}

function angledNibExportPolygons(svg: string): number[][] {
  const pathData = /<path d="([^"]+)"[^>]*data-brush-engine="angled-nib-local-coverage"/u
    .exec(svg)?.[1];
  if (!pathData) return [];
  return Array.from(pathData.matchAll(/M (.*?) Z/gu), (subpathMatch) =>
    subpathMatch[1]!
      .replaceAll("L ", "")
      .trim()
      .split(/\s+/u)
      .map(Number)
  );
}

function polygonSignedArea(points: readonly number[]): number {
  let twiceArea = 0;
  for (let coordinateIndex = 0; coordinateIndex < points.length; coordinateIndex += 2) {
    const nextCoordinateIndex = (coordinateIndex + 2) % points.length;
    twiceArea +=
      points[coordinateIndex]!
      * points[nextCoordinateIndex + 1]!
      - points[nextCoordinateIndex]!
      * points[coordinateIndex + 1]!;
  }
  return twiceArea / 2;
}

function polygonWindingAt(
  polygons: readonly (readonly number[])[],
  x: number,
  y: number,
): number {
  let winding = 0;
  for (const polygon of polygons) {
    for (let coordinateIndex = 0; coordinateIndex < polygon.length; coordinateIndex += 2) {
      const nextCoordinateIndex = (coordinateIndex + 2) % polygon.length;
      const startX = polygon[coordinateIndex]!;
      const startY = polygon[coordinateIndex + 1]!;
      const endX = polygon[nextCoordinateIndex]!;
      const endY = polygon[nextCoordinateIndex + 1]!;
      const side =
        (endX - startX) * (y - startY)
        - (x - startX) * (endY - startY);
      if (startY <= y) {
        if (endY > y && side > 0) winding += 1;
      } else if (endY <= y && side < 0) {
        winding -= 1;
      }
    }
  }
  return winding;
}

function decodeEmbeddedRgbaPng(
  dataUrl: string,
): Readonly<{ width: number; height: number; pixels: Uint8Array }> {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/u.exec(dataUrl);
  if (!match) throw new Error("expected embedded PNG");
  const binary = globalThis.atob(match[1]!);
  const png = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const chunks = parsePngChunks(png);
  const header = chunks.find((chunk) => chunk.type === "IHDR")?.data;
  if (!header || header.byteLength !== 13) throw new Error("missing IHDR");
  const headerView = new DataView(
    header.buffer,
    header.byteOffset,
    header.byteLength,
  );
  const width = headerView.getUint32(0, false);
  const height = headerView.getUint32(4, false);
  const imageDataChunks = chunks
    .filter((chunk) => chunk.type === "IDAT")
    .map((chunk) => chunk.data);
  const compressed = new Uint8Array(
    imageDataChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0),
  );
  let compressedOffset = 0;
  for (const chunk of imageDataChunks) {
    compressed.set(chunk, compressedOffset);
    compressedOffset += chunk.byteLength;
  }
  const scanlines = new Uint8Array(inflateSync(compressed));
  const stride = width * 4 + 1;
  if (scanlines.byteLength !== stride * height) {
    throw new Error("unexpected PNG scanline length");
  }
  const pixels = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const scanlineOffset = row * stride;
    if (scanlines[scanlineOffset] !== 0) {
      throw new Error("unexpected PNG filter");
    }
    pixels.set(
      scanlines.subarray(scanlineOffset + 1, scanlineOffset + stride),
      row * width * 4,
    );
  }
  return { width, height, pixels };
}

interface DynamicCoverageUse {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly opacity: number;
  readonly color: string;
  readonly angle: number;
  readonly centerX: number;
  readonly centerY: number;
}

function svgAttribute(tag: string, name: string): string {
  const value = new RegExp(`\\b${name}="([^"]+)"`, "u").exec(tag)?.[1];
  if (value === undefined) throw new Error(`missing SVG attribute: ${name}`);
  return value;
}

function dynamicCoverageUses(svg: string): DynamicCoverageUse[] {
  return Array.from(
    svg.matchAll(/<use data-brush-coverage="alpha-map"[^>]*\/>/gu),
    (match) => {
      const tag = match[0];
      const transform = /^rotate\(([^ ]+) ([^ ]+) ([^)]+)\)$/u.exec(
        svgAttribute(tag, "transform"),
      );
      if (!transform) throw new Error("invalid dynamic coverage transform");
      return {
        x: Number(svgAttribute(tag, "x")),
        y: Number(svgAttribute(tag, "y")),
        width: Number(svgAttribute(tag, "width")),
        height: Number(svgAttribute(tag, "height")),
        opacity: Number(svgAttribute(tag, "opacity")),
        color: svgAttribute(tag, "color"),
        angle: Number(transform[1]),
        centerX: Number(transform[2]),
        centerY: Number(transform[3]),
      };
    },
  );
}

function optionalSvgAttribute(tag: string, name: string): string | null {
  return new RegExp(`\\b${name}="([^"]+)"`, "u").exec(tag)?.[1] ?? null;
}

interface DynamicCoverageEllipse {
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
  readonly angle: number;
  readonly opacity: number;
  readonly fill: string;
  readonly material: string | null;
  readonly carrier: string | null;
}

/**
 * 변주별 `<g>`에서 솔리드 타원 커버리지의 지오메트리와 재질 주석을 전부 읽는다.
 * `dynamicEllipseGroups`와 달리 순수 coverage 타원으로만 구성된 그룹만 받아
 * 파티션 경계(변주 순서)까지 함께 검증할 수 있다.
 */
function dynamicMaterialEllipseGroups(svg: string): DynamicCoverageEllipse[][] {
  return Array.from(
    svg.matchAll(
      /<g(?: opacity="[^"]+")?>((?:<ellipse data-brush-coverage="ellipse"[^>]*\/>)+)<\/g>/gu,
    ),
    (groupMatch) => Array.from(
      groupMatch[1]!.matchAll(/<ellipse data-brush-coverage="ellipse"[^>]*\/>/gu),
      (ellipseMatch) => {
        const tag = ellipseMatch[0];
        const transform = /^rotate\(([^ ]+) [^)]+\)$/u.exec(
          svgAttribute(tag, "transform"),
        );
        if (!transform) throw new Error("invalid dynamic coverage transform");
        return {
          cx: Number(svgAttribute(tag, "cx")),
          cy: Number(svgAttribute(tag, "cy")),
          rx: Number(svgAttribute(tag, "rx")),
          ry: Number(svgAttribute(tag, "ry")),
          angle: Number(transform[1]),
          opacity: Number(svgAttribute(tag, "opacity")),
          fill: svgAttribute(tag, "fill"),
          material: optionalSvgAttribute(tag, "data-brush-material"),
          carrier: optionalSvgAttribute(tag, "data-brush-carrier"),
        };
      },
    ),
  );
}

type SvgDrawTestEl = Extract<SvgExportEl, { type: "draw" }>;

function canvasCoverageMarksForSvgFixture(
  el: SvgDrawTestEl,
): readonly StudioDynamicBrushCoverageMark[] {
  const dynamicBrushId = resolveStudioBrushDynamicsPresetId(el.brush);
  if (!dynamicBrushId) throw new Error("fixture is not a dynamic brush");
  const retainedPlan = planStudioDynamicBrushRender(
    el as DrawEl,
    dynamicBrushId,
    false,
  );
  if (retainedPlan.status !== "ready") {
    throw new Error(`retained fixture rejected: ${retainedPlan.reason}`);
  }
  const coverage = planStudioDynamicBrushCoverageAndLegacyMarks({
    dabVariations: retainedPlan.plan.dabVariations,
    dynamics: retainedPlan.plan.dynamics,
    materialIdentity: retainedPlan.plan.materialIdentity,
    dynamicSeed: retainedPlan.plan.seed,
    stroke: el.stroke,
    stampGrid: retainedPlan.plan.renderBudget.stampGrid,
    markBudget: retainedPlan.plan.markBudget,
    // 종이 결은 렌더 플랜이 도구 물성 + 문서 종이에서 확정한다. SVG도 같은 입력을 받으므로
    // 이 Canvas 기준선 역시 StudioDrawNode와 똑같이 그대로 전달해야 두 경로가 비교 가능하다.
    ...(retainedPlan.plan.paper ? { paper: retainedPlan.plan.paper } : {}),
  }).coveragePlan;
  if (!coverage.ok) {
    throw new Error(`coverage fixture rejected: ${coverage.reason}`);
  }
  return coverage.marks;
}

function textEl(over: Partial<Extract<SvgExportEl, { type: "text" }>> = {}): Extract<SvgExportEl, { type: "text" }> {
  return {
    id: "t1",
    type: "text",
    text: "안녕\n웹툰",
    x: 10,
    y: 20,
    width: 200,
    fontSize: 20,
    fill: "#222222",
    rotation: 0,
    align: "center",
    letterSpacing: 1,
    lineHeight: 1.2,
    ...over,
  };
}

function bubbleEl(over: Partial<Extract<SvgExportEl, { type: "bubble" }>> = {}): Extract<SvgExportEl, { type: "bubble" }> {
  return {
    id: "b1",
    type: "bubble",
    variant: "speech",
    text: "야!",
    x: 5,
    y: 6,
    width: 200,
    height: 120,
    fill: "#ffffff",
    textFill: "#111111",
    rotation: 0,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// El 유니온 호환 — StudioPage 요소 배열을 구조 그대로 받는다(컴파일 타임 검증).
// ---------------------------------------------------------------------------

describe("El 유니온 구조 호환", () => {
  it("StudioPage El이 SvgExportEl로 그대로 대입된다(tsc 게이트)", () => {
    const acceptEl = (el: El): SvgExportEl => el;
    expect(typeof acceptEl).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// 문서 골격 — 루트/배경/숨김/결정성
// ---------------------------------------------------------------------------

describe("exportPageToSvg 문서 골격", () => {
  it("루트 svg에 xmlns·크기·viewBox가 결정적으로 들어간다", () => {
    const { svg } = exportPageToSvg(page([]));
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1000" viewBox="0 0 720 1000">')).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
  });

  it("배경 단색 rect를 캔버스 bg와 동일하게 깐다", () => {
    const { svg } = exportPageToSvg(page([], { bg: "#fef3c7" }));
    expect(svg).toContain('<rect width="720" height="1000" fill="#fef3c7"/>');
  });

  it("bgGrad가 있으면 세로 2색 그라데이션 defs로 배경을 칠한다", () => {
    const { svg } = exportPageToSvg(page([], { bgGrad: ["#000000", "#ffffff"] }));
    expect(svg).toContain('x1="0" y1="0" x2="0" y2="1000"');
    expect(svg).toContain('<stop offset="0%" stop-color="#000000"/>');
    expect(svg).toContain('<stop offset="100%" stop-color="#ffffff"/>');
    expect(svg).toMatch(/<rect width="720" height="1000" fill="url\(#sg\d+\)"\/>/);
  });

  it("transparentBg면 배경을 그리지 않는다", () => {
    const { svg } = exportPageToSvg(page([], { transparentBg: true, bg: "#ffffff" }));
    expect(svg).not.toContain('fill="#ffffff"');
  });

  it("숨긴 요소·숨긴 그룹 소속 요소는 제외되고 elementCount에도 빠진다", () => {
    const result = exportPageToSvg(
      page(
        [
          rectEl({ id: "d1", hidden: true }),
          rectEl({ id: "d2", groupId: "g1" }),
          rectEl({ id: "d3", points: [200, 20, 300, 80] }),
        ],
        { groups: [{ id: "g1", name: "숨김 그룹", hidden: true }] }
      )
    );
    expect(result.elementCount).toBe(1);
    expect((result.svg.match(/<rect /g) ?? []).length).toBe(2); // 배경 + d3 하나
  });

  it("같은 입력이면 출력 바이트가 동일하다(결정성)", () => {
    const input = page([
      rectEl(),
      textEl(),
      bubbleEl(),
      { id: "fl1", type: "focusLines", x: 0, y: 0, width: 720, height: 400, lineCount: 12, innerRadius: 60, outerRadius: 300, stroke: "#000000", strokeWidth: 2, noise: 10, rotation: 0 },
    ]);
    expect(exportPageToSvg(input).svg).toBe(exportPageToSvg(input).svg);
  });
});

// ---------------------------------------------------------------------------
// 도형(draw) — 사각/타원/별/다각형/선/화살표/자유곡선
// ---------------------------------------------------------------------------

describe("도형 직렬화", () => {
  it("사각형 — 위치·크기·모서리 반경·선 스타일을 그대로 담는다", () => {
    const { svg } = exportPageToSvg(page([rectEl()]));
    expect(svg).toContain(
      '<rect x="10" y="20" width="100" height="60" rx="3" fill="#ff0000" stroke="#111111" stroke-width="2" stroke-linejoin="round"/>'
    );
  });

  it("점선 프리셋은 선 굵기에 비례한 stroke-dasharray로 나온다", () => {
    const { svg } = exportPageToSvg(page([rectEl({ strokeStyle: { dash: "dash", lineCap: "round", arrowStart: "none", arrowEnd: "none" } })]));
    expect(svg).toContain('stroke-dasharray="6 4"');
  });

  it("타원 — 중심·반지름을 캔버스와 동일하게 계산한다", () => {
    const { svg } = exportPageToSvg(page([rectEl({ kind: "ellipse" })]));
    expect(svg).toContain('<ellipse cx="60" cy="50" rx="50" ry="30"');
  });

  it("별/다각형 — studio-stroke-shapes 포인트 지오메트리를 재사용한다", () => {
    const star = rectEl({ id: "s1", kind: "star", points: [0, 0, 100, 100] });
    const poly = rectEl({ id: "p1", kind: "polygon", points: [0, 0, 100, 100], shapeParams: { starPoints: 5, starInnerRatio: 0.5, polygonSides: 6, cornerRadius: 3 } });
    const { svg } = exportPageToSvg(page([star, poly]));
    // 별 첫 꼭짓점 = 12시 방향(중심 50,50 · 외접 반경 50 → "50,0")
    expect(svg).toContain('<polygon points="50,0');
    // 육각형 = 12개 좌표(x,y 6쌍)
    const polygons = svg.match(/<polygon points="([^"]+)"/g) ?? [];
    expect(polygons.length).toBe(2);
    expect((polygons[1]?.match(/,/g) ?? []).length).toBe(6);
  });

  it("비정사각 triangle/polygon도 캔버스와 동일하게 bbox 네 경계를 채운다", () => {
    const triangle = rectEl({ id: "tall-triangle", kind: "triangle", points: [10, 20, 310, 110] });
    const polygon = rectEl({
      id: "wide-polygon",
      kind: "polygon",
      points: [30, 160, 150, 460],
      shapeParams: { starPoints: 5, starInnerRatio: 0.5, polygonSides: 5, cornerRadius: 3 },
    });
    const { svg } = exportPageToSvg(page([triangle, polygon]));
    const pointSets = Array.from(svg.matchAll(/<polygon points="([^"]+)"/g), (match) =>
      match[1]!.split(" ").map((pair) => pair.split(",").map(Number) as [number, number])
    );
    const bounds = (points: readonly [number, number][]) => {
      const xs = points.map(([x]) => x);
      const ys = points.map(([, y]) => y);
      return {
        left: Math.min(...xs),
        top: Math.min(...ys),
        right: Math.max(...xs),
        bottom: Math.max(...ys),
      };
    };

    expect(pointSets).toHaveLength(2);
    expect(bounds(pointSets[0]!)).toEqual({ left: 10, top: 20, right: 310, bottom: 110 });
    expect(bounds(pointSets[1]!)).toEqual({ left: 30, top: 160, right: 150, bottom: 460 });
  });

  it("Rough 도형은 Canvas와 동일 seed·geometry plan을 path 역할 순서 그대로 내보낸다", () => {
    const sketch = {
      enabled: true,
      roughness: 2.1,
      bowing: 2.5,
      fillStyle: "cross-hatch" as const,
    };
    const shape = rectEl({
      id: "rough-svg-rect",
      kind: "rect",
      points: [12, 18, 172, 118],
      stroke: "#123456",
      strokeWidth: 6,
      fill: "#fedcba",
      opacity: 0.73,
      strokeStyle: {
        dash: "dash",
        lineCap: "square",
        arrowStart: "none",
        arrowEnd: "none",
      },
      sketch,
    });
    const expected = buildStudioRoughSvgParityPlan({
      elementId: shape.id,
      variationIndex: 0,
      kind: "rect",
      points: shape.points,
      strokeWidth: shape.strokeWidth,
      hasFill: true,
      shapeParams: {
        starPoints: 5,
        starInnerRatio: 0.5,
        polygonSides: 6,
        cornerRadius: 3,
      },
      style: sketch,
    });
    const { svg, skipped } = exportPageToSvg(page([shape]));
    const group = /<g data-studio-rough-shape="v1" data-rough-seed="([^"]+)" opacity="0.73">(.*?)<\/g>/u
      .exec(svg);
    const serializedPaths = Array.from(
      group?.[2]?.matchAll(
        /<path d="([^"]+)" data-rough-role="([^"]+)"/gu,
      ) ?? [],
      (match) => ({ data: match[1], role: match[2] }),
    );

    expect(Number(group?.[1])).toBe(expected.seed);
    expect(serializedPaths).toEqual(
      expected.paths.map((path) => ({ data: path.data, role: path.role })),
    );
    expect(svg).not.toContain('<rect x="12" y="18"');
    expect(svg).toContain('stroke="#123456"');
    expect(svg).toContain('stroke="#fedcba"');
    expect(svg).toContain('stroke-dasharray="18 12"');
    expect(svg).toContain('stroke-linecap="square"');
    expect(skipped).toEqual([]);
  });

  it("Rough 대칭 복제본은 Canvas처럼 variation마다 id seed+index를 사용한다", () => {
    const shape = rectEl({
      id: "rough-svg-symmetry",
      kind: "ellipse",
      points: [20, 30, 100, 90],
      fill: undefined,
      sketch: {
        enabled: true,
        roughness: 1.8,
        bowing: 1.5,
        fillStyle: "hachure",
      },
      symmetry: {
        type: "vertical",
        centerX: 120,
        centerY: 0,
      },
    });
    const { svg } = exportPageToSvg(page([shape]));
    const seeds = Array.from(
      svg.matchAll(/data-studio-rough-shape="v1" data-rough-seed="([^"]+)"/gu),
      (match) => Number(match[1]),
    );

    expect(seeds).toHaveLength(2);
    expect(seeds[1]).toBe(seeds[0]! + 1);
    expect((svg.match(/data-rough-role="outline"/gu) ?? []).length)
      .toBeGreaterThanOrEqual(2);
    expect(svg).not.toContain("<ellipse ");
  });

  it("선 — 화살촉(삼각형)을 stroke 색으로 채워 함께 그린다", () => {
    const line = rectEl({
      id: "l1",
      kind: "line",
      points: [0, 0, 100, 0],
      stroke: "#333333",
      strokeWidth: 4,
      strokeStyle: { dash: "solid", lineCap: "round", arrowStart: "none", arrowEnd: "arrow" },
    });
    const { svg } = exportPageToSvg(page([line]));
    expect(svg).toContain('<path d="M 0 0 L 100 0" fill="none" stroke="#333333" stroke-width="4" stroke-linecap="round"');
    expect(svg).toContain('d="M 100 0 L 90.99 4.34 L 90.99 -4.34 Z" fill="#333333"');
  });

  it("화살표(arrow) — 몸통 + 끝점 삼각 화살촉(굵기 비례)을 그린다", () => {
    const arrow = rectEl({ id: "a1", kind: "arrow", points: [0, 0, 100, 0], stroke: "#123456", strokeWidth: 4 });
    const { svg } = exportPageToSvg(page([arrow]));
    expect(svg).toContain('<path d="M 0 0 L 100 0" fill="none" stroke="#123456"');
    expect(svg).toContain('<path d="M 100 0 L 92 4 L 92 -4 Z" fill="#123456"');
  });

  it("자유곡선(펜) — Konva tension 곡선(Q/C 커맨드)으로 매끈하게 나온다", () => {
    const pen = rectEl({ id: "f1", kind: "freehand", points: [0, 0, 10, 0, 20, 10, 30, 30], strokeWidth: 3 });
    const { svg } = exportPageToSvg(page([pen]));
    const d = /<path d="(M 0 0 Q [^"]+)"/.exec(svg)?.[1];
    expect(d).toBeTruthy();
    expect(d).toContain(" C ");
    expect(svg).toContain('stroke-linecap="round"');
  });

  it("픽셀 펜 — 정수 1px 셀과 crispEdges를 보존하고 중복 셀을 합친다", () => {
    const pixel = rectEl({
      id: "pixel-1",
      kind: "freehand",
      mode: "pen",
      brush: STUDIO_PIXEL_PENCIL_RENDER_MODE,
      points: [0.8, 2.2, 3.9, 2.7, 1.1, 2.1],
      stroke: "#123456",
      strokeWidth: 1,
      fill: undefined,
      opacity: 0.7,
      pressures: [1, 1, 1],
    });

    const { svg, skipped } = exportPageToSvg(page([pixel]));

    expect(skipped).toEqual([]);
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg).toContain('fill="#123456"');
    expect(svg).toContain('opacity="0.7"');
    expect(svg).toContain('d="M0 2h1v1h-1ZM1 2h1v1h-1ZM2 2h1v1h-1ZM3 2h1v1h-1Z"');
    expect(svg).not.toContain("<circle");
  });

  it("픽셀 펜 — 넓은 촉의 Canvas 셀 합집합을 SVG에서도 그대로 보존한다", () => {
    const points = [2.2, 4.1, 6.3, 4.2];
    const strokeWidth = 3;
    const pixel = rectEl({
      id: "pixel-wide",
      kind: "freehand",
      mode: "pen",
      brush: STUDIO_PIXEL_PENCIL_RENDER_MODE,
      points,
      stroke: "#654321",
      strokeWidth,
      fill: undefined,
      opacity: 1,
      pressures: [1, 1],
    });
    const expectedPlan = planStudioPixelPencilCells({ points, strokeWidth });
    const expectedPath = expectedPlan.cells
      .map((cell) => `M${cell.x} ${cell.y}h1v1h-1Z`)
      .join("");

    const { svg, skipped } = exportPageToSvg(page([pixel]));

    expect(expectedPlan.complete).toBe(true);
    expect(expectedPlan.cells.length).toBeGreaterThan(5);
    expect(skipped).toEqual([]);
    expect(svg).toContain(`d="${expectedPath}"`);
    expect(svg).toContain('fill="#654321"');
    expect(svg).toContain('shape-rendering="crispEdges"');
  });

  it("한 점 탭 — 필압 굵기의 원으로 보존한다", () => {
    const dot = rectEl({
      id: "dot-1",
      kind: "freehand",
      points: [12, 34],
      pressures: [0.75],
      stroke: "#123456",
      strokeWidth: 10,
    });
    const { svg, skipped } = exportPageToSvg(page([dot]));
    expect(svg).toContain('<circle cx="12" cy="34"');
    expect(svg).toContain('fill="#123456"');
    expect(svg).toContain('r="6.75"');
    expect(skipped).toEqual([]);
  });

  it("같은 크기에서도 펜·파인라이너·마커 별칭의 실제 탭 지름이 구분된다", () => {
    const renderTap = (brush: "pen" | "fineliner" | "marker") =>
      exportPageToSvg(page([rectEl({
        id: `alias-tap-${brush}`,
        kind: "freehand",
        brush,
        points: [12, 34],
        pressures: [0.5],
        stroke: "#123456",
        strokeWidth: 10,
        fill: undefined,
      })])).svg;
    const radius = (svg: string) => Number(/<circle[^>]* r="([^"]+)"/.exec(svg)?.[1]);

    const penRadius = radius(renderTap("pen"));
    const finelinerRadius = radius(renderTap("fineliner"));
    const markerRadius = radius(renderTap("marker"));

    expect(finelinerRadius).toBeLessThan(penRadius);
    expect(markerRadius).toBeGreaterThan(penRadius);
  });

  it("소프트 연필은 코어 하나인 연필과 달리 부드러운 하부 패스를 함께 내보낸다", () => {
    const render = (brush: "pencil" | "soft-pencil") => exportPageToSvg(page([rectEl({
      id: `alias-pencil-${brush}`,
      kind: "freehand",
      brush,
      points: [0, 0, 10, 10, 20, 4],
      stroke: "#30241d",
      strokeWidth: 8,
      fill: undefined,
      sampleSpacing: 1,
    })])).svg;

    const pencil = render("pencil");
    const softPencil = render("soft-pencil");
    expect(pencil.match(/data-pencil-pass=/g)).toHaveLength(1);
    // soft-edge 는 껍질 여러 장으로 나간다 — 캔버스와 같은 패스 목록을 쓰므로 두 표면이 같다.
    expect((softPencil.match(/data-pencil-pass=/g) ?? []).length).toBeGreaterThan(2);
    expect((softPencil.match(/data-pencil-pass="soft-edge"/g) ?? []).length)
      .toBeGreaterThan(1);
    expect((softPencil.match(/data-pencil-pass="core"/g) ?? []).length).toBe(1);
    expect(softPencil).toContain('data-pencil-pass="soft-edge"');
    expect(softPencil).toContain('data-pencil-pass="core"');
    expect(softPencil).not.toBe(pencil);
  });

  it("retained 연필은 명시적 재질 모델만 필압을 적용하고 legacy 외형은 고정한다", () => {
    const render = (pressure: number, pressureModel = true) => exportPageToSvg(page([rectEl({
      id: `pressure-pencil-${pressure}`,
      kind: "freehand",
      brush: "pencil-2b",
      points: [0, 0, 12, 4, 24, 0],
      pressures: [pressure, pressure, pressure],
      ...(pressureModel
        ? {
            materialPressureModel:
              STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
          }
        : {}),
      stroke: "#30241d",
      strokeWidth: 10,
      fill: undefined,
      sampleSpacing: 1,
    })])).svg;
    const maximumAttribute = (svg: string, attribute: string) => Math.max(
      ...Array.from(
        svg.matchAll(new RegExp(`${attribute}="([^"]+)"`, "g")),
        (match) => Number(match[1]),
      ).filter(Number.isFinite),
    );
    const light = render(0);
    const heavy = render(1);
    const legacyLight = render(0, false);
    const legacyHeavy = render(1, false);

    expect(maximumAttribute(heavy, "stroke-width")).toBeGreaterThan(
      maximumAttribute(light, "stroke-width"),
    );
    expect(maximumAttribute(heavy, "opacity")).toBeGreaterThan(
      maximumAttribute(light, "opacity"),
    );
    expect(light).toContain('data-pencil-pass="core"');
    expect(heavy).toContain('data-pencil-pass="core"');
    expect(legacyLight).toBe(legacyHeavy);
  });

  it("새 기본 펜 — 라이브/WebGPU와 같은 causal round-dab 시퀀스로 보존한다", () => {
    const pen = rectEl({
      id: "causal-pen-svg",
      kind: "freehand",
      points: [0, 0, 8, 0, 16, 8],
      pressures: [0.25, 0.5, 1],
      sampleSpacing: 1.5,
      stroke: "#123456",
      strokeWidth: 10,
      fill: undefined,
    });
    const { svg, skipped } = exportPageToSvg(page([pen]));
    const circles = svg.match(/<circle /g) ?? [];

    expect(circles.length).toBeGreaterThan(3);
    expect(svg).toContain('<circle cx="0" cy="0" r="3.25" fill="#123456"');
    expect(svg).toContain('<circle cx="16" cy="8" r="8.5" fill="#123456"');
    expect(svg).not.toContain('<path d="M 0 0 Q');
    expect(skipped).toEqual([]);
  });

  it("layered-flow-v1 마커는 알파 색상 dab을 단일 compound path로 한 번만 합성한다", () => {
    const marker = rectEl({
      id: "layered-marker-svg",
      kind: "freehand",
      points: [0, 0, 8, 0, 16, 0],
      pressures: [1, 1, 1],
      pressureModel: "linear-residual-path-v3",
      paintModel: "layered-flow-v1",
      sampleSpacing: 0,
      stroke: "rgba(171, 51, 68, 0.4)",
      strokeWidth: 16,
      opacity: 0.6,
      brush: "marker",
      fill: undefined,
    });
    const { svg, skipped } = exportPageToSvg(page([marker]));
    const layeredPath = /<path d="([^"]+)" fill="rgba\(171, 51, 68, 0\.4\)" opacity="0\.6"\/>/.exec(svg);

    expect(layeredPath?.[1]).toContain("M -9.28 0 A 9.28 9.28 0 1 0 9.28 0 A 9.28 9.28 0 1 0 -9.28 0 Z");
    expect(layeredPath?.[1].match(/M /g)?.length).toBeGreaterThan(1);
    expect(svg).not.toContain("<circle");
    expect(svg.match(/fill="rgba\(171, 51, 68, 0\.4\)"/g)).toHaveLength(1);
    expect(svg.match(/opacity="0\.6"/g)).toHaveLength(1);
    expect(skipped).toEqual([]);
  });

  it("호환되지 않는 대칭 paintModel 조합은 레거시 per-dab SVG 경로로 fail-closed 한다", () => {
    const invalidLayeredSymmetry = rectEl({
      id: "invalid-layered-symmetry-svg",
      kind: "freehand",
      points: [0, 0, 8, 0],
      pressures: [1, 1],
      pressureModel: "linear-residual-path-v3",
      paintModel: "layered-flow-v1",
      sampleSpacing: 0,
      stroke: "#ab3344",
      strokeWidth: 16,
      opacity: 0.6,
      brush: "marker",
      fill: undefined,
      symmetry: { type: "vertical", centerX: 50, centerY: 0 },
    });
    const { svg } = exportPageToSvg(page([invalidLayeredSymmetry]));

    expect(svg).toContain('<circle cx="0" cy="0" r="9.28" fill="#ab3344" opacity="0.6"/>');
    expect(svg).not.toContain('<path d="M -9.28 0 A 9.28 9.28');
  });

  it("linear-full-v1 기본 펜 — 압력 0/.5/1을 지름 0/.5x/1x로 내보낸다", () => {
    const pen = rectEl({
      id: "linear-pressure-pen-svg",
      kind: "freehand",
      points: [0, 0, 10, 0, 20, 0],
      pressures: [0, 0.5, 1],
      pressureModel: "linear-full-v1",
      sampleSpacing: 1,
      stroke: "#654321",
      strokeWidth: 10,
      fill: undefined,
    });
    const { svg, skipped } = exportPageToSvg(page([pen]));

    expect(svg).toContain('<circle cx="0" cy="0" r="0" fill="#654321"');
    expect(svg).toContain('<circle cx="10" cy="0" r="2.5" fill="#654321"');
    expect(svg).toContain('<circle cx="20" cy="0" r="5" fill="#654321"');
    expect(skipped).toEqual([]);
  });

  it("linear-residual-v2 기본 펜 — segment subdivision과 무관한 Magma 간격을 보존한다", () => {
    const pen = rectEl({
      id: "residual-pressure-pen-svg",
      kind: "freehand",
      points: Array.from({ length: 13 }, (_, index) => [index, 0]).flat(),
      pressures: Array.from({ length: 13 }, () => 1),
      pressureModel: "linear-residual-v2",
      sampleSpacing: 0,
      stroke: "#654321",
      strokeWidth: 16,
      fill: undefined,
    });
    const { svg, skipped } = exportPageToSvg(page([pen]));
    const circles = svg.match(/<circle /g) ?? [];

    expect(circles).toHaveLength(4);
    expect(svg).toContain('<circle cx="0" cy="0" r="8" fill="#654321"');
    expect(svg).toContain('<circle cx="3.2" cy="0" r="8" fill="#654321"');
    expect(svg).toContain('<circle cx="6.4" cy="0" r="8" fill="#654321"');
    expect(svg).toContain('<circle cx="9.6" cy="0" r="8" fill="#654321"');
    expect(svg).not.toContain('cx="12"');
    expect(skipped).toEqual([]);
  });

  it("linear-residual-path-v3 펜은 급회전에서 이전 chord를 다시 칠하지 않는다", () => {
    const pen = rectEl({
      id: "residual-path-v3-pen-svg",
      kind: "freehand",
      points: [0, 0, 4, 0, 4, 4, 8, 4],
      pressures: [1, 1, 1, 1],
      pressureModel: "linear-residual-path-v3",
      sampleSpacing: 0,
      stroke: "#654321",
      strokeWidth: 16,
      fill: undefined,
    });
    const { svg, skipped } = exportPageToSvg(page([pen]));
    const circles = svg.match(/<circle /g) ?? [];

    expect(circles).toHaveLength(4);
    expect(svg).toContain('<circle cx="0" cy="0" r="8" fill="#654321"');
    expect(svg).toContain('<circle cx="3.2" cy="0" r="8" fill="#654321"');
    expect(svg).toContain('<circle cx="4" cy="2.4" r="8" fill="#654321"');
    expect(svg).toContain('<circle cx="5.6" cy="4" r="8" fill="#654321"');
    expect(svg).not.toContain('cx="4" cy="0"');
    expect(skipped).toEqual([]);
  });

  it("명시적 선형 압력 모델은 sampleSpacing이 없는 탭과 레거시 지오메트리도 재해석한다", () => {
    const tap = rectEl({
      id: "linear-zero-tap-svg",
      kind: "freehand",
      points: [12, 34],
      pressures: [0],
      pressureModel: "linear-full-v1",
      stroke: "#123456",
      strokeWidth: 10,
      fill: undefined,
    });
    const line = rectEl({
      id: "linear-no-spacing-svg",
      kind: "freehand",
      points: [0, 0, 10, 0],
      pressures: [0],
      pressureModel: "linear-full-v1",
      stroke: "#654321",
      strokeWidth: 10,
      fill: undefined,
    });
    const { svg, skipped } = exportPageToSvg(page([tap, line]));

    expect(svg).toContain('<circle cx="12" cy="34" r="0" fill="#123456"');
    expect(svg).toContain('<circle cx="0" cy="0" r="0" fill="#654321"');
    expect(svg).toContain('<circle cx="10" cy="0" r="5" fill="#654321"');
    expect(skipped).toEqual([]);
  });

  it("스탬프 4종 탭 — 각 엔진 고유의 dab·그레인·그라데이션·웻엣지를 보존한다", () => {
    const cases = [
      { brush: "ink-brush", kind: "ink", circles: 1 },
      { brush: "airbrush-fine", kind: "airbrush", circles: 1 },
      { brush: "pencil-grain", kind: "pencil", circles: 3 },
      { brush: "wash-brush", kind: "watercolor", circles: 2 },
    ] as const;
    const outputs = cases.map(({ brush, kind, circles }) => {
      const input = page([rectEl({
        id: `stamp-tap-${kind}`,
        kind: "freehand",
        brush,
        points: [12, 34],
        pressures: [0.6],
        stroke: "#315f73",
        strokeWidth: 20,
        opacity: 0.75,
        fill: undefined,
        stampPipeline: "causal-walker-v2",
      })]);
      const first = exportPageToSvg(input);
      const repeated = exportPageToSvg(input);

      expect(first.svg).toBe(repeated.svg);
      expect(first.svg).toContain(`data-stamp-brush="${kind}"`);
      if (kind === "ink") {
        expect(first.svg).toContain(
          'data-stamp-ink-ribbon="stamp-ink-ribbon-v1"',
        );
        expect(first.svg).toContain('data-stamp-ink-cap="round"');
        expect(first.svg).toContain('data-stamp-ink-coverage="stroke-local-single-fill"');
        expect(first.svg).not.toContain("<circle");
      } else {
        expect((first.svg.match(/<circle\b/g) ?? [])).toHaveLength(circles);
        expect(first.svg).not.toContain('<path d="M 12 34');
      }
      expect(first.skipped).toEqual([]);
      return first.svg;
    });

    expect(new Set(outputs).size).toBe(4);
    expect(outputs[1]).toContain("<radialGradient");
    expect(outputs[2]).toContain('data-stamp-brush="pencil" fill="#315f73"');
    expect(outputs[3]).toContain('fill="none" stroke="#315f73"');
  });

  it("G펜 4종을 첫 화면과 같은 단일 가변 폭 outline으로 결정적 내보내기한다", async () => {
    const { loadStudioPerfectFreehandStroker } = await import("../studio-perfect-freehand");
    await loadStudioPerfectFreehandStroker();
    const brushes = ["gpen", "mapping-pen", "kaburapen", "liner"] as const;
    const points = [4, 28, 14, 8, 30, 2, 48, 12, 56, 30, 48, 48, 28, 55, 10, 44];
    const pressures = [0.18, 0.35, 0.72, 0.94, 0.76, 0.52, 0.3, 0.16];
    const outputs = brushes.map((brush) => {
      const input = page([rectEl({
        id: `outline-${brush}`,
        kind: "freehand",
        brush,
        points,
        pressures,
        sampleSpacing: 1,
        stroke: "#203040",
        strokeWidth: 12,
        fill: undefined,
      })]);
      const first = exportPageToSvg(input).svg;
      expect(first).toBe(exportPageToSvg(input).svg);
      expect(first).toContain('data-brush-engine="perfect-outline"');
      expect(first).toContain(`data-brush-variant="${brush}"`);
      const outline = /<path d="([^"]+)" fill="#203040" data-brush-engine="perfect-outline"/.exec(first)?.[1];
      expect(outline).toBeDefined();
      expect(outline?.match(/M/g)).toHaveLength(1);
      expect(outline?.match(/Q/g)?.length).toBeGreaterThan(4);
      expect(outline?.match(/Z/g)).toHaveLength(1);
      return first;
    });

    expect(new Set(outputs).size).toBe(4);
  });

  it("누락된 레거시 G펜 필압은 명시적 0.6 배열과 같은 SVG를 만든다", async () => {
    const { loadStudioPerfectFreehandStroker } = await import("../studio-perfect-freehand");
    await loadStudioPerfectFreehandStroker();
    const points = [0, 8, 16, 0, 32, 5, 48, 18, 64, 12];
    const base = rectEl({
      id: "legacy-gpen-pressure",
      kind: "freehand",
      brush: "gpen",
      points,
      sampleSpacing: 1,
      stroke: "#203040",
      strokeWidth: 9,
      fill: undefined,
    });

    expect(exportPageToSvg(page([base])).svg).toBe(
      exportPageToSvg(page([{
        ...base,
        pressures: Array(points.length / 2).fill(0.6),
      }])).svg
    );
  });

  it("durable outline 계약은 공용 계획의 raw recorded pressure path를 그대로 내보낸다", () => {
    const points = [0, 20, 12, 4, 28, 0, 46, 10, 58, 28, 48, 42, 26, 48];
    const pressures = [0.08, 0.22, 0.48, 0.91, 0.72, 0.36, 0.11];
    const strokeWidth = 17;
    const outlineStroke = captureStudioOutlineStrokeContractV1({
      brushId: "mapping-pen",
      pressureSource: "recorded",
    });
    expect(outlineStroke).not.toBeNull();
    if (!outlineStroke) return;
    const fixture = rectEl({
      id: "durable-outline-svg",
      kind: "freehand",
      mode: "pen",
      brush: "mapping-pen",
      outlineStroke,
      points,
      pressures,
      stroke: "#29445f",
      strokeWidth,
      sampleSpacing: 0,
      fill: undefined,
    });
    const expected = planStudioPerfectFreehandRender({
      contract: outlineStroke,
      stroker: peekStudioPerfectFreehandStroker(),
      points,
      pressures,
      strokeWidth,
      sampleSpacing: 0,
    });
    expect(expected.kind).toBe("outline");
    if (expected.kind !== "outline") return;

    const result = exportPageToSvg(page([fixture]));
    const serializedPath = /<path d="([^"]+)" fill="#29445f" data-brush-engine="perfect-outline-contract-v1"/u
      .exec(result.svg)?.[1];
    expect(serializedPath).toBe(expected.pathData);
    expect(result.skipped).toEqual([]);
  });

  it("future durable outline 계약은 legacy G펜으로 조용히 강등하지 않고 skip receipt를 남긴다", () => {
    const current = captureStudioOutlineStrokeContractV1({
      brushId: "gpen",
      pressureSource: "recorded",
    });
    expect(current).not.toBeNull();
    if (!current) return;
    const fixture = rectEl({
      id: "future-outline-svg",
      kind: "freehand",
      mode: "pen",
      brush: "gpen",
      outlineStroke: {
        ...current,
        version: 99,
      },
      points: [0, 20, 20, 0, 44, 24],
      pressures: [0.2, 0.9, 0.35],
      stroke: "#aabbcc",
      strokeWidth: 10,
      fill: undefined,
    });

    const result = exportPageToSvg(page([fixture]));
    expect(result.svg).not.toContain("#aabbcc");
    expect(result.svg).not.toContain('data-brush-engine="perfect-outline"');
    expect(result.skipped).toEqual([
      {
        id: fixture.id,
        type: "draw",
        mode: "skipped",
        label: "외곽선 획 계약을 지원하지 않아 제외했어요 (unsupported-version).",
      },
    ]);
  });

  it("스탬프 튜닝 — flow·hardness·minSize를 SVG 농도·팁 경도·탭 반경에 반영한다", () => {
    const { svg } = exportPageToSvg(page([rectEl({
      id: "stamp-tuning-svg",
      kind: "freehand",
      brush: "airbrush-fine",
      points: [10, 20],
      pressures: [0],
      stroke: "#204060",
      strokeWidth: 20,
      opacity: 0.5,
      fill: undefined,
      stampPipeline: "causal-walker-v2",
      stamp: { flow: 0.4, hardness: 0.8, minSize: 0.2 },
    })]));

    expect(svg).toContain('<stop offset="68%" stop-color="#204060"/>');
    expect(svg).toContain('<circle cx="10" cy="20" r="2"');
    expect(svg).toContain('opacity="0.2"');
  });

  it("스탬프 4종 스트로크 — 짧은 획보다 긴 획의 마크가 많고 출력은 결정적이다", () => {
    const brushes = ["ink-brush", "airbrush-fine", "pencil-grain", "wash-brush"] as const;
    for (const brush of brushes) {
      const base = rectEl({
        id: `stamp-length-${brush}`,
        kind: "freehand",
        brush,
        pressures: [0.35, 0.8],
        stroke: "#4a3020",
        strokeWidth: 14,
        fill: undefined,
        stampPipeline: "causal-walker-v2",
      });
      const short = exportPageToSvg(page([{ ...base, points: [4, 8, 20, 8] }])).svg;
      const longInput = page([{ ...base, points: [4, 8, 180, 8] }]);
      const long = exportPageToSvg(longInput).svg;
      const repeated = exportPageToSvg(longInput).svg;

      if (brush === "ink-brush") {
        const inkPath = (svg: string) => (
          /data-stamp-ink-ribbon="stamp-ink-ribbon-v1"[^>]*\sd="([^"]+)"/u
            .exec(svg)?.[1] ?? ""
        );
        expect(inkPath(long).length).toBeGreaterThan(inkPath(short).length);
        expect(long).toContain('data-stamp-ink-cap="round"');
        expect(long).not.toContain("<circle");
      } else {
        expect((long.match(/<circle\b/g) ?? []).length).toBeGreaterThan(
          (short.match(/<circle\b/g) ?? []).length
        );
      }
      expect(long).toBe(repeated);
    }
  });

  it("현대 스탬프는 pipeline 태그가 없어도 sampleSpacing으로 raw 급회전을 복원한다", () => {
    const base = rectEl({
      id: "stamp-stream-contract",
      kind: "freehand",
      brush: "airbrush-fine",
      points: [0, 0, 0, 10, 4, 20],
      pressures: [0.3, 0.6, 0.9],
      stroke: "#3f6280",
      strokeWidth: 10,
      fill: undefined,
    });
    const legacy = exportPageToSvg(page([base])).svg;
    const modern = exportPageToSvg(page([{ ...base, sampleSpacing: 128 }])).svg;
    const causalInput = page([{ ...base, stampPipeline: "causal-walker-v2" }]);
    const causal = exportPageToSvg(causalInput).svg;

    expect(causal).toBe(exportPageToSvg(causalInput).svg);
    expect(modern).toBe(causal);
    expect(causal).not.toBe(legacy);
    expect(causal).toMatch(/<circle cx="0" cy="[1-9][^"]*"/);
    expect(legacy).not.toMatch(/<circle cx="0" cy="[1-9][^"]*"/);
  });

  it("글로우 탭 — 경로가 아닌 동심 원 레이어로 한 번의 클릭도 보이게 내보낸다", () => {
    for (const brush of ["glow", "soft-glow"] as const) {
      const input = page([rectEl({
        id: `glow-tap-${brush}`,
        kind: "freehand",
        brush,
        points: [25, 35],
        stroke: "#55ccff",
        strokeWidth: 16,
        opacity: 0.8,
        fill: undefined,
      })]);
      const first = exportPageToSvg(input).svg;

      expect(first).toBe(exportPageToSvg(input).svg);
      expect((first.match(/<circle cx="25" cy="35"/g) ?? []).length).toBeGreaterThan(1);
      expect(first).toContain("mix-blend-mode:normal");
      expect(first).not.toContain("mix-blend-mode:screen");
      expect(first).not.toContain('<path d="M 25 35');
    }
  });

  it("수채 번짐 — 결정적 core/diffuse dab과 방사 그라데이션을 보존한다", () => {
    const watercolor = rectEl({
      id: "watercolor-svg-1",
      kind: "freehand",
      brush: "watercolor",
      points: [0, 0, 20, 5, 40, 0],
      pressures: [0.2, 0.6, 0.9],
      stroke: "#336699",
      strokeWidth: 24,
    });
    const first = exportPageToSvg(page([watercolor]));
    const second = exportPageToSvg(page([watercolor]));
    expect(first.svg).toBe(second.svg);
    expect(first.svg).toContain("<radialGradient");
    expect(first.svg).toContain('stop-color="#336699"');
    expect((first.svg.match(/<circle /g) ?? []).length).toBeGreaterThan(2);
    expect(first.skipped).toEqual([]);
  });

  it("causal 수채 v2는 전체 평활화 없이 raw accepted points를 결정적으로 내보낸다", () => {
    const base = rectEl({
      id: "watercolor-causal-svg-1",
      kind: "freehand",
      brush: "watercolor",
      points: [0, 0, 0, 10, 10, 10],
      pressures: [0.25, 0.6, 0.9],
      sampleSpacing: 128,
      stroke: "#315f73",
      strokeWidth: 10,
      fill: undefined,
    });
    const legacy = exportPageToSvg(page([base]));
    const causal = exportPageToSvg(page([{
      ...base,
      watercolorPipeline: "causal-walker-v2",
    }]));
    const repeated = exportPageToSvg(page([{
      ...base,
      watercolorPipeline: "causal-walker-v2",
    }]));

    // width 10의 causal 기본 spacing은 3.4px이다. 첫 raw 수직 구간을 보존할 때만 이 ribbon
    // 단면이 생긴다. legacy는 sampleSpacing=128로 중간점을 제거해 과거 원형 계획을 유지한다.
    expect(causal.svg).toContain('data-brush-engine="wet-ribbon-carrier-v2"');
    expect(causal.svg).toMatch(/L-?[0-9.]+ [0-9.]+/);
    expect(causal.svg).not.toContain("<circle");
    expect(legacy.svg).not.toContain('data-brush-engine="wet-ribbon-carrier-v2"');
    expect(legacy.svg).toContain("<circle");
    // The continuous ribbon preserves the accepted endpoint as its terminal cross-section rather
    // than adding a centre-point triangle that would double-paint the join.
    expect(causal.svg).toContain("L10 ");
    expect(causal.svg).not.toBe(legacy.svg);
    expect(repeated.svg).toBe(causal.svg);
    expect(causal.skipped).toEqual([]);

    const longStroke = exportPageToSvg(page([{
      ...base,
      id: "watercolor-causal-svg-long",
      points: [0, 0, 5_000, 0],
      pressures: [0.5, 0.5],
      watercolorPipeline: "causal-walker-v2",
    }]));
    const longStrokePolygonCount = (longStroke.svg.match(/Z/g) ?? []).length;
    // Immutable station footprints are stitched into continuous render contours, so SVG does not
    // expose one antialiased subpath seam for every 3.4px causal station.
    expect(longStrokePolygonCount).toBeGreaterThan(4);
    expect(longStrokePolygonCount).toBeLessThanOrEqual(5 * STUDIO_WET_RIBBON_OPACITY_BUCKET_COUNT);
    expect(longStroke.svg).toMatch(/L5000 -?[0-9.]+/);
  });

  it("입자 브러시 — Canvas와 같은 결정적 타원형 dab·회전·유량을 SVG로 보존한다", () => {
    const dynamic = rectEl({
      id: "dynamic-svg-1",
      kind: "freehand",
      brush: "dry-media",
      points: [8, 12, 28, 8, 52, 30, 80, 18],
      pressures: [0.15, 0.45, 0.9, 0.35],
      speeds: [0.1, 0.5, 1.1, 0.3],
      tiltXs: [0, 12, 38, 8],
      tiltYs: [0, 6, 24, 4],
      twists: [0, 45, 180, 355],
      tangentialPressures: [0, 0.2, -0.25, 0],
      brushDynamics: ellipseDynamics("dry-media"),
      stroke: "#3a2218",
      strokeWidth: 9,
    });
    const first = exportPageToSvg(page([dynamic]));
    const second = exportPageToSvg(page([dynamic]));
    expect(first.svg).toBe(second.svg);
    expect((first.svg.match(/<ellipse /g) ?? []).length).toBeGreaterThan(3);
    expect(first.svg).toContain('fill="#3a2218"');
    expect(first.svg).toContain("transform=\"rotate(");
    expect(first.svg).toMatch(/opacity="0\.[0-9]+"/);
    expect(first.skipped).toEqual([]);
  });

  it("입자 브러시 — 획 투명도를 완성 그룹이 아니라 Canvas와 같은 각 dab에 적용한다", () => {
    const dynamic = rectEl({
      id: "dynamic-opacity",
      kind: "freehand",
      brush: "dry-media",
      points: [8, 12, 32, 18, 58, 10],
      pressures: [0.3, 0.8, 0.5],
      brushDynamics: ellipseDynamics("dry-media"),
      stroke: "#4455aa",
      strokeWidth: 22,
    });
    const full = exportPageToSvg(page([{ ...dynamic, opacity: 1 }])).svg;
    const half = exportPageToSvg(page([{ ...dynamic, opacity: 0.5 }])).svg;
    const dabOpacities = (svg: string) => Array.from(
      svg.matchAll(/<ellipse [^>]*opacity="([0-9.]+)"/g),
      (match) => Number(match[1])
    );
    const fullOpacities = dabOpacities(full);
    const halfOpacities = dabOpacities(half);
    expect(half).not.toContain('<g opacity="0.5">');
    expect(halfOpacities).toHaveLength(fullOpacities.length);
    expect(halfOpacities.length).toBeGreaterThan(2);
    halfOpacities.forEach((value, index) => {
      // 전용 opacity formatter는 6자리이므로 독립 반올림 오차만 허용한다.
      expect(Math.abs(value - fullOpacities[index]! * 0.5)).toBeLessThanOrEqual(0.000001);
    });
  });

  it("bounded-flow-v2 입자 브러시는 dab을 쌓은 뒤 획 투명도를 그룹에 한 번 적용한다", () => {
    const dynamic = rectEl({
      id: "dynamic-bounded-flow-v2",
      kind: "freehand",
      brush: "dry-media",
      points: [8, 12, 32, 18, 58, 10],
      pressures: [0.3, 0.8, 0.5],
      brushDynamics: normalizeStudioBrushDynamicsSettings({
        ...ellipseDynamics("dry-media"),
        grain: { amount: 0 },
      }),
      stroke: "#4455aa",
      strokeWidth: 22,
      fill: undefined,
      sampleSpacing: 0.5,
      paintModel: "bounded-flow-v2",
    });
    const full = exportPageToSvg(page([{ ...dynamic, opacity: 1 }])).svg;
    const half = exportPageToSvg(page([{ ...dynamic, opacity: 0.5 }])).svg;
    expect(exportPageToSvg(page([{ ...dynamic, opacity: 0.5 }])).svg).toBe(half);
    const dabOpacities = (svg: string) => Array.from(
      svg.matchAll(/<ellipse [^>]*opacity="([0-9.]+)"/g),
      (match) => Number(match[1])
    );

    expect((half.match(/<g opacity="0\.5">/g) ?? [])).toHaveLength(1);
    expect(dabOpacities(half)).toEqual(dabOpacities(full));
    expect(dabOpacities(half).length).toBeGreaterThan(2);
  });

  it.each([
    ["watercolor", "watercolor-opacity"],
    ["glitter", "glitter-opacity"],
    ["oil", "oil-opacity"],
    ["pastel", "pastel-opacity"],
    ["oil-pastel", "oil-pastel-opacity"],
  ] as const)("%s — Canvas처럼 획 투명도를 각 재료 mark에 적용한다", (brush, id) => {
    const dynamic = rectEl({
      id,
      kind: "freehand",
      brush,
      points: [8, 12, 32, 18, 58, 10],
      pressures: [0.3, 0.8, 0.5],
      stroke: "#4455aa",
      strokeWidth: 22,
      fill: undefined,
    });
    const full = exportPageToSvg(page([{ ...dynamic, opacity: 1 }])).svg;
    const half = exportPageToSvg(page([{ ...dynamic, opacity: 0.5 }])).svg;
    const dabOpacities = (svg: string) => Array.from(
      svg.matchAll(/<(?:circle|ellipse|rect|path|use) [^>]*opacity="([0-9.]+)"/g),
      (match) => Number(match[1])
    );
    const fullOpacities = dabOpacities(full);
    const halfOpacities = dabOpacities(half);

    expect(half).not.toMatch(/<g[^>]*opacity="0\.5"/);
    expect(halfOpacities).toHaveLength(fullOpacities.length);
    expect(halfOpacities.length).toBeGreaterThan(
      brush === "pastel" || brush === "oil-pastel" ? 0 : 2,
    );
    halfOpacities.forEach((value, index) => {
      expect(Math.abs(value - fullOpacities[index]! * 0.5)).toBeLessThanOrEqual(0.000001);
    });
    if (brush === "glitter") {
      expect(half).toContain('data-luminous-composite="source-over"');
      expect(half).toContain("mix-blend-mode:normal");
      expect(half).not.toContain("mix-blend-mode:screen");
    }
  });

  it("아크릴 장획은 반복 타원 대신 Canvas와 같은 연속 body와 강모 lane을 직렬화한다", () => {
    const { svg } = exportPageToSvg(page([rectEl({
      id: "acrylic-contiguous-ribbon",
      kind: "freehand",
      brush: "acrylic",
      points: [8, 18, 120, 45, 240, 8, 380, 60, 520, 20],
      pressures: [0.35, 0.72, 0.5, 0.9, 0.62],
      stroke: "#8b3f31",
      strokeWidth: 20,
      fill: undefined,
    })]));

    expect(svg).toContain('data-brush-engine="oil-ribbon-carrier-v1"');
    expect(svg).toContain('data-paint-carrier="contiguous-variable-width-ribbon"');
    // One <path> per bristle LOAD BAND, each carrying every run of that band as a subpath. Painting
    // per hair let a self-crossing deposit its ridges twice; one path per band deposits once.
    const bristlePaths = svg.match(/data-paint-bristle-lane="true"/gu) ?? [];
    expect(bristlePaths.length).toBeGreaterThan(0);
    // No upper bound on the lane count. Lanes are cumulative load shells, so the count is the
    // stroke's tonal resolution; what a crossing folds is the number of width gauges, which the
    // carrier's own pixel gate pins. Capping the count here would cap tone for a reason that
    // stopped applying when the shells landed.
    //
    // The relief must still be genuinely broken rather than one polyline, but only the OUTERMOST
    // shell of a gauge carries the whole population - inner shells hold the heaviest runs alone
    // and a single-subpath inner shell is the intended shape, not a regression. Assert the union.
    const laneSubpaths = [...svg.matchAll(/data-paint-bristle-lane="true" d="([^"]+)"/gu)]
      .map(([, d]) => (d!.match(/M/gu) ?? []).length);
    expect(laneSubpaths.length).toBe(bristlePaths.length);
    expect(Math.max(...laneSubpaths)).toBeGreaterThan(1);
    expect(svg).not.toContain("<ellipse");
    expect(exportPageToSvg(page([rectEl({
      id: "acrylic-contiguous-ribbon",
      kind: "freehand",
      brush: "acrylic",
      points: [8, 18, 120, 45, 240, 8, 380, 60, 520, 20],
      pressures: [0.35, 0.72, 0.5, 0.9, 0.62],
      stroke: "#8b3f31",
      strokeWidth: 20,
      fill: undefined,
    })])).svg).toBe(svg);
  });

  it.each(["pastel", "oil-pastel"] as const)(
    "%s은 원형 스탬프 열 대신 커널 알파맵 dab 마크를 직렬화한다 (de-polygon)",
    (brush) => {
      const { svg } = exportPageToSvg(page([rectEl({
        id: `${brush}-anisotropic-fibres`,
        kind: "freehand",
        brush,
        // A freshly authored stroke stores its own dynamics, which is what carries the kernel
        // pin. Without a snapshot this element is a LEGACY stroke, and the replay fail-safe
        // deliberately keeps those on the union carrier so a saved document does not change
        // when it is reopened — so the de-polygon path must be exercised the way the product
        // actually produces it.
        brushDynamics: studioBrushDynamicsSettingsForBrushId(brush) ?? undefined,
        points: [8, 12, 40, 20, 72, 12],
        pressures: [0.45, 0.8, 0.6],
        stroke: "#4455aa",
        strokeWidth: 20,
        fill: undefined,
      })]));
      // Fresh unpinned strokes never serialize the polygon-union carrier.
      expect(svg).not.toContain('data-brush-coverage="dry-media-union-ribbon"');
      const fibres = Array.from(svg.matchAll(
        new RegExp(
          `<use data-brush-coverage="alpha-map"`
          + ` data-brush-carrier="soft-pigment-fiber"`
          + ` data-brush-material="${brush}" href="#([^"]+)"`,
          "gu",
        ),
      ));
      expect(fibres.length).toBeGreaterThan(8);
      // Shared kernel tip bakes are content-addressed symbols: many dabs, few defs.
      const symbolIds = new Set(fibres.map((match) => match[1]));
      expect(symbolIds.size).toBeGreaterThan(0);
      expect(symbolIds.size).toBeLessThanOrEqual(40);
      expect(
        (svg.match(/data-brush-tip-asset="full-alpha-map-v1"/gu) ?? []).length,
      ).toBe(symbolIds.size);
      expect(svg).not.toMatch(/<circle [^>]*fill="url\(#sp/u);
      expect(svg).not.toMatch(/<ellipse [^>]*data-brush-material=/u);
    },
  );

  it.each(["pastel", "oil-pastel"] as const)(
    "핀된 %s 레거시 리플레이는 기존 단일 union 섬유 경로를 그대로 직렬화한다",
    (brush) => {
      const pinnedDynamics = normalizeStudioBrushDynamicsSettings({
        ...studioBrushDynamicsSettingsForBrushId(brush)!,
        dryMediaUnionProgram: studioDryMediaUnionComposableProgramPin(),
      });
      const { svg } = exportPageToSvg(page([rectEl({
        id: `${brush}-pinned-union-fibres`,
        kind: "freehand",
        brush,
        brushDynamics: pinnedDynamics,
        points: [8, 12, 40, 20, 72, 12],
        pressures: [0.45, 0.8, 0.6],
        stroke: "#4455aa",
        strokeWidth: 20,
        fill: undefined,
      })]));
      const fibres = Array.from(svg.matchAll(
        new RegExp(
          `<path data-brush-coverage="dry-media-union-ribbon"`
          + ` data-brush-carrier="soft-pigment-fiber"`
          + ` data-brush-material="${brush}"`
          + `[^>]* d="([^"]+)"[^>]* opacity="([^"]+)"`,
          "gu",
        ),
      ));

      expect(fibres).toHaveLength(1);
      expect((fibres[0]?.[1].match(/M/gu) ?? []).length).toBeGreaterThan(10);
      expect(Number(fibres[0]?.[2])).toBeGreaterThan(0);
      expect(Number(fibres[0]?.[2])).toBeLessThanOrEqual(1);
      expect(svg).not.toContain('data-brush-tip-asset="full-alpha-map-v1"');
      expect(svg).not.toMatch(/<circle [^>]*fill="url\(#sp/u);
      expect(svg).not.toMatch(/<ellipse [^>]*data-brush-material=/u);
    },
  );

  it("기본 에어브러시 — 필압 0·툴바 투명도 70%의 저농도 dab을 0으로 반올림하지 않는다", () => {
    const { svg } = exportPageToSvg(page([rectEl({
      id: "airbrush-low-alpha",
      kind: "freehand",
      brush: "airbrush",
      points: [10, 10],
      pressures: [0],
      stroke: "#336699",
      strokeWidth: 32,
      opacity: 0.7,
      // 타원 dab 경로로 고정해 저농도 opacity 포맷을 검증한다(텍스처 팁은 multi-circle).
      brushDynamics: ellipseDynamics("airbrush"),
    })]));

    // visible-tap default: opacity .65×.4, flow .50×.45, toolbar .7 = .04095.
    // 부동소수점의 마지막 반올림 방향과 무관하게 두 자리 좌표 포맷의 0이 아니라 실제
    // 저농도를 유지해야 한다.
    const serializedOpacity = Number(/<ellipse [^>]*opacity="([0-9.]+)"/.exec(svg)?.[1]);
    expect(serializedOpacity).toBeGreaterThan(0);
    expect(serializedOpacity).toBeCloseTo(0.65 * 0.4 * 0.5 * 0.45 * 0.7, 5);
    expect(svg).not.toContain('opacity="0"');
  });

  it("얇고 기울어진 드라이 미디어 — Canvas처럼 반지름 최소값 적용 뒤 roundness로 ry를 축소한다", () => {
    const fixture = rectEl({
      id: "thin-dry-media",
      kind: "freehand",
      brush: "chalk",
      points: [5, 7],
      pressures: [0],
      tiltXs: [90],
      tiltYs: [0],
      stroke: "#21160f",
      strokeWidth: 0.1,
      paintModel: "bounded-flow-v2",
      brushDynamics: ellipseDynamics("dry-media"),
    });
    const { svg, skipped } = exportPageToSvg(page([fixture]));
    const plannedMarks = canvasCoverageMarksForSvgFixture(fixture);
    const groups = dynamicMaterialEllipseGroups(svg);
    const serialized = groups.flat();

    expect(skipped).toEqual([]);
    // SVG는 리테인드 Canvas 플래너의 지오메트리 종속이다 — 같은 플래너 입력으로 계획한
    // coverage mark와 직렬화된 타원이 마크 단위(cx/cy/rx/ry/회전)로 1e-6 안에서 일치해야 한다.
    expect(plannedMarks.length).toBeGreaterThan(0);
    expect(plannedMarks.every((mark) => (
      mark.ribbon === undefined
      && mark.texture === undefined
      && mark.falloff === undefined
    ))).toBe(true);
    expect(groups).toHaveLength(1);
    expect(serialized).toHaveLength(plannedMarks.length);
    serialized.forEach((ellipse, index) => {
      const mark = plannedMarks[index]!;
      expectNear(ellipse.cx, mark.x, 0.000001);
      expectNear(ellipse.cy, mark.y, 0.000001);
      expectNear(ellipse.rx, mark.radiusX, 0.000001);
      expectNear(ellipse.ry, mark.radiusY, 0.000001);
      expectNear(ellipse.angle, mark.angleRadians * 180 / Math.PI, 0.000001);
      expect(ellipse.material).toBe("chalk");
      expect(ellipse.carrier).toBeNull();
      // Canvas와 같은 순서 — anisotropic 브리지의 반지름 최소값(0.125)을 먼저 적용한 뒤
      // roundness로 ry만 축소하므로 극세 획에서도 ry < rx 섬유 축이 살아 있어야 한다.
      expect(ellipse.rx).toBeGreaterThanOrEqual(0.125 - 0.000001);
      expect(ellipse.ry).toBeLessThan(ellipse.rx);
    });
  });

  it("크레용·초크·목탄 SVG가 retained Canvas의 동일 anisotropic coverage를 직렬화한다", () => {
    const signatures: string[] = [];
    for (const brush of ["crayon", "chalk", "charcoal"] as const) {
      const fixture = rectEl({
        id: `svg-retained-${brush}`,
        kind: "freehand",
        brush,
        points: [8, 12, 34, 18, 62, 11, 92, 24],
        pressures: [0.42, 0.7, 0.9, 0.58],
        speeds: [0.2, 0.5, 0.8, 0.4],
        tiltXs: [8, 14, 19, 11],
        tiltYs: [-3, -8, -6, -4],
        stroke: "#3f2a20",
        strokeWidth: 18,
        paintModel: "bounded-flow-v2",
        brushDynamics: ellipseDynamics("dry-media"),
      });
      const { svg, skipped } = exportPageToSvg(page([fixture]));
      const plannedMarks = canvasCoverageMarksForSvgFixture(fixture);
      const serialized = dynamicMaterialEllipseGroups(svg).flat();

      expect(skipped, brush).toEqual([]);
      // anisotropic 브리지의 lane 확장(크레용 3 · 초크/목탄 5)까지 포함한 전체 마크 수와
      // 마크별 affine 지오메트리가 retained Canvas 플랜과 정확히 일치해야 한다.
      expect(plannedMarks.length, brush).toBeGreaterThan(1);
      expect(serialized, brush).toHaveLength(plannedMarks.length);
      serialized.forEach((ellipse, index) => {
        const mark = plannedMarks[index]!;
        expectNear(ellipse.cx, mark.x, 0.000001);
        expectNear(ellipse.cy, mark.y, 0.000001);
        expectNear(ellipse.rx, mark.radiusX, 0.000001);
        expectNear(ellipse.ry, mark.radiusY, 0.000001);
        expectNear(ellipse.angle, mark.angleRadians * 180 / Math.PI, 0.000001);
        expect(ellipse.material, brush).toBe(brush);
        // 세 재질 모두 원형 스탬프가 아닌 기울어진 섬유 축(rx/ry ≥ 2)을 유지해야 한다.
        expect(ellipse.rx / ellipse.ry, brush).toBeGreaterThanOrEqual(2);
      });
      const signatureMark = plannedMarks[Math.floor(plannedMarks.length / 2)]!;
      signatures.push([
        signatureMark.radiusX,
        signatureMark.radiusY,
        signatureMark.angleRadians,
        signatureMark.alpha,
      ].map((value) => value.toFixed(8)).join(":"));
    }
    // 질감 정체성 — 같은 stroke 입력에서도 세 재질의 kernel 응답이 서로 달라야 한다.
    expect(new Set(signatures).size).toBe(3);
  });

  it("대칭 dry-media 파티션 — 변주별 재계획이 complete coverage의 정확한 분할과 일치한다", () => {
    // 내보내기는 complete plan(모든 변주를 한 번에 계획)의 마크를 변주별 재계획의 마크 수로
    // 잘라 <g>마다 싣는다. 이 테스트는 그 자(변주별 재계획)가 complete plan과 총 개수·값
    // 모두 정확히 일치함을 증명한다 — 어긋나면 내보내기는 조용한 대체 없이 fail-closed 한다.
    const fixture = rectEl({
      id: "crayon-symmetric-partition",
      kind: "freehand",
      brush: "crayon",
      points: [12, 16, 30, 24, 52, 18],
      pressures: [0.5, 0.82, 0.66],
      tiltXs: [12, 16, 9],
      tiltYs: [-4, -7, -2],
      stroke: "#5a3d2b",
      strokeWidth: 14,
      paintModel: "bounded-flow-v2",
      brushDynamics: ellipseDynamics("dry-media"),
      symmetry: { type: "vertical", centerX: 60, centerY: 50 },
    });
    const retainedPlan = planStudioDynamicBrushRender(
      fixture as DrawEl,
      "dry-media",
      false,
    );
    expect(retainedPlan.status).toBe("ready");
    if (retainedPlan.status !== "ready") return;
    const coverageInput = {
      dynamics: retainedPlan.plan.dynamics,
      materialIdentity: retainedPlan.plan.materialIdentity,
      dynamicSeed: retainedPlan.plan.seed,
      stroke: fixture.stroke,
      stampGrid: retainedPlan.plan.renderBudget.stampGrid,
      markBudget: retainedPlan.plan.markBudget,
      ...(retainedPlan.plan.paper ? { paper: retainedPlan.plan.paper } : {}),
    };
    const complete = planStudioDynamicBrushCoverageAndLegacyMarks({
      ...coverageInput,
      dabVariations: retainedPlan.plan.dabVariations,
    }).coveragePlan;
    expect(complete.ok).toBe(true);
    if (!complete.ok) throw new Error(complete.reason);
    const variationPlans = retainedPlan.plan.dabVariations.map((dabs) => {
      const variationCoverage = planStudioDynamicBrushCoverageAndLegacyMarks({
        ...coverageInput,
        dabVariations: [dabs],
      }).coveragePlan;
      if (!variationCoverage.ok) throw new Error(variationCoverage.reason);
      return variationCoverage.marks;
    });

    expect(retainedPlan.plan.dabVariations.length).toBe(2);
    expect(complete.marks.length).toBeGreaterThan(1);
    // 파티션 오프셋 합이 complete와 일치한다 — 내보내기 fail-closed 분기가 잠들어 있음을 증명.
    expect(variationPlans.reduce((sum, marks) => sum + marks.length, 0))
      .toBe(complete.marks.length);
    // 값 자체도 마크 단위로 결정적으로 동일하다(변주끼리 상쇄되는 drift 배제).
    let offset = 0;
    for (const variationMarks of variationPlans) {
      variationMarks.forEach((variationMark, index) => {
        const completeMark = complete.marks[offset + index]!;
        expect(completeMark.x).toBe(variationMark.x);
        expect(completeMark.y).toBe(variationMark.y);
        expect(completeMark.radiusX).toBe(variationMark.radiusX);
        expect(completeMark.radiusY).toBe(variationMark.radiusY);
        expect(completeMark.angleRadians).toBe(variationMark.angleRadians);
        expect(completeMark.alpha).toBe(variationMark.alpha);
        expect(completeMark.color).toBe(variationMark.color);
      });
      offset += variationMarks.length;
    }

    // 내보낸 SVG의 변주 <g> 그룹은 complete plan의 파티션을 순서 그대로 직렬화한다.
    const { svg, skipped } = exportPageToSvg(page([fixture]));
    expect(skipped).toEqual([]);
    const groups = dynamicMaterialEllipseGroups(svg);
    expect(groups).toHaveLength(retainedPlan.plan.dabVariations.length);
    expect(groups.map((group) => group.length)).toEqual(
      variationPlans.map((marks) => marks.length),
    );
    offset = 0;
    for (const group of groups) {
      group.forEach((ellipse, index) => {
        const mark = complete.marks[offset + index]!;
        expectNear(ellipse.cx, mark.x, 0.000001);
        expectNear(ellipse.cy, mark.y, 0.000001);
        expectNear(ellipse.rx, mark.radiusX, 0.000001);
        expectNear(ellipse.ry, mark.radiusY, 0.000001);
        expectNear(ellipse.angle, mark.angleRadians * 180 / Math.PI, 0.000001);
        expect(ellipse.material).toBe("crayon");
      });
      offset += group.length;
    }
    expect(offset).toBe(complete.marks.length);
  });

  it("causal PNG 알파 팁은 희소 texel 전부를 한 번의 무손실 defs 자산과 dab별 use로 보존한다", () => {
    const alphaBytes = new Uint8Array(8 * 8);
    alphaBytes[0] = 255;
    alphaBytes[7] = 255;
    alphaBytes[56] = 255;
    alphaBytes[63] = 255;
    alphaBytes[1] = 128;
    alphaBytes[8] = 64;
    alphaBytes[55] = 64;
    alphaBytes[62] = 128;
    const custom = {
      alphaMapBase64: encodeStudioBrushTipAlphaMapBase64(alphaBytes),
      alphaMapSize: 8,
    };
    const stamped = rectEl({
      id: "tip-stamp-svg",
      kind: "freehand",
      brush: "dry-media",
      points: [0, 0, 40, 0],
      pressures: [0.6, 0.6],
      stroke: "#221100",
      strokeWidth: 10,
      brushDynamics: normalizeStudioBrushDynamicsSettings({
        ...studioBrushDynamicsPresetSettings("dry-media"),
        depositPipeline: STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V2,
        taper: { enabled: false },
        tip: {
          shape: "grain",
          softness: 0,
          alphaMapBase64: custom.alphaMapBase64,
          alphaMapSize: custom.alphaMapSize,
        },
        grain: { amount: 0 },
        tipLayers: [],
        dualBrush: { enabled: false },
        spacingRatio: null,
        spacing: { base: 12, mappings: [] },
        scatterRatio: null,
        scatter: { base: 0 },
      }),
    });
    const first = exportPageToSvg(page([stamped]));
    const second = exportPageToSvg(page([stamped]));
    const expectedMarks = canvasCoverageMarksForSvgFixture(stamped);
    const uses = dynamicCoverageUses(first.svg);
    const dataUrl = /<symbol data-brush-tip-asset="full-alpha-map-v1"[^>]*>.*?<image [^>]*href="([^"]+)"/u
      .exec(first.svg)?.[1];
    if (!dataUrl) throw new Error("missing embedded tip asset");
    const decoded = decodeEmbeddedRgbaPng(dataUrl);
    const decodedAlpha = Uint8Array.from(
      { length: decoded.width * decoded.height },
      (_, index) => decoded.pixels[index * 4 + 3]!,
    );

    expect(first.svg).toBe(second.svg);
    expect(first.skipped).toEqual([]);
    expect(decoded.width).toBe(8);
    expect(decoded.height).toBe(8);
    expect(decodedAlpha).toEqual(alphaBytes);
    expect(decodedAlpha[0]).toBe(255);
    expect(decodedAlpha[27]).toBe(0);
    expect(decodedAlpha[63]).toBe(255);
    expect((first.svg.match(/data-brush-tip-asset="full-alpha-map-v1"/gu) ?? []))
      .toHaveLength(1);
    expect(uses).toHaveLength(expectedMarks.length);
    expect(uses.length).toBeGreaterThan(1);
    expect(first.svg).not.toContain("<circle ");
    expect(first.svg).not.toContain('data-brush-coverage="ellipse"');
    expect(first.svg).toContain('color="#221100"');
  });

  it("명시적 noncausal 팁은 기존 grid circle 직렬화 바이트 경로를 유지한다", () => {
    const legacySettings = studioBrushDynamicsPresetSettings("dry-media");
    legacySettings.depositPipeline = undefined;
    const custom = studioBrushTipAlphaMapToBase64("hard", 0.2, 8);
    const legacy = rectEl({
      id: "legacy-tip-grid-svg",
      kind: "freehand",
      brush: "dry-media",
      points: [0, 0, 16, 0],
      pressures: [0.6, 0.6],
      stroke: "#221100",
      strokeWidth: 10,
      brushDynamics: normalizeStudioBrushDynamicsSettings({
        ...legacySettings,
        taper: { enabled: false },
        tip: {
          shape: "grain",
          softness: 0.2,
          alphaMapBase64: custom.alphaMapBase64,
          alphaMapSize: custom.alphaMapSize,
        },
        grain: { amount: 0 },
        tipLayers: [],
        dualBrush: { enabled: false },
        spacingRatio: null,
        spacing: { base: 12, mappings: [] },
        scatterRatio: null,
        scatter: { base: 0, mappings: [] },
      }),
    });
    const first = exportPageToSvg(page([legacy])).svg;

    expect(first).toBe(exportPageToSvg(page([legacy])).svg);
    expect((first.match(/<circle /gu) ?? []).length).toBeGreaterThan(1);
    expect(first).not.toContain('data-brush-tip-asset="full-alpha-map-v1"');
    expect(first).not.toContain('data-brush-coverage="alpha-map"');
  });

  it("causal dual tip·추가 layer·대칭·고정 grain은 Canvas coverage plan과 affine fingerprint가 같다", () => {
    const primaryBytes = Uint8Array.from(
      { length: 8 * 8 },
      (_, index) => Math.max(0, 255 - (index % 8) * 32 - Math.floor(index / 8) * 8),
    );
    const dualBytes = Uint8Array.from(
      { length: 8 * 8 },
      (_, index) => Math.min(255, (index % 8) * 28 + Math.floor(index / 8) * 10),
    );
    const layerBytes = Uint8Array.from(
      { length: 8 * 8 },
      (_, index) => ((index % 8 + Math.floor(index / 8)) % 2 === 0 ? 255 : 0),
    );
    const tip = (bytes: Uint8Array, shape: "grain" | "star") => ({
      shape,
      softness: 0.2,
      alphaMapBase64: encodeStudioBrushTipAlphaMapBase64(bytes),
      alphaMapSize: 8,
    });
    const dynamics = normalizeStudioBrushDynamicsSettings({
      ...studioBrushDynamicsPresetSettings("dry-media"),
      depositPipeline: STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V2,
      taper: { enabled: false },
      tip: tip(primaryBytes, "grain"),
      dualBrush: {
        enabled: true,
        tip: tip(dualBytes, "star"),
        blendMode: "multiply",
        sizeRatio: 0.75,
      },
      tipLayers: [{
        tip: tip(layerBytes, "star"),
        scale: 0.55,
        opacity: 0.62,
        offsetX: 0.3,
        offsetY: -0.2,
        angle: 24,
        roundness: 0.7,
      }],
      colorDynamics: {
        hueJitter: 18,
        saturationJitter: 0.08,
        valueJitter: 0.06,
      },
      grain: {
        space: "stroke-fixed",
        amount: 0.68,
        scale: 3.5,
        contrast: 0.72,
        seed: 57,
      },
      spacingRatio: null,
      spacing: { base: 11, mappings: [] },
      scatterRatio: null,
      scatter: { base: 0, mappings: [] },
    });
    const dynamic = rectEl({
      id: "causal-texture-canvas-svg-parity",
      kind: "freehand",
      brush: "dry-media",
      points: [18, 24, 48, 30],
      pressures: [0.45, 0.8],
      tiltXs: [18, 32],
      tiltYs: [8, 16],
      twists: [12, 42],
      stroke: "#356dcc",
      strokeWidth: 14,
      brushDynamics: dynamics,
      symmetry: { type: "vertical", centerX: 60, centerY: 50 },
    });
    const result = exportPageToSvg(page([dynamic]));
    const replay = exportPageToSvg(page([dynamic]));
    const canvasMarks = canvasCoverageMarksForSvgFixture(dynamic);
    const uses = dynamicCoverageUses(result.svg);

    expect(result.svg).toBe(replay.svg);
    expect(result.skipped).toEqual([]);
    expect(canvasMarks.every((mark) => mark.texture?.kind === "alpha-map"))
      .toBe(true);
    expect(uses).toHaveLength(canvasMarks.length);
    expect((result.svg.match(/data-brush-tip-asset="full-alpha-map-v1"/gu) ?? []))
      .toHaveLength(2);
    expect(result.svg).not.toContain("<circle ");
    uses.forEach((use, index) => {
      const mark = canvasMarks[index]!;
      expect(use.x).toBeCloseTo(mark.x - mark.radiusX, 5);
      expect(use.y).toBeCloseTo(mark.y - mark.radiusY, 5);
      expect(use.width).toBeCloseTo(mark.radiusX * 2, 5);
      expect(use.height).toBeCloseTo(mark.radiusY * 2, 5);
      expect(use.opacity).toBeCloseTo(mark.alpha, 6);
      expect(use.color).toBe(mark.color);
      expect(use.angle).toBeCloseTo(mark.angleRadians * 180 / Math.PI, 5);
      expect(use.centerX).toBeCloseTo(mark.x, 5);
      expect(use.centerY).toBeCloseTo(mark.y, 5);
    });
  });

  it("exports the same non-empty 64-way three-tip accepted prefix above the causal mark ceiling", () => {
    const tip = { shape: "round" as const, softness: 0 };
    const dynamics = normalizeStudioBrushDynamicsSettings({
      depositPipeline: STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V2,
      width: { base: 8, mappings: [] },
      opacity: { base: 0.8, mappings: [] },
      flow: { base: 0.7, mappings: [] },
      spacingRatio: null,
      spacing: { base: 1, mappings: [] },
      scatterRatio: null,
      scatter: { base: 0, mappings: [] },
      roundness: { base: 1, mappings: [] },
      tip,
      tipLayers: [
        { tip, opacity: 1 },
        { tip, opacity: 0.5 },
      ],
      grain: { amount: 0 },
      taper: { enabled: false },
    });
    const dynamic = rectEl({
      id: "causal-prefix-over-mark-budget-svg",
      kind: "freehand",
      brush: "ink-particle",
      mode: "pen",
      fill: undefined,
      points: [10, 60, 370, 60],
      pressures: [0.72, 0.72],
      stroke: "#315f73",
      strokeWidth: 8,
      opacity: 0.44,
      sampleSpacing: 1,
      paintModel: "bounded-flow-v2",
      brushDynamics: dynamics,
      symmetry: {
        type: "kaleidoscope",
        centerX: 190,
        centerY: 60,
        // 32 radial sectors × mirrors = 64 complete symmetry copies.
        radialCount: 32,
      },
    });
    const causal = planStudioCausalDynamicBrushDepositsV2({
      points: dynamic.points,
      pressures: dynamic.pressures,
      settings: dynamics,
      maximumDabs: STUDIO_CAUSAL_DYNAMIC_BRUSH_MAX_DABS,
    });
    expect(causal.ok).toBe(true);
    if (!causal.ok) throw new Error(causal.reason);
    const budget = planStudioDynamicBrushRenderBudget({
      settings: dynamics,
      dabCount: causal.dabs.length,
      symmetryCount: 64,
      markBudget: STUDIO_DYNAMIC_BRUSH_CAUSAL_MARK_BUDGET,
    });
    expect(budget.acceptedPrefixReceipt).toBeDefined();

    const exported = exportPageToSvg(page([dynamic], { width: 380, height: 120 }));
    const ellipseCount = (
      exported.svg.match(/data-brush-coverage="ellipse"/gu) ?? []
    ).length;
    const acceptedMarkCount =
      budget.maxDabsPerVariation * budget.symmetryCount * budget.marksPerDab;

    expect(exported.skipped).toEqual([]);
    expect(ellipseCount).toBe(acceptedMarkCount);
    expect(ellipseCount).toBeGreaterThan(0);
    expect(ellipseCount).toBeLessThanOrEqual(
      STUDIO_DYNAMIC_BRUSH_CAUSAL_MARK_BUDGET,
    );
    expect(exportPageToSvg(page([dynamic], { width: 380, height: 120 })).svg)
      .toBe(exported.svg);
  });

  it("2차 브러시 재질 — 색상 변화·고정 그레인·멀티 팁을 같은 결정적 SVG 마크로 내보낸다", () => {
    const base = studioBrushDynamicsPresetSettings("ink-particle");
    const phaseTwo = normalizeStudioBrushDynamicsSettings({
      ...base,
      taper: { enabled: false },
      tip: { shape: "round", softness: 0.1 },
      colorDynamics: {
        hueJitter: 70,
        saturationJitter: 0.2,
        valueJitter: 0.12,
      },
      grain: {
        space: "stroke-fixed",
        amount: 0.68,
        scale: 4.5,
        contrast: 0.72,
        seed: 57,
      },
      tipLayers: [
        { tip: { shape: "star", softness: 0.15 }, scale: 0.58, opacity: 0.65, offsetY: -0.5 },
        { tip: { shape: "grain", softness: 0.2 }, scale: 0.38, opacity: 0.45, offsetY: 0.55 },
      ],
      spacingRatio: null,
      spacing: { base: 9, mappings: [] },
      scatterRatio: null,
      scatter: { base: 0, mappings: [] },
    });
    const stroke = rectEl({
      id: "phase-two-svg",
      kind: "freehand",
      brush: "ink-particle",
      points: [10, 20, 55, 22],
      pressures: [0.7, 0.7],
      stroke: "#356dcc",
      strokeWidth: 12,
      brushDynamics: phaseTwo,
    });
    const singleTip = {
      ...stroke,
      brushDynamics: normalizeStudioBrushDynamicsSettings({ ...phaseTwo, tipLayers: [] }),
    };
    const first = exportPageToSvg(page([stroke])).svg;
    const replay = exportPageToSvg(page([JSON.parse(JSON.stringify(stroke))])).svg;
    const single = exportPageToSvg(page([singleTip])).svg;
    const fills = new Set(Array.from(
      first.matchAll(/<use data-brush-coverage="alpha-map"[^>]*color="(#[0-9a-f]{6})"/g),
      (match) => match[1]
    ));
    const opacities = new Set(Array.from(
      first.matchAll(/<use data-brush-coverage="alpha-map"[^>]*opacity="([0-9.]+)"/g),
      (match) => match[1]
    ));

    expect(first).toBe(replay);
    // Grain makes even the solid round primary use the causal full-alpha texture path.
    expect(first).not.toContain("<ellipse ");
    expect(fills.size).toBeGreaterThan(2);
    expect(opacities.size).toBeGreaterThan(5);
    expect((first.match(/data-brush-coverage="alpha-map"/g) ?? []).length).toBeGreaterThan(
      (single.match(/data-brush-coverage="alpha-map"/g) ?? []).length * 1.5
    );
  });

  it("입자 브러시 세로 대칭 — 원본 dab의 산포와 타원 축을 다시 추첨하지 않고 정확히 반사한다", () => {
    const dynamic = rectEl({
      id: "dynamic-vertical-affine",
      kind: "freehand",
      brush: "dry-media",
      points: [20, 30],
      pressures: [0.4],
      speeds: [0.9],
      tiltXs: [35],
      tiltYs: [20],
      stroke: "#352116",
      strokeWidth: 8,
      brushDynamics: ellipseDynamics("dry-media"),
      symmetry: { type: "vertical", centerX: 50, centerY: 50 },
    });
    const first = exportPageToSvg(page([dynamic])).svg;
    const second = exportPageToSvg(page([dynamic])).svg;
    const groups = dynamicEllipseGroups(first);
    expect(first).toBe(second);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveLength(1);
    expect(groups[1]).toHaveLength(1);

    const original = groups[0]![0]!;
    const mirrored = groups[1]![0]!;
    const source = { x: 20, y: 30 };
    const mirroredSource = { x: 80, y: 30 };
    const scatter = { x: original.cx - source.x, y: original.cy - source.y };
    const mirroredScatter = {
      x: mirrored.cx - mirroredSource.x,
      y: mirrored.cy - mirroredSource.y,
    };
    expect(Math.hypot(scatter.x, scatter.y)).toBeGreaterThan(0.01);
    expectNear(mirrored.cx, 100 - original.cx);
    expectNear(mirrored.cy, original.cy);
    expectNear(mirroredScatter.x, -scatter.x);
    expectNear(mirroredScatter.y, scatter.y);
    expect(mirrored.rx).toBe(original.rx);
    expect(mirrored.ry).toBe(original.ry);
    const originalAxis = axisVector(original.angle);
    const mirroredAxis = axisVector(mirrored.angle);
    expectNear(mirroredAxis.x, -originalAxis.x, 0.001);
    expectNear(mirroredAxis.y, originalAxis.y, 0.001);
  });

  it("입자 브러시 방사 대칭 — 산포 중심과 타원 축을 원본에서 90도 회전한 affine 복제본으로 만든다", () => {
    const dynamic = rectEl({
      id: "dynamic-radial-affine",
      kind: "freehand",
      brush: "dry-media",
      points: [20, 30],
      pressures: [0.4],
      speeds: [0.9],
      tiltXs: [35],
      tiltYs: [20],
      stroke: "#352116",
      strokeWidth: 8,
      brushDynamics: ellipseDynamics("dry-media"),
      symmetry: { type: "radial", centerX: 50, centerY: 50, radialCount: 4 },
    });
    const first = exportPageToSvg(page([dynamic])).svg;
    const groups = dynamicEllipseGroups(first);
    expect(first).toBe(exportPageToSvg(page([dynamic])).svg);
    expect(groups).toHaveLength(4);
    const original = groups[0]![0]!;
    const quarterTurn = groups[1]![0]!;
    const scatter = { x: original.cx - 20, y: original.cy - 30 };
    const rotatedScatter = { x: quarterTurn.cx - 70, y: quarterTurn.cy - 20 };
    expectNear(quarterTurn.cx, 100 - original.cy);
    expectNear(quarterTurn.cy, original.cx);
    expectNear(rotatedScatter.x, -scatter.y);
    expectNear(rotatedScatter.y, scatter.x);
    expect(quarterTurn.rx).toBe(original.rx);
    expect(quarterTurn.ry).toBe(original.ry);
    const originalAxis = axisVector(original.angle);
    const rotatedAxis = axisVector(quarterTurn.angle);
    expectNear(rotatedAxis.x, -originalAxis.y, 0.001);
    expectNear(rotatedAxis.y, originalAxis.x, 0.001);
  });

  it("입자 브러시 만화경 대칭 — 회전군 뒤 반사군도 같은 산포·축의 결정적 affine 복제본이다", () => {
    const dynamic = rectEl({
      id: "dynamic-kaleidoscope-affine",
      kind: "freehand",
      brush: "dry-media",
      points: [20, 30],
      pressures: [0.4],
      speeds: [0.9],
      tiltXs: [35],
      tiltYs: [20],
      stroke: "#352116",
      strokeWidth: 8,
      brushDynamics: ellipseDynamics("dry-media"),
      symmetry: { type: "kaleidoscope", centerX: 50, centerY: 50, radialCount: 3 },
    });
    const first = exportPageToSvg(page([dynamic])).svg;
    const groups = dynamicEllipseGroups(first);
    expect(first).toBe(exportPageToSvg(page([dynamic])).svg);
    expect(groups).toHaveLength(6);
    const original = groups[0]![0]!;
    // N개 회전 뒤 첫 반사는 중심을 지나는 수평축(axisAngle=0) 기준이다.
    const reflected = groups[3]![0]!;
    const scatter = { x: original.cx - 20, y: original.cy - 30 };
    const reflectedScatter = { x: reflected.cx - 20, y: reflected.cy - 70 };
    expectNear(reflected.cx, original.cx);
    expectNear(reflected.cy, 100 - original.cy);
    expectNear(reflectedScatter.x, scatter.x);
    expectNear(reflectedScatter.y, -scatter.y);
    expect(reflected.rx).toBe(original.rx);
    expect(reflected.ry).toBe(original.ry);
    const originalAxis = axisVector(original.angle);
    const reflectedAxis = axisVector(reflected.angle);
    expectNear(reflectedAxis.x, originalAxis.x, 0.001);
    expectNear(reflectedAxis.y, -originalAxis.y, 0.001);
  });

  it("형광펜 — 한 번의 multiply wash와 둥근 superellipse 끝을 유지한다", () => {
    const hl = rectEl({
      id: "h1",
      kind: "freehand",
      brush: "highlighter",
      materialPressureModel: STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
      points: [0, 0, 10, 0, 20, 10, 30, 30],
    });
    const { svg } = exportPageToSvg(page([hl]));
    expect(svg).toContain('data-brush-engine="highlighter-wash-ribbon-v2"');
    expect(svg).toContain('data-highlighter-cap="round-superellipse"');
    expect(svg).toContain('data-highlighter-wash="single-fill"');
    expect(svg).toContain('fill-rule="nonzero"');
    expect(svg).not.toContain("data-pressure-endcap=");
    expect(svg).not.toContain("stroke-linecap=");
    expect(svg).toContain("mix-blend-mode:multiply");
  });

  it.each(["pencil-2b", "neon", "glow"] as const)(
    "%s — legacy geometry를 유지하고 canonical-v1만 pressure ribbon을 쓴다",
    (brush) => {
      const renderPressure = (
        pressure: number,
        pressureModel = false,
        materialMinimumDiameterRatio?: number,
      ) => exportPageToSvg(page([
        rectEl({
          id: `legacy-geometry-${brush}`,
          kind: "freehand",
          brush,
          points: [0, 0, 12, 8, 24, -2, 40, 6],
          pressures: [pressure, pressure, pressure, pressure],
          ...(pressureModel
            ? {
                materialPressureModel:
                  STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
                ...(materialMinimumDiameterRatio === undefined
                  ? {}
                  : { materialMinimumDiameterRatio }),
              }
            : {}),
          sampleSpacing: 1,
          stroke: "#13579b",
          strokeWidth: 12,
          opacity: 0.7,
          fill: undefined,
        }),
      ])).svg;
      const legacyLight = renderPressure(0);
      const legacyHeavy = renderPressure(1);
      const canonicalLight = renderPressure(0, true);
      const canonicalHeavy = renderPressure(1, true);

      expect(legacyLight).toBe(legacyHeavy);
      expect(legacyLight).not.toContain('stroke-linecap="butt"');
      expect(legacyLight).not.toMatch(/data-(?:pencil|pressure)-endcap=/u);
      if (brush === "pencil-2b") {
        expect(canonicalLight).toContain(
          'data-brush-engine="retained-pressure-ribbon-v1"',
        );
        expect(canonicalLight).toContain("data-pencil-ribbon-cell=");
        expect(canonicalLight).not.toContain('stroke-linecap="butt"');
        expect(canonicalLight).toMatch(/data-pencil-endcap=/u);
      } else {
        expect(canonicalLight).toContain(
          'data-luminous-ribbon="single-fill"',
        );
        expect(canonicalLight).toContain('data-luminous-cap="round"');
        expect(canonicalLight).not.toContain("stroke-linecap=");
        expect(canonicalLight).not.toContain("data-pressure-endcap=");
      }
      expect(canonicalLight).not.toBe(canonicalHeavy);
      const sliderZero = renderPressure(0, true, 0);
      const sliderFull = renderPressure(0, true, 1);
      const widths = (svg: string) => Array.from(
        svg.matchAll(/stroke-width="([^"]+)"/gu),
        (match) => Number(match[1]),
      );
      const opacities = (svg: string) => Array.from(
        svg.matchAll(/opacity="([^"]+)"/gu),
        (match) => Number(match[1]),
      );
      const luminousGeometry = (svg: string) => Array.from(
        svg.matchAll(/data-luminous-ribbon="single-fill"[^>]*d="([^"]+)"/gu),
        (match) => match[1],
      );
      if (brush === "pencil-2b") {
        expect(widths(sliderFull)).not.toEqual(widths(sliderZero));
      } else {
        expect(luminousGeometry(sliderFull)).not.toEqual(
          luminousGeometry(sliderZero),
        );
      }
      expect(opacities(sliderFull)).toEqual(opacities(sliderZero));
    },
  );

  it("highlighter — legacy와 canonical 모두 one-wash이고 canonical만 필압 폭·농도를 보존한다", () => {
    const renderPressure = (
      pressure: number,
      pressureModel = false,
    ) => exportPageToSvg(page([
      rectEl({
        id: "highlighter-wash-version",
        kind: "freehand",
        brush: "highlighter",
        points: [0, 0, 12, 8, 24, -2, 40, 6],
        pressures: [pressure, pressure, pressure, pressure],
        ...(pressureModel
          ? {
              materialPressureModel:
                STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
            }
          : {}),
        sampleSpacing: 1,
        stroke: "#13579b",
        strokeWidth: 12,
        opacity: 0.7,
        fill: undefined,
      }),
    ])).svg;
    const legacyLight = renderPressure(0);
    const legacyHeavy = renderPressure(1);
    const canonicalLight = renderPressure(0, true);
    const canonicalHeavy = renderPressure(1, true);

    expect(legacyLight).toBe(legacyHeavy);
    expect(canonicalLight).not.toBe(canonicalHeavy);
    for (const svg of [legacyLight, canonicalLight, canonicalHeavy]) {
      expect(svg).toContain('data-brush-engine="highlighter-wash-ribbon-v2"');
      expect(svg).toContain('data-highlighter-wash="single-fill"');
      expect(svg).not.toContain("data-pressure-endcap=");
      expect(svg).not.toContain("stroke-linecap=");
    }
  });

  it.each([
    "neon",
    "glow",
    "soft-glow",
  ] as const)(
    "%s — SVG도 retained와 같은 pressure ribbon single-fill 및 round cap 정책을 쓴다",
    (brush) => {
      const exportPressure = (pressure: number) => exportPageToSvg(page([
        rectEl({
          id: `pressure-${brush}-${pressure}`,
          kind: "freehand",
          brush,
          points: [0, 0, 12, 8, 24, -2, 40, 6],
          pressures: [pressure, pressure, pressure, pressure],
          materialPressureModel: STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
          sampleSpacing: 1,
          stroke: "#13579b",
          strokeWidth: 12,
          opacity: 0.7,
          fill: undefined,
        }),
      ])).svg;
      const light = exportPressure(0);
      const heavy = exportPressure(1);
      const geometrySpans = (svg: string) => Array.from(
        svg.matchAll(/data-luminous-ribbon="single-fill"[^>]*d="([^"]+)"/gu),
        (match) => {
          const coordinates = Array.from(
            match[1]!.matchAll(/-?\d+(?:\.\d+)?/gu),
            (coordinateMatch) => Number(coordinateMatch[0]),
          );
          const xs = coordinates.filter((_, index) => index % 2 === 0);
          const ys = coordinates.filter((_, index) => index % 2 === 1);
          return Math.max(...xs) - Math.min(...xs)
            + Math.max(...ys) - Math.min(...ys);
        },
      );
      const pressureOpacities = (svg: string) => Array.from(
        svg.matchAll(
          /data-luminous-ribbon="single-fill"[^>]*opacity="([^"]+)"/gu,
        ),
        (match) => Number(match[1]),
      );
      // Derived, not pinned: the halo is resampled into shells so a three-ring stack does not
      // band, and the shell count is a tunable tradeoff. One single-fill per shell is the claim.
      const expectedPasses = brush === "neon"
        ? planNeonBrushPasses(12).length
        : planGlowBrushPasses(12, brush === "soft-glow").length;

      expect(Math.max(...geometrySpans(heavy))).toBeGreaterThan(
        Math.max(...geometrySpans(light)),
      );
      expect(Math.max(...pressureOpacities(heavy))).toBeGreaterThan(
        Math.max(...pressureOpacities(light)),
      );
      expect(heavy.match(/data-luminous-ribbon="single-fill"/gu))
        .toHaveLength(expectedPasses);
      expect(heavy.match(/data-luminous-cap="round"/gu))
        .toHaveLength(expectedPasses);
      expect(heavy).not.toContain('stroke-linecap="butt"');
      expect(heavy).not.toContain("data-pressure-endcap=");
      expect(heavy).not.toContain("stroke-linecap=");
    },
  );

  it.each([
    ["highlighter", "round-superellipse"],
    ["chisel-highlighter", "soft-flat"],
    ["pastel-highlighter", "pastel-natural"],
  ] as const)(
    "%s — SVG도 one-wash 가변폭 리본과 %s cap을 쓴다",
    (brush, expectedCap) => {
      const exportPressure = (pressure: number) => exportPageToSvg(page([
        rectEl({
          id: `pressure-${brush}-${pressure}`,
          kind: "freehand",
          brush,
          points: [0, 0, 12, 8, 24, -2, 40, 6],
          pressures: [pressure, pressure, pressure, pressure],
          materialPressureModel: STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
          sampleSpacing: 1,
          stroke: "#13579b",
          strokeWidth: 12,
          opacity: 0.7,
          fill: undefined,
        }),
      ])).svg;
      const geometry = (svg: string) => {
        const pathData = /data-highlighter-wash="single-fill"[^>]*><path d="([^"]+)"/u
          .exec(svg)?.[1] ?? "";
        const coordinates = Array.from(
          pathData.matchAll(/-?\d+(?:\.\d+)?/gu),
          (match) => Number(match[0]),
        );
        const xs = coordinates.filter((_, index) => index % 2 === 0);
        const ys = coordinates.filter((_, index) => index % 2 === 1);
        return {
          span:
            Math.max(...xs) - Math.min(...xs)
            + Math.max(...ys) - Math.min(...ys),
          pathData,
        };
      };
      const washOpacity = (svg: string) => Number(
        /fill="#13579b"[^>]*opacity="([^"]+)"/u.exec(svg)?.[1] ?? 0,
      );
      const light = exportPressure(0);
      const heavy = exportPressure(1);

      expect(geometry(heavy).span).toBeGreaterThan(geometry(light).span);
      expect(washOpacity(heavy)).toBeGreaterThan(washOpacity(light));
      expect(heavy).toContain(`data-highlighter-cap="${expectedCap}"`);
      expect(heavy.match(/data-highlighter-wash="single-fill"/gu)).toHaveLength(1);
      expect(heavy).not.toContain("data-pressure-endcap=");
      expect(heavy).not.toContain("stroke-linecap=");
    },
  );

  it("가변 필압 연필은 비중첩 리본 cell과 양 끝 cap만 내보낸다", () => {
    const { svg } = exportPageToSvg(page([
      rectEl({
        id: "pencil-pressure-joints",
        kind: "freehand",
        brush: "pencil-2b",
        points: [0, 0, 12, 8, 24, -2, 40, 6],
        pressures: [0.15, 0.45, 0.8, 1],
        materialPressureModel: STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
        sampleSpacing: 1,
        stroke: "#222222",
        strokeWidth: 12,
        opacity: 0.7,
        fill: undefined,
      }),
    ]));
    const passCount = new Set(
      Array.from(
        svg.matchAll(/data-pencil-pass="([^"]+)"/gu),
        (match) => match[1],
      ),
    ).size;

    expect(passCount).toBeGreaterThan(0);
    expect((svg.match(/data-pencil-pass=/gu) ?? []).length).toBeGreaterThan(
      passCount,
    );
    expect((svg.match(/data-pencil-endcap=/gu) ?? [])).toHaveLength(
      passCount * 2,
    );
    expect(svg).toContain('data-brush-engine="retained-pressure-ribbon-v1"');
    expect(svg).toContain("data-pencil-ribbon-cell=");
    expect(svg).not.toContain('stroke-linecap="butt"');
    expect(svg).not.toContain('stroke-linecap="round"');
  });

  it.each(["pencil-2b", "brush"] as const)(
    "%s 탭 — 최소 직경은 SVG geometry만 바꾸고 alpha는 그대로 둔다",
    (brush) => {
      const exportTap = (materialMinimumDiameterRatio: number) => (
        exportPageToSvg(page([rectEl({
          id: `minimum-tap-${brush}`,
          kind: "freehand",
          brush,
          points: [20, 24],
          pressures: [0],
          materialPressureModel: STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
          materialMinimumDiameterRatio,
          stroke: "#13579b",
          strokeWidth: 12,
          opacity: 0.7,
          fill: undefined,
        })])).svg
      );
      const paintedTags = (svg: string) => Array.from(
        svg.matchAll(/<(?:circle|ellipse|rect) [^>]*fill="#13579b"[^>]*\/>/gu),
        (match) => match[0],
      );
      const diameters = (svg: string) => paintedTags(svg).map((tag) => {
        const radius = /\br="([^"]+)"/u.exec(tag)?.[1];
        const radiusX = /\brx="([^"]+)"/u.exec(tag)?.[1];
        const width = /\bwidth="([^"]+)"/u.exec(tag)?.[1];
        return radius !== undefined
          ? Number(radius) * 2
          : radiusX !== undefined
            ? Number(radiusX) * 2
            : Number(width);
      });
      const alphas = (svg: string) => paintedTags(svg).map(
        (tag) => Number(/\bopacity="([^"]+)"/u.exec(tag)?.[1] ?? 1),
      );
      const sliderZero = exportTap(0);
      const sliderFull = exportTap(1);

      expect(Math.max(...diameters(sliderFull))).toBeGreaterThan(
        Math.max(...diameters(sliderZero)),
      );
      expect(alphas(sliderFull)).toEqual(alphas(sliderZero));
    },
  );

  it("highlighter 탭 — 최소 직경은 자연스러운 단일 footprint geometry만 바꾼다", () => {
    const exportTap = (materialMinimumDiameterRatio: number) => (
      exportPageToSvg(page([rectEl({
        id: "minimum-tap-highlighter",
        kind: "freehand",
        brush: "highlighter",
        points: [20, 24],
        pressures: [0],
        materialPressureModel: STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
        materialMinimumDiameterRatio,
        stroke: "#13579b",
        strokeWidth: 12,
        opacity: 0.7,
        fill: undefined,
      })])).svg
    );
    const footprint = (svg: string) => {
      const tag = /<path d="([^"]+)" fill="#13579b"[^>]*data-highlighter-wash="tap"[^>]*opacity="([^"]+)"\/>/u
        .exec(svg);
      const coordinates = Array.from(
        (tag?.[1] ?? "").matchAll(/-?\d+(?:\.\d+)?/gu),
        (match) => Number(match[0]),
      );
      const xs = coordinates.filter((_, index) => index % 2 === 0);
      const ys = coordinates.filter((_, index) => index % 2 === 1);
      return {
        diameter: Math.max(
          Math.max(...xs) - Math.min(...xs),
          Math.max(...ys) - Math.min(...ys),
        ),
        opacity: Number(tag?.[2] ?? 0),
      };
    };
    const sliderZero = footprint(exportTap(0));
    const sliderFull = footprint(exportTap(1));

    expect(sliderFull.diameter).toBeGreaterThan(sliderZero.diameter);
    expect(sliderFull.opacity).toBe(sliderZero.opacity);
  });

  it.each(["pencil", "neon", "glow"] as const)(
    "%s — modern sampleSpacing은 원본 샘플을 유지하면서 연결 곡선을 부드럽게 내보낸다",
    (brush) => {
      const base = rectEl({
        id: `render-path-${brush}`,
        kind: "freehand",
        brush,
        points: [0, 0, 10, 20, 20, -5, 30, 15],
        stroke: "#13579b",
        strokeWidth: 9,
        fill: undefined,
      });
      const modern = exportPageToSvg(page([{ ...base, sampleSpacing: 1.5 }])).svg;
      const legacy = exportPageToSvg(page([base])).svg;
      const brushPaths = (svg: string) => Array.from(
        svg.matchAll(/<path d="([^"]+)" fill="none" stroke="#13579b"/g),
        (match) => match[1]!
      );
      const modernPaths = brushPaths(modern);
      const legacyPaths = brushPaths(legacy);

      expect(modernPaths.length).toBeGreaterThan(0);
      expect(legacyPaths).toHaveLength(modernPaths.length);
      expect(modernPaths.every((pathD) => pathD.includes(" Q ") || pathD.includes(" C "))).toBe(true);
      expect(legacyPaths.every((pathD) => pathD.includes(" Q ") || pathD.includes(" C "))).toBe(true);
      expect(modernPaths).not.toEqual(legacyPaths);
    }
  );

  it("highlighter — modern sampleSpacing과 legacy smoothing 모두 one-wash outline으로 직렬화한다", () => {
    const base = rectEl({
      id: "render-path-highlighter",
      kind: "freehand",
      brush: "highlighter",
      points: [0, 0, 10, 20, 20, -5, 30, 15],
      stroke: "#13579b",
      strokeWidth: 9,
      fill: undefined,
    });
    const modern = exportPageToSvg(page([{ ...base, sampleSpacing: 1.5 }])).svg;
    const legacy = exportPageToSvg(page([base])).svg;
    const pathData = (svg: string) => (
      /data-highlighter-wash="single-fill"[^>]*><path d="([^"]+)"/u.exec(svg)?.[1]
      ?? ""
    );

    expect(pathData(modern)).toContain("L");
    expect(pathData(legacy)).toContain("L");
    expect(pathData(modern)).not.toBe(pathData(legacy));
    expect(modern).toContain('data-brush-engine="highlighter-wash-ribbon-v2"');
    expect(legacy).toContain('data-brush-engine="highlighter-wash-ribbon-v2"');
  });

  it("대칭을 선언한 획은 사본을 하나 더 내보낸다", () => {
    // 브러시 고유 대칭(#18a)이 기대는 계약. 렌더러들은 이미 요소의 symmetry 로 획을 부채질하므로,
    // 획 시작 시점에 그걸 기록하기만 하면 된다 — 이 단언이 그 "이미"를 고정한다.
    // 톤 프로브로는 검증할 수 없다: 프로브는 요소를 직접 만들고 pointer-start 플래너를 거치지 않아
    // 배선을 아예 보지 못한다.
    const base = rectEl({
      id: "sym-1",
      kind: "freehand",
      brush: "pen",
      points: [40, 40, 90, 70, 140, 50],
      pressures: [0.6, 0.8, 0.5],
      stroke: "#1b1b1f",
      strokeWidth: 8,
      fill: undefined,
    });
    const marks = (svg: string) => (svg.match(/<(?:path|use|circle|ellipse)/gu) ?? []).length;
    const plain = marks(exportPageToSvg(page([base])).svg);
    const mirrored = marks(exportPageToSvg(page([{
      ...base,
      symmetry: resolveStudioStrokeSymmetry(
        { type: "none", centerX: 360, centerY: 500, radialCount: 4 },
        "web-mirror-ink",
      ),
    }])).svg);

    expect(plain).toBeGreaterThan(0);
    expect(mirrored).toBeGreaterThan(plain);
  });

  it("kit-owned web brushes export kit geometry; mirror and kaleido stay on the page fold", () => {
    const marks = (svg: string) => (svg.match(/<(?:path|use|circle|ellipse)/gu) ?? []).length;
    const ownedId = STUDIO_WEB_DRAWING_KIT_OWNED_BRUSH_IDS[0];
    expect(ownedId).toBeDefined();
    const ownedCatalog = studioBrushDynamicsSettingsForBrushId(ownedId!);
    expect(ownedCatalog).not.toBeNull();
    const owned = rectEl({
      id: "kit-owned-export",
      kind: "freehand",
      brush: ownedId,
      points: [40, 40, 90, 70, 140, 50],
      pressures: [0.6, 0.8, 0.5],
      stroke: "#1b1b1f",
      strokeWidth: 8,
      fill: undefined,
      brushDynamics: ownedCatalog!,
    });
    const exported = exportPageToSvg(page([owned]));
    expect(exported.skipped.filter((skip) => skip.id === owned.id)).toEqual([]);
    expect(marks(exported.svg)).toBeGreaterThan(0);

    const seed = studioBrushDynamicsSeedFromKey(`${owned.id}:${ownedCatalog!.seed}`);
    const dynamics = normalizeStudioBrushDynamicsSettings({
      ...ownedCatalog!,
      seed,
      width: { ...ownedCatalog!.width, base: 8 },
    });
    const kitDabs = planStudioWebDrawingKitOwnedDabs(
      {
        brushId: ownedId,
        points: owned.points,
        pressures: owned.pressures,
        baseWidth: 8,
        baseOpacity: dynamics.opacity.base,
        seed,
      },
      dynamics,
    );
    expect(kitDabs).not.toBeNull();
    expect(kitDabs!.length).toBeGreaterThan(0);
    const exportedPoints = [...exported.svg.matchAll(/cx="([^"]+)" cy="([^"]+)"/g)].map((match) => ({
      x: Number(match[1]),
      y: Number(match[2]),
    }));
    expect(exportedPoints.length).toBeGreaterThan(0);
    // Stamp serialization paints samples around each kit station, not the station center itself.
    expect(exportedPoints.some((point) => kitDabs!.some((dab) => (
      Math.hypot(point.x - dab.x, point.y - dab.y) <= Math.max(dab.size, 4)
    )))).toBe(true);

    const pageCenter = { type: "none" as const, centerX: 360, centerY: 500, radialCount: 6 };
    for (const brushId of ["web-mirror-ink", "web-kaleido-ink"] as const) {
      const catalog = studioBrushDynamicsSettingsForBrushId(brushId);
      expect(catalog, brushId).not.toBeNull();
      const foldSettings = studioBrushDynamicsSettingsForBrushId(brushId)!;
      expect(planStudioWebDrawingKitOwnedDabs(
        {
          brushId,
          points: [40, 40, 90, 70, 140, 50],
          pressures: [0.6, 0.8, 0.5],
          baseWidth: 8,
          seed: 7,
        },
        foldSettings,
      ), brushId).toBeNull();

      const base = rectEl({
        id: `${brushId}-export`,
        kind: "freehand",
        brush: brushId,
        points: [40, 40, 90, 70, 140, 50],
        pressures: [0.6, 0.8, 0.5],
        stroke: "#1b1b1f",
        strokeWidth: 8,
        fill: undefined,
        brushDynamics: catalog!,
      });
      const plain = marks(exportPageToSvg(page([base])).svg);
      const folded = marks(exportPageToSvg(page([{
        ...base,
        symmetry: resolveStudioStrokeSymmetry(pageCenter, brushId),
      }])).svg);
      expect(plain, brushId).toBeGreaterThan(0);
      expect(folded, brushId).toBeGreaterThan(plain);
    }
  });

  it("네온 — 미리보기와 같은 2중 컬러 할로 + 밝힌 코어를 내보낸다", () => {
    const neon = rectEl({
      id: "neon-1",
      kind: "freehand",
      brush: "neon",
      points: [0, 10, 20, 0, 40, 16, 60, 8],
      materialPressureModel: STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
      stroke: "#39ff14",
      strokeWidth: 18,
    });
    const { svg } = exportPageToSvg(page([neon]));
    expect(svg).toContain('data-brush-engine="neon-halo"');
    expect((svg.match(/mix-blend-mode:normal/g) ?? [])).toHaveLength(3);
    expect((svg.match(
      /data-luminous-ribbon="single-fill"[^>]*data-luminous-composite="source-over"/g,
    ) ?? []))
      .toHaveLength(3);
    expect((svg.match(/<g[^>]*data-luminous-composite="source-over"/g) ?? []))
      .toHaveLength(1);
    expect(svg).not.toContain("mix-blend-mode:screen");
    expect((svg.match(/fill="#39ff14"/g) ?? [])).toHaveLength(2);
    // 코어는 예전에 리터럴 #fff 였고, 그게 결함이었다. 기본 캔버스가 흰 종이라 흰 코어는 코어가
    // 아니라 구멍이었고, 네온이 속이 뚫린 회색 관으로 그려졌다. 이제 코어는 획 색을 흰색 쪽으로
    // 섞은 색이며, 그 색은 플래너가 소유한다 — 여기서 리터럴을 다시 핀하면 렌더러 4곳에 상수가
    // 흩어져 있던 원래 상태로 되돌아간다. 프리뷰(StudioDrawNode)도 같은 함수를 쓴다.
    const core = studioLuminousCoreColor("#39ff14");
    expect(core).not.toBe("#39ff14");
    expect(svg).toContain(`fill="${core}"`);
    expect(svg).not.toContain('fill="#fff"');
    expect(svg.match(/data-luminous-ribbon="single-fill"/g)).toHaveLength(3);
    expect(svg).not.toContain("stroke-linecap=");
  });

  it("네온 탭 — 짧은 입력도 일반 원으로 축소하지 않고 3중 할로를 유지한다", () => {
    const neonTap = rectEl({
      id: "neon-tap-1",
      kind: "freehand",
      brush: "neon",
      points: [20, 24],
      stroke: "#39ff14",
      strokeWidth: 18,
    });
    const { svg } = exportPageToSvg(page([neonTap]));
    expect(svg).toContain('data-brush-engine="neon-halo"');
    expect((svg.match(/<circle /g) ?? []).length).toBe(3);
    expect((svg.match(/mix-blend-mode:normal/g) ?? [])).toHaveLength(3);
    expect(svg).not.toContain("mix-blend-mode:screen");
  });

  it("캘리그래피 — 포인트별 필압·틸트·회전을 겹침 없는 단일 리본으로 보존한다", () => {
    const calligraphy = rectEl({
      id: "calligraphy-1",
      kind: "freehand",
      brush: "calligraphy",
      points: [0, 0, 20, 0, 40, 20, 40, 50],
      pressures: [0.2, 0.45, 0.7, 0.95],
      tiltXs: [40, 35, 20, 10],
      tiltYs: [0, 10, 25, 40],
      twists: [0, 15, 30, 45],
      brushTip: { tiltEnabled: true, angleDeg: -30, roundness: 0.24 },
      strokeWidth: 12,
    });
    const first = exportPageToSvg(page([calligraphy]));
    const second = exportPageToSvg(page([calligraphy]));
    expect(first.svg).toBe(second.svg);
    expect(first.svg).toContain('data-brush-engine="calligraphy-ribbon"');
    expect(first.svg).toContain('fill-rule="nonzero"');
    expect(first.svg).not.toContain('stroke-linecap="round"');
    expect((first.svg.match(/ A /g) ?? []).length).toBe(4);
    expect(first.skipped).toEqual([]);
  });

  it.each(["brush", "flat-brush"] as const)(
    "%s — 역방향 재추적을 Canvas와 같은 양의 winding 단일 coverage로 내보낸다",
    (brush) => {
      const { svg, skipped } = exportPageToSvg(page([rectEl({
        id: `${brush}-svg-retrace`,
        kind: "freehand",
        brush,
        points: [0, 0, 24, 0, 0, 0, 24, 0],
        pressures: [0.6, 0.6, 0.6, 0.6],
        sampleSpacing: 1,
        stroke: "#2f6fed",
        strokeWidth: 10,
        opacity: 0.6,
      })]));
      const polygons = angledNibExportPolygons(svg);

      expect(skipped).toEqual([]);
      expect(svg).toContain('fill-rule="nonzero"');
      expect(svg.match(/data-brush-engine="angled-nib-local-coverage"/gu)).toHaveLength(1);
      expect(svg.match(/opacity="0.6"/gu)).toHaveLength(1);
      expect(polygons.length).toBeGreaterThanOrEqual(3);
      expect(polygons.every((polygon) => polygonSignedArea(polygon) > 0)).toBe(true);
      expect(polygonWindingAt(polygons, 12, 0)).toBeGreaterThan(0);
    },
  );

  it.each(["brush", "flat-brush"] as const)(
    "%s — retained SVG nib width responds only to versioned pressure journals",
    (brush) => {
      const render = (
        pressures: readonly number[],
        pressureModel = true,
        materialMinimumDiameterRatio?: number,
      ) => exportPageToSvg(page([rectEl({
        id: `${brush}-${pressures[0]}-pressure`,
        kind: "freehand",
        brush,
        points: [0, 0, 20, 0, 40, 0],
        pressures: [...pressures],
        ...(pressureModel
          ? {
              materialPressureModel:
                STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
              ...(materialMinimumDiameterRatio === undefined
                ? {}
                : { materialMinimumDiameterRatio }),
            }
          : {}),
        sampleSpacing: 1,
        stroke: "#111111",
        strokeWidth: 10,
      })])).svg;
      const light = angledNibExportPolygons(render([0, 0, 0]));
      const heavy = angledNibExportPolygons(render([1, 1, 1]));
      const polygonWidth = (polygon: readonly number[]) => Math.hypot(
        polygon[2]! - polygon[0]!,
        polygon[3]! - polygon[1]!,
      );

      expect(polygonWidth(heavy[0]!)).toBeGreaterThan(polygonWidth(light[0]!) * 2);
      expect(
        angledNibExportPolygons(render([0, 0, 0], false)),
      ).toEqual(
        angledNibExportPolygons(render([1, 1, 1], false)),
      );
      expect(
        polygonWidth(angledNibExportPolygons(render([0, 0, 0], true, 1))[0]!),
      ).toBeGreaterThan(
        polygonWidth(angledNibExportPolygons(render([0, 0, 0], true, 0))[0]!),
      );
    },
  );

  it.each(["brush", "flat-brush"] as const)(
    "%s — 자기교차 후에도 교차부의 SVG non-zero coverage를 유지한다",
    (brush) => {
      const { svg } = exportPageToSvg(page([rectEl({
        id: `${brush}-svg-self-cross`,
        kind: "freehand",
        brush,
        points: [0, 0, 24, 24, 0, 24, 24, 0, 0, 0],
        pressures: [0.7, 0.7, 0.7, 0.7, 0.7],
        sampleSpacing: 1,
        stroke: "#111111",
        strokeWidth: 10,
      })]));
      const polygons = angledNibExportPolygons(svg);

      expect(polygons.length).toBeGreaterThanOrEqual(4);
      expect(polygons.every((polygon) => polygonSignedArea(polygon) > 0)).toBe(true);
      expect(polygonWindingAt(polygons, 12, 12)).toBeGreaterThan(0);
    },
  );

  it("스크린톤 브러시 — 결정적 망점을 원(circle)으로 그대로 재현한다", () => {
    const tone = rectEl({ id: "st1", kind: "freehand", brush: "screentone", points: [0, 0, 40, 0], strokeWidth: 22 });
    const { svg } = exportPageToSvg(page([tone]));
    const expected = screentoneDotsForStroke([0, 0, 40, 0], 11, Math.max(3, 22 * 0.42)).length / 2;
    expect((svg.match(/<circle /g) ?? []).length).toBe(expected);
  });

  it("지우개 자국은 그리지 않고 skipped로 정직하게 집계한다", () => {
    const eraser = rectEl({ id: "e1", kind: "freehand", mode: "eraser", points: [0, 0, 10, 0, 20, 10] });
    const result = exportPageToSvg(page([eraser]));
    expect(result.svg).not.toContain("<path");
    expect(result.skipped).toEqual([{ id: "e1", type: "draw", mode: "skipped", label: "지우개 자국은 벡터로 재현할 수 없어 제외했어요." }]);
  });

  it("대칭 드로잉 — 세로 대칭이면 미러 사본까지 두 개를 그린다", () => {
    const sym = rectEl({ symmetry: { type: "vertical", centerX: 360, centerY: 0 } });
    const { svg } = exportPageToSvg(page([sym]));
    expect((svg.match(/<rect x="/g) ?? []).length).toBe(2);
    expect(svg).toContain('<rect x="610"'); // 360*2-110 = 610 (미러된 박스 왼쪽)
  });

  it("손상 문서의 극단 radialCount도 방사 32개·만화경 64개로 제한한다", () => {
    const radial = exportPageToSvg(page([rectEl({
      symmetry: { type: "radial", centerX: 360, centerY: 500, radialCount: 1_000_000_000 },
    })])).svg;
    const kaleidoscope = exportPageToSvg(page([rectEl({
      symmetry: { type: "kaleidoscope", centerX: 360, centerY: 500, radialCount: 1_000_000_000 },
    })])).svg;

    expect((radial.match(/<rect x=/g) ?? []).length).toBe(32);
    expect((kaleidoscope.match(/<rect x=/g) ?? []).length).toBe(64);
  });

  it("66,305-dab causal-v3 SVG keeps flat-reference bytes without production flatMap", () => {
    const dynamics = normalizeStudioBrushDynamicsSettings({
      ...studioBrushDynamicsPresetSettings("ink-particle"),
      depositPipeline: STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3,
      width: { base: 2, mappings: [] },
      opacity: { base: 1, mappings: [] },
      flow: { base: 1, mappings: [] },
      spacingRatio: null,
      spacing: { base: 0.25, mappings: [] },
      scatterRatio: null,
      scatter: { base: 0, mappings: [] },
      roundness: { base: 1, mappings: [] },
      tip: { shape: "round", softness: 0 },
      grain: { amount: 0 },
      tipLayers: [],
      dualBrush: { enabled: false },
      taper: { enabled: false },
    });
    const points = Array.from({ length: 149 }, (_, index) => [
      index % 2 === 0 ? 8 : 120,
      64,
    ]).flat();
    const pressures = Array.from({ length: points.length / 2 }, () => 0.72);
    const dynamic = rectEl({
      id: "causal-v3-segmented-byte-reference",
      kind: "freehand",
      brush: "ink-particle",
      mode: "pen",
      fill: undefined,
      points,
      pressures,
      stroke: "#3257d6",
      strokeWidth: 2,
      opacity: 0.37,
      sampleSpacing: 1,
      paintModel: "bounded-flow-v2",
      brushDynamics: dynamics,
    });
    const retainedAuthority = planStudioDynamicBrushRender(
      dynamic as DrawEl,
      "ink-particle",
      false,
    );
    expect(retainedAuthority.status).toBe("ready");
    if (retainedAuthority.status !== "ready") return;
    const replayDynamics = retainedAuthority.plan.dynamics;
    const continuation = planStudioCausalDynamicBrushDepositSegmentsV3({
      points,
      pressures,
      settings: replayDynamics,
    });
    expect(continuation.ok).toBe(true);
    if (!continuation.ok) throw new Error(continuation.reason);
    expect(continuation.dabCount).toBe(66_305);
    expect(continuation.segments).toHaveLength(2);

    // Build the historical flattened reference only in the test oracle. Production must preserve
    // continuation boundaries and pass them straight to the coverage planner.
    const flatReference = new Array<StudioDynamicBrushDab>(
      continuation.dabCount,
    );
    let referenceOffset = 0;
    for (const segment of continuation.segments) {
      for (const plannedDab of segment.dabs) {
        flatReference[referenceOffset] = plannedDab;
        referenceOffset += 1;
      }
    }
    expect(referenceOffset).toBe(continuation.dabCount);
    const referenceVariations = studioDynamicBrushDabVariations(
      flatReference,
      dynamic.symmetry,
    );
    const renderBudget = planStudioDynamicBrushRenderBudget({
      settings: replayDynamics,
      dabCount: continuation.dabCount,
      symmetryCount: referenceVariations.length,
      markBudget: STUDIO_DYNAMIC_BRUSH_CAUSAL_CONTINUATION_MARK_BUDGET,
    });
    expect(renderBudget.maxDabsPerVariation).toBe(continuation.dabCount);
    const referenceCoverage =
      planStudioDynamicBrushCoverageAndLegacyMarks({
        dabVariations: referenceVariations,
        dynamics: replayDynamics,
        materialIdentity: retainedAuthority.plan.materialIdentity,
        dynamicSeed: retainedAuthority.plan.seed,
        stroke: dynamic.stroke,
        stampGrid: renderBudget.stampGrid,
        markBudget: STUDIO_DYNAMIC_BRUSH_CAUSAL_CONTINUATION_MARK_BUDGET,
      }).coveragePlan;
    expect(referenceCoverage.ok).toBe(true);
    if (!referenceCoverage.ok) {
      throw new Error(`flat reference rejected: ${referenceCoverage.reason}`);
    }
    expect(referenceCoverage.marks).toHaveLength(continuation.dabCount);

    const input = page([dynamic], { width: 128, height: 128 });
    const first = exportPageToSvg(input);
    const second = exportPageToSvg(input);
    expect(first).toEqual(second);
    expect(first.skipped).toEqual([]);
    expect(first.caveats).toEqual([]);

    const groupPrefix =
      `<g opacity="${referenceDabOpacity(dynamic.opacity ?? 1)}">`
      + `<ellipse data-brush-coverage="ellipse"`;
    const groupStart = first.svg.indexOf(groupPrefix);
    expect(groupStart).toBeGreaterThanOrEqual(0);
    const groupEnd = first.svg.indexOf("</g>", groupStart);
    expect(groupEnd).toBeGreaterThan(groupStart);
    const actualHash = createHash("sha256")
      .update(first.svg.slice(groupStart, groupEnd + 4))
      .digest("hex");
    const referenceHash = createHash("sha256");
    referenceHash.update(
      `<g opacity="${referenceDabOpacity(dynamic.opacity ?? 1)}">`,
    );
    for (const plannedMark of referenceCoverage.marks) {
      appendReferenceEllipseCoverage(
        referenceHash,
        plannedMark,
        retainedAuthority.plan.materialIdentity,
      );
    }
    referenceHash.update("</g>");
    expect(actualHash).toBe(referenceHash.digest("hex"));

    const source = readFileSync(
      new URL("./studio-svg-export.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(
      /segments\.flatMap\(\(segment\) => segment\.dabs\)/u,
    );
    expect(source).toContain("svgSegmentedDynamicDabVariations");
  }, 30_000);

  it("segmented causal 텍스처가 전체 획 예산을 넘으면 비어 있지 않은 accepted prefix를 내보낸다", () => {
    const dynamics = normalizeStudioBrushDynamicsSettings({
      ...studioBrushDynamicsPresetSettings("ink-particle"),
      depositPipeline: STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3,
      spacing: { base: 0.5, mappings: [] },
      tip: { shape: "grain", softness: 0.2 },
    });
    const dynamic = rectEl({
      id: "bounded-dynamic-svg",
      kind: "freehand",
      brush: "ink-particle",
      points: [0, 0, 100_000, 0],
      strokeWidth: 12,
      brushDynamics: dynamics,
      symmetry: {
        type: "radial",
        centerX: 360,
        centerY: 500,
        radialCount: 15,
      },
    });
    const continuation = planStudioCausalDynamicBrushDepositSegmentsV3({
      points: dynamic.points,
      pressures: dynamic.pressures,
      settings: dynamics,
    });
    expect(continuation.ok).toBe(true);
    if (!continuation.ok) throw new Error(continuation.reason);
    const budget = planStudioDynamicBrushRenderBudget({
      settings: dynamics,
      dabCount: continuation.dabCount,
      symmetryCount: 15,
      markBudget: STUDIO_DYNAMIC_BRUSH_CAUSAL_CONTINUATION_MARK_BUDGET,
    });
    expect(budget.maxDabsPerVariation).toBeGreaterThan(
      continuation.segments[0]!.nextDabIndex,
    );
    expect(budget.maxDabsPerVariation).toBeLessThan(continuation.dabCount);

    const result = exportPageToSvg(page([dynamic]));
    const marks = (
      result.svg.match(/data-brush-coverage="(?:alpha-map|analytic-radial|ellipse)"/gu)
      ?? []
    ).length;

    expect(marks).toBeGreaterThan(0);
    expect(marks).toBeLessThanOrEqual(
      STUDIO_DYNAMIC_BRUSH_CAUSAL_CONTINUATION_MARK_BUDGET,
    );
    expect(result.skipped).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 해석적 soft-falloff 톤 패리티 — 핀 스트로크의 SVG 스커트는 Canvas 스탬프와 같은 램프다
// ---------------------------------------------------------------------------

describe("해석적 soft-falloff 톤 패리티", () => {
  /**
   * airbrush 프리셋(fresh-authoring 민트 사이트) 스냅샷을 그대로 쓰면 핀 스트로크,
   * `softFalloffLinearProgram`만 제거하면 톤 없는 레거시(pre-wave 스냅샷) 스트로크다.
   * 둘 다 같은 soft 팁·softness라 해석적 falloff exponent는 동일하다.
   */
  function softFalloffFixture(id: string, pinned: boolean): SvgDrawTestEl {
    const settings = studioBrushDynamicsPresetSettings("airbrush");
    if (!pinned) settings.softFalloffLinearProgram = undefined;
    return rectEl({
      id,
      kind: "freehand",
      brush: "airbrush",
      points: [12, 18, 46, 30, 84, 22],
      pressures: [0.5, 0.85, 0.6],
      stroke: "#336699",
      strokeWidth: 24,
      brushDynamics: normalizeStudioBrushDynamicsSettings(settings),
    });
  }

  function analyticFalloffMarks(fixture: SvgDrawTestEl) {
    const marks = canvasCoverageMarksForSvgFixture(fixture)
      .filter((mark) => mark.falloff?.kind === "analytic-radial");
    if (marks.length === 0) throw new Error("fixture planned no analytic falloff marks");
    const exponents = new Set(marks.map((mark) => mark.falloff!.exponent));
    if (exponents.size !== 1) throw new Error("fixture exponent is not uniform");
    return marks;
  }

  function analyticRadialUses(svg: string): string[] {
    return Array.from(
      svg.matchAll(/<use data-brush-coverage="analytic-radial"[^>]*\/>/gu),
      (match) => match[0],
    );
  }

  function analyticRadialSymbolId(use: string): string {
    const symbolId = /\bhref="#(sbt\d+)"/u.exec(use)?.[1];
    if (!symbolId) throw new Error("missing analytic-radial symbol reference");
    return symbolId;
  }

  function embeddedSymbolPixelBytes(svg: string, symbolId: string): Buffer {
    const dataUrl = new RegExp(
      `<symbol data-brush-tip-asset="full-alpha-map-v1" id="${symbolId}"[^>]*>`
        + `.*?<image [^>]*href="([^"]+)"`,
      "u",
    ).exec(svg)?.[1];
    if (!dataUrl) throw new Error(`missing embedded asset for #${symbolId}`);
    return Buffer.from(decodeEmbeddedRgbaPng(dataUrl).pixels);
  }

  function referenceStampBytes(
    exponent: number,
    tone?: StudioBrushSoftFalloffStampTone,
  ): Buffer {
    // Canvas 경로의 스탬프 원천과 동일한 호출 — `prepareStudioBrushSoftFalloffTintedStampSurface`
    // 는 `acquireSoftFalloffMaskSurface`를 통해 정확히 이 래스터를 표면에 올린다.
    const raster = rasterizeStudioBrushSoftFalloffMaskRgba(
      exponent,
      STUDIO_BRUSH_SOFT_FALLOFF_STAMP_RESOLUTION,
      tone,
    );
    if (!raster) throw new Error("reference stamp raster unavailable");
    return Buffer.from(
      raster.pixels.buffer,
      raster.pixels.byteOffset,
      raster.pixels.byteLength,
    );
  }

  it("핀 스트로크 — 내보낸 텍스처가 Canvas 스탬프 경로와 같은 linear-accumulation 마스크 바이트다", () => {
    const fixture = softFalloffFixture("soft-falloff-pinned", true);
    const falloffMarks = analyticFalloffMarks(fixture);
    expect(falloffMarks.every((mark) => (
      mark.falloff?.tone === STUDIO_BRUSH_SOFT_FALLOFF_LINEAR_ACCUMULATION_TONE
    ))).toBe(true);
    const exponent = falloffMarks[0]!.falloff!.exponent;

    const { svg, skipped } = exportPageToSvg(page([fixture]));
    const uses = analyticRadialUses(svg);

    expect(skipped).toEqual([]);
    expect(exportPageToSvg(page([fixture])).svg).toBe(svg);
    expect(uses).toHaveLength(falloffMarks.length);
    // 마크 단위 왕복 — 모든 핀 마크가 자신의 톤을 문서에 직렬화한다.
    for (const use of uses) {
      expect(use).toContain(
        ` data-brush-falloff-tone="${STUDIO_BRUSH_SOFT_FALLOFF_LINEAR_ACCUMULATION_TONE}"`,
      );
    }
    // 텍스처 패리티 — 내보낸 PNG 픽셀이 Canvas 스탬프 래스터와 바이트 단위로 같고,
    // 레거시 sRGB 램프와는 실제로 달라야 한다(공허 통과 방지).
    const exported = embeddedSymbolPixelBytes(svg, analyticRadialSymbolId(uses[0]!));
    expect(exported.equals(referenceStampBytes(
      exponent,
      STUDIO_BRUSH_SOFT_FALLOFF_LINEAR_ACCUMULATION_TONE,
    ))).toBe(true);
    expect(exported.equals(referenceStampBytes(exponent))).toBe(false);
  });

  it("톤 없는 레거시 마크 — 오늘의 sRGB 스커트 마크업·텍스처 바이트를 그대로 유지한다", () => {
    const fixture = softFalloffFixture("soft-falloff-legacy", false);
    const falloffMarks = analyticFalloffMarks(fixture);
    expect(falloffMarks.every((mark) => mark.falloff?.tone === undefined)).toBe(true);
    const exponent = falloffMarks[0]!.falloff!.exponent;

    const { svg, skipped } = exportPageToSvg(page([fixture]));
    const uses = analyticRadialUses(svg);

    expect(skipped).toEqual([]);
    expect(uses).toHaveLength(falloffMarks.length);
    // 바이트 동일성 잠금 — 톤 속성이 전혀 붙지 않고 coverage 주석과 재질 주석이 오늘의
    // 인접성을 그대로 유지해 레거시 마크업이 이 웨이브 이전과 문자 단위로 같다.
    expect(svg).not.toContain("data-brush-falloff-tone");
    for (const use of uses) {
      expect(use).toMatch(
        /^<use data-brush-coverage="analytic-radial" data-brush-material="airbrush" href="#sbt\d+" x="/u,
      );
    }
    const exported = embeddedSymbolPixelBytes(svg, analyticRadialSymbolId(uses[0]!));
    expect(exported.equals(referenceStampBytes(exponent))).toBe(true);
  });

  it("같은 exponent의 핀·레거시 스트로크가 한 문서에서 서로 다른 텍스처 자산을 쓴다", () => {
    const pinnedEl = softFalloffFixture("soft-falloff-pinned-pair", true);
    const legacyEl = softFalloffFixture("soft-falloff-legacy-pair", false);
    const pinnedExponent = analyticFalloffMarks(pinnedEl)[0]!.falloff!.exponent;
    expect(analyticFalloffMarks(legacyEl)[0]!.falloff!.exponent).toBe(pinnedExponent);

    const { svg, skipped } = exportPageToSvg(page([pinnedEl, legacyEl]));
    const uses = analyticRadialUses(svg);
    const symbolIds = new Set(uses.map(analyticRadialSymbolId));

    expect(skipped).toEqual([]);
    // 톤이 캐시 키 네임스페이스를 가르지 않으면 두 스트로크가 자산 하나를 공유해 실패한다.
    expect(symbolIds.size).toBe(2);
    const [firstId, secondId] = [...symbolIds];
    expect(
      embeddedSymbolPixelBytes(svg, firstId!)
        .equals(embeddedSymbolPixelBytes(svg, secondId!)),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 그라데이션·패턴 defs — 우선순위: 패턴 > 그라데이션 > 단색
// ---------------------------------------------------------------------------

describe("그라데이션·패턴 채우기", () => {
  const gradient = { type: "linear" as const, angleDeg: 90, stops: [{ offset: 0, color: "#ff0000" }, { offset: 1, color: "#0000ff" }] };

  it("선형 그라데이션 — CSS 각도 규약 지오메트리를 userSpaceOnUse 좌표로 담는다", () => {
    const { svg } = exportPageToSvg(page([rectEl({ gradient })]));
    expect(svg).toContain('gradientUnits="userSpaceOnUse" x1="10" y1="50" x2="110" y2="50"');
    expect(svg).toContain('<stop offset="0%" stop-color="#ff0000"/>');
    expect(svg).toMatch(/<rect [^>]*fill="url\(#sg\d+\)"/);
  });

  it("방사 그라데이션 — farthest-corner 반지름으로 radialGradient를 만든다", () => {
    const radial = { ...gradient, type: "radial" as const };
    const { svg } = exportPageToSvg(page([rectEl({ kind: "ellipse", gradient: radial })]));
    expect(svg).toMatch(/<radialGradient [^>]*cx="60" cy="50" r="58.31"/); // hypot(50,30)
  });

  it("패턴 — 타일 마크업을 defs <pattern>으로 임베드하고 노드 원점에 정렬한다", () => {
    const { svg } = exportPageToSvg(page([rectEl({ pattern: { patternId: "dots", fg: "#112233", scale: 2 } })]));
    expect(svg).toContain('patternUnits="userSpaceOnUse" width="32" height="32" patternTransform="translate(10 20)"');
    expect(svg).toContain('<circle cx="4" cy="4" r="2.2" fill="#112233"/>');
    expect(svg).toMatch(/<rect [^>]*fill="url\(#sp\d+\)"/);
  });

  it("비정사각 triangle/polygon 패턴 원점은 캔버스 노드와 같은 bbox 중심이다", () => {
    const pattern = { patternId: "dots" as const, fg: "#112233", scale: 1 };
    const { svg } = exportPageToSvg(page([
      rectEl({ id: "triangle-pattern", kind: "triangle", points: [10, 20, 310, 110], pattern }),
      rectEl({
        id: "polygon-pattern",
        kind: "polygon",
        points: [30, 160, 150, 460],
        pattern,
        shapeParams: { starPoints: 5, starInnerRatio: 0.5, polygonSides: 5, cornerRadius: 3 },
      }),
    ]));

    expect(svg).toContain('patternTransform="translate(160 65)"');
    expect(svg).toContain('patternTransform="translate(90 310)"');
  });

  it("패턴이 그라데이션보다 이긴다(캔버스 fillPriority 규약)", () => {
    const { svg } = exportPageToSvg(page([rectEl({ gradient, pattern: { patternId: "checker", fg: "#000000", scale: 1 } })]));
    expect(svg).toMatch(/<rect [^>]*fill="url\(#sp\d+\)"/);
    expect(svg).not.toContain("<linearGradient");
  });
});

// ---------------------------------------------------------------------------
// 텍스트 — 여러 줄/정렬/자간/이스케이프/그라데이션/곡선 텍스트/세로쓰기
// ---------------------------------------------------------------------------

describe("텍스트 직렬화", () => {
  it("여러 줄 텍스트 — 줄 중앙 배치(Konva 산식)와 가운데 정렬 anchor를 담는다", () => {
    const { svg } = exportPageToSvg(page([textEl()]));
    expect(svg).toContain('<g transform="translate(10 20)">');
    expect(svg).toContain('text-anchor="middle"');
    expect(svg).toContain('<tspan x="100" y="19.2">안녕</tspan>');
    expect(svg).toContain('<tspan x="100" y="43.2">웹툰</tspan>');
    expect(svg).toContain('letter-spacing="1"');
    expect(svg).toContain('font-family="Pretendard, sans-serif"');
    expect(svg).toContain('font-weight="bold"');
    expect(svg).toContain('xml:space="preserve"');
  });

  it("가로 루비 — 독음을 원문 위의 작은 SVG 텍스트로 보존하고 advance 근사를 고지한다", () => {
    const { svg, skipped } = exportPageToSvg(
      page([
        textEl({
          text: "漢字",
          align: "left",
          rubySpans: [{ start: 0, end: 2, ruby: "かんじ" }],
        }),
      ]),
    );

    expect(svg).toContain('font-size="9"');
    expect(svg).toContain(">かんじ</tspan>");
    expect(
      skipped.some(
        (entry) => entry.mode === "approximated" && entry.label.includes("가로 루비"),
      ),
    ).toBe(true);
  });

  it("XML 특수문자를 철저히 이스케이프한다", () => {
    const { svg } = exportPageToSvg(page([textEl({ text: `<b>&"quote"&'q'</b>`, align: "left" })]));
    expect(svg).toContain("&lt;b&gt;&amp;&quot;quote&quot;&amp;&apos;q&apos;&lt;/b&gt;");
    expect(svg).not.toContain("<b>");
  });

  it("SFX 외곽선 — stroke를 fill보다 먼저 칠한다(paint-order)", () => {
    const { svg } = exportPageToSvg(page([textEl({ stroke: "#000000", strokeWidth: 3 })]));
    expect(svg).toContain('stroke="#000000" stroke-width="3" paint-order="stroke"');
  });

  it("그라데이션 텍스트 — 레거시 2색 필드도 엔진 스펙으로 변환해 defs를 만든다", () => {
    const { svg } = exportPageToSvg(page([textEl({ text: "A", width: 100, fillType: "gradient", align: "left" })]));
    expect(svg).toContain('x1="50" y1="0" x2="50" y2="26"'); // vertical 180° · bbox 100×26
    expect(svg).toContain('stop-color="#ff3b30"');
    expect(svg).toContain('stop-color="#ffcc00"');
    expect(svg).toMatch(/<text [^>]*fill="url\(#sg\d+\)"/);
  });

  it("곡선 텍스트 — buildTextPathData 경로를 defs에 두고 textPath로 흘린다", () => {
    const { svg } = exportPageToSvg(page([textEl({ textPath: { shape: "arcUp", curve: 70 }, align: "center" })]));
    expect(svg).toMatch(/<path id="stp\d+" d="M 0 [^"]+" fill="none"\/>/);
    expect(svg).toMatch(/<textPath href="#stp\d+" startOffset="50%" text-anchor="middle">/);
  });

  it("세로쓰기 — 열을 우→좌로 쌓고 각 열을 <g transform>으로 옮긴다", () => {
    const { svg } = exportPageToSvg(
      page([textEl({ text: "안녕\n웹툰", vertical: true, align: "left", lineHeight: 1.4, letterSpacing: 0 })])
    );
    // 1열(오른쪽, centerX=42) → 2열(왼쪽, centerX=14). 각 열은 글자를 "\n"으로 쌓은 한 노드.
    expect(svg).toContain('<g transform="translate(32 0)">');
    expect(svg).toContain('<g transform="translate(4 0)">');
    expect(svg).toContain(">안</tspan>");
    expect(svg).toContain(">녕</tspan>");
    expect(svg).toContain(">웹</tspan>");
    expect(svg).toContain(">툰</tspan>");
    expect(svg).not.toContain("rotate(90)");
  });

  it("세로쓰기 — 라틴/숫자 런은 90° 회전, 마침표는 우상단으로 옮긴다", () => {
    const { svg } = exportPageToSvg(
      page([textEl({ text: "가OK9나。", vertical: true, align: "left", lineHeight: 1.4, letterSpacing: 0 })])
    );
    // 한 열(centerX=14, x=4) — 직립 "가" 다음 20px 지점에서 회전 런이 시작한다.
    expect(svg).toContain('<g transform="translate(4 20) rotate(90)">');
    expect(svg).toContain(">OK9</tspan>");
    // 마침표는 (+0.5em, −0.5em): x는 4+10, y는 직립+회전 런(20+33) 다음에서 10px 위로.
    expect(svg).toContain('<g transform="translate(14 63)">');
    expect(svg).toContain(">。</tspan>");
  });

  it("세로쓰기 — 독립된 네 자리 숫자는 한 셀 안에 縦中横으로 가로 배치한다", () => {
    const { svg, skipped } = exportPageToSvg(
      page([textEl({ text: "가2026나", vertical: true, align: "left", lineHeight: 1.4 })]),
    );
    expect(svg).toMatch(/<g transform="translate\(4 21\) scale\(0\.\d+ 1\)">/u);
    expect(svg).toContain(">2026</tspan>");
    expect(svg).not.toContain('translate(4 21) rotate(90)');
    expect(
      skipped.some(
        (entry) => entry.id === "t1" && entry.mode === "approximated" && entry.label.includes("세로쓰기"),
      ),
    ).toBe(true);
  });

  it("세로쓰기 — 라틴 폭 근사를 정직하게 고지하고, 한글만이면 고지하지 않는다", () => {
    const mixed = exportPageToSvg(page([textEl({ text: "가OK나", vertical: true })]));
    expect(
      mixed.skipped.some((s) => s.id === "t1" && s.mode === "approximated" && s.label.includes("세로쓰기"))
    ).toBe(true);

    const hangulOnly = exportPageToSvg(page([textEl({ text: "가나다", vertical: true })]));
    expect(hangulOnly.skipped.some((s) => s.id === "t1" && s.label.includes("세로쓰기"))).toBe(false);
  });

  it("세로쓰기 — 열 길이 예산(el.width)을 넘기면 새 열로 넘긴다", () => {
    const { svg } = exportPageToSvg(
      page([
        textEl({ text: "가나다라마바", vertical: true, align: "left", width: 60, lineHeight: 1.4, letterSpacing: 0 }),
      ])
    );
    // 60px = 20px 글자 3개 → 2열. 열 폭 28px 이라 블록 폭 56px, 오른쪽 열이 x=32.
    expect(svg).toContain('<g transform="translate(32 0)">');
    expect(svg).toContain('<g transform="translate(4 0)">');
    expect(svg.match(/<g transform="translate\(\d+(?:\.\d+)? 0\)">/gu)).toHaveLength(2);
  });

  it("세로쓰기 루비 — 실제 열 레이아웃 오른쪽에 독음 글리프를 세로로 보존한다", () => {
    const { svg, skipped } = exportPageToSvg(
      page([
        textEl({
          text: "漢字",
          vertical: true,
          align: "left",
          width: 80,
          lineHeight: 1.4,
          letterSpacing: 0,
          rubySpans: [{ start: 0, end: 2, ruby: "かんじ" }],
        }),
      ]),
    );

    expect(svg).toContain('font-size="9"');
    expect(svg).toContain(">か</tspan>");
    expect(svg).toContain(">ん</tspan>");
    expect(svg).toContain(">じ</tspan>");
    expect(skipped.some((entry) => entry.label.includes("세로 루비"))).toBe(false);
  });

  it("세로쓰기 루비 — surrogate pair를 가르는 범위는 조용히 버리지 않고 skipped로 보고한다", () => {
    const { svg, skipped } = exportPageToSvg(
      page([
        textEl({
          text: "😀字",
          vertical: true,
          width: 80,
          rubySpans: [{ start: 1, end: 2, ruby: "え" }],
        }),
      ]),
    );

    expect(svg).not.toContain(">え</tspan>");
    expect(
      skipped.some(
        (entry) => entry.mode === "skipped" && entry.label.includes("split-surrogate-pair"),
      ),
    ).toBe(true);
  });

  it("자동 줄바꿈이 필요한 긴 문장은 근사로 정직하게 고지한다", () => {
    const result = exportPageToSvg(page([textEl({ text: "가나다라마바사아자차카타파하", width: 100, align: "left" })]));
    expect(result.skipped.some((s) => s.id === "t1" && s.mode === "approximated" && s.label.includes("자동 줄바꿈"))).toBe(true);
  });

  it("그림자 — feDropShadow 필터(σ=blur/2)로 근사한다", () => {
    const { svg } = exportPageToSvg(
      page([textEl({ shadowColor: "#ff00ff", shadowBlur: 10, shadowOffsetX: 2, shadowOffsetY: 3, shadowOpacity: 0.5 })])
    );
    expect(svg).toContain('<feDropShadow dx="2" dy="3" stdDeviation="5" flood-color="#ff00ff" flood-opacity="0.5"/>');
    expect(svg).toMatch(/<text [^>]*filter="url\(#sf\d+\)"/);
  });

  it("스티커 — Konva 기본값(Arial·검정)으로 텍스트 노드를 만든다", () => {
    const { svg } = exportPageToSvg(
      page([{ id: "s1", type: "sticker", text: "🔥", x: 30, y: 40, fontSize: 48, rotation: 15 }])
    );
    expect(svg).toContain('<g transform="translate(30 40) rotate(15)">');
    expect(svg).toContain('font-family="Arial"');
    expect(svg).toContain('fill="black"');
    expect(svg).toContain(">🔥</tspan>");
  });
});

// ---------------------------------------------------------------------------
// 말풍선 — bubblePathData 재사용/변형/테마
// ---------------------------------------------------------------------------

describe("말풍선 직렬화", () => {
  it("speech — 본체+꼬리 단일 path(bubblePathData)와 안쪽 텍스트를 담는다", () => {
    const { svg } = exportPageToSvg(page([bubbleEl()]));
    const expected = bubblePathData(200, 120, 18, { direction: "bottom", ratio: 0.35, length: 30, base: 28.8, side: "center" });
    expect(svg).toContain(`<path d="${expected}" fill="#ffffff" stroke="#1f1a16" stroke-width="2.5"`);
    expect(svg).toContain('<tspan x="100" y="67.14">야!</tspan>');
    expect(svg).toContain('letter-spacing="0.3"');
  });

  it("가로 말풍선 루비 — 독음을 text box 위에 보존하고 근사 receipt를 반환한다", () => {
    const { svg, skipped } = exportPageToSvg(
      page([
        bubbleEl({
          text: "漢字",
          rubySpans: [{ start: 0, end: 2, ruby: "かんじ" }],
        }),
      ]),
    );

    expect(svg).toContain('font-size="10.8"');
    expect(svg).toContain(">かんじ</tspan>");
    expect(
      skipped.some(
        (entry) => entry.mode === "approximated" && entry.label.includes("말풍선 가로 루비"),
      ),
    ).toBe(true);
  });

  it("세로 말풍선 루비 — 캔버스와 같은 열 코어와 오른쪽 독음 오버레이를 내보낸다", () => {
    const { svg, skipped } = exportPageToSvg(
      page([
        bubbleEl({
          text: "漢字",
          vertical: true,
          height: 180,
          rubySpans: [{ start: 0, end: 2, ruby: "かんじ" }],
        }),
      ]),
    );

    expect(svg).toContain('font-size="10.8"');
    expect(svg).toContain(">漢</tspan>");
    expect(svg).toContain(">字</tspan>");
    expect(svg).toContain(">か</tspan>");
    expect(svg).toContain(">ん</tspan>");
    expect(svg).toContain(">じ</tspan>");
    expect(skipped.some((entry) => entry.label.includes("세로 루비"))).toBe(false);
  });

  it("speech — 편집한 꼬리 밑동과 곡률이 SVG path에 보존된다", () => {
    const { svg } = exportPageToSvg(page([bubbleEl({ tailBase: 42, tailBend: 0.65 })]));
    const expected = bubblePathData(200, 120, 18, {
      direction: "bottom",
      ratio: 0.35,
      length: 30,
      base: 42,
      side: "center",
      bend: 0.65,
    });
    expect(svg).toContain(`<path d="${expected}"`);
  });

  it("double — 긴 대사를 위한 이중 로브와 주 꼬리를 단일 path로 내보낸다", () => {
    const el = bubbleEl({ variant: "double", width: 260, height: 170, tailBase: 38, tailBend: -0.4 });
    const { svg } = exportPageToSvg(page([el]));
    const expected = doubleBubblePathData(260, 170, {
      direction: "bottom",
      ratio: 0.35,
      length: 30,
      base: 38,
      side: "center",
      bend: -0.4,
    });
    expect(svg).toContain(`<path d="${expected}"`);
  });

  it("whisper — 점선(8 5) 외곽선으로 그린다", () => {
    const { svg } = exportPageToSvg(page([bubbleEl({ variant: "whisper" })]));
    expect(svg).toContain('stroke-dasharray="8 5"');
  });

  it("shout — 20각 별을 path로 그린다", () => {
    const { svg } = exportPageToSvg(page([bubbleEl({ variant: "shout" })]));
    // 본체는 transform scale 대신 좌표가 스케일된 단일 path.
    expect(svg).toMatch(/<path d="M [\d.]+ 0 L /);
    const d = /<path d="([^"]+)"/.exec(svg)?.[1] ?? "";
    // 20각 별 = 40개 꼭짓점 → L 명령이 충분히 많다.
    expect((d.match(/ L /g) ?? []).length).toBeGreaterThanOrEqual(38);
    expect(d.trim().endsWith("Z")).toBe(true);
  });

  it("box — 테마별 모서리 반경(classic 4/vivid 3)을 반영한다", () => {
    const classic = exportPageToSvg(page([bubbleEl({ variant: "box" })]));
    const vivid = exportPageToSvg(page([bubbleEl({ variant: "box" })], { theme: "vivid" }));
    expect(classic.svg).toContain('rx="4"');
    expect(vivid.svg).toContain('rx="3"');
    expect(vivid.svg).toContain('stroke="#444444"');
  });

  it("thought — 타원 본체 + 꼬리 구름방울 3단을 그린다", () => {
    const { svg } = exportPageToSvg(page([bubbleEl({ variant: "thought" })]));
    // thoughtBubbleBodyPath: 반경 (w/2, h/2) = (100, 60)
    expect(svg).toContain("A 100 60 0 1 1 100 120");
    expect((svg.match(/<ellipse /g) ?? []).length).toBe(3);
  });

  it("빈 대사면 텍스트 노드를 만들지 않는다", () => {
    const { svg } = exportPageToSvg(page([bubbleEl({ text: "  " })]));
    expect(svg).not.toContain("<text");
  });
});

// ---------------------------------------------------------------------------
// 프레임·이미지
// ---------------------------------------------------------------------------

describe("프레임·이미지 직렬화", () => {
  it("프레임 — 클립 + 배경색 + 절반 인셋 테두리(점선 지원)를 담는다", () => {
    const { svg } = exportPageToSvg(
      page([{ id: "f1", type: "frame", x: 10, y: 10, width: 300, height: 200, bgColor: "#eeeeee", dashStyle: "dashed" }])
    );
    expect(svg).toMatch(/<clipPath id="sc\d+"><rect width="300" height="200"\/><\/clipPath>/);
    expect(svg).toContain('<rect width="300" height="200" fill="#eeeeee"/>');
    expect(svg).toContain('<rect x="1.5" y="1.5" width="297" height="197" rx="2.5" fill="none" stroke="#16100c" stroke-width="3" stroke-dasharray="10 5"/>');
    expect(svg).toMatch(/<g transform="translate\(10 10\)" clip-path="url\(#sc\d+\)">/);
  });

  it("사선(폴리곤) 프레임 — 폴리곤 클립·채움·테두리로 그린다", () => {
    const { svg } = exportPageToSvg(
      page([{ id: "f2", type: "frame", x: 0, y: 0, width: 300, height: 200, points: [0, 0, 300, 0, 280, 200, 20, 200] }])
    );
    expect(svg).toContain('<clipPath id="sc1"><polygon points="0,0 300,0 280,200 20,200"/></clipPath>');
    expect((svg.match(/<polygon points="0,0 300,0 280,200 20,200"/g) ?? []).length).toBe(3); // 클립+채움+테두리
  });

  it("프레임 배경 이미지 — cover-fit을 preserveAspectRatio slice로 재현하고 외부 URL은 고지한다", () => {
    const result = exportPageToSvg(
      page([{ id: "f3", type: "frame", x: 0, y: 0, width: 300, height: 200, bg: "https://cdn.example.com/bg.png" }])
    );
    expect(result.svg).toContain('preserveAspectRatio="xMidYMid slice"');
    expect(result.skipped.some((s) => s.id === "f3" && s.mode === "approximated" && s.label.includes("외부 주소"))).toBe(true);
  });

  it("이미지 — 회전·기울이기·반전·둥근 모서리·그림자를 벡터 속성으로 담는다", () => {
    const result = exportPageToSvg(
      page([
        {
          id: "i1",
          type: "image",
          src: "data:image/png;base64,AAA",
          x: 1,
          y: 2,
          width: 100,
          height: 50,
          rotation: 45,
          opacity: 0.5,
          flipped: true,
          cornerRadius: 8,
          shadowColor: "#000000",
          shadowBlur: 10,
          shadowOffsetX: 2,
          shadowOffsetY: 3,
          shadowOpacity: 0.6,
          skewX: 30,
        },
      ])
    );
    expect(result.svg).toContain('transform="translate(1 2) rotate(45) matrix(1 0 0.58 1 0 0)"');
    expect(result.svg).toContain('opacity="0.5"');
    expect(result.svg).toMatch(/<clipPath id="sc\d+"><rect width="100" height="50" rx="8"\/><\/clipPath>/);
    expect(result.svg).toContain('<feDropShadow dx="2" dy="3" stdDeviation="5" flood-color="#000000" flood-opacity="0.6"/>');
    expect(result.svg).toContain('href="data:image/png;base64,AAA"');
    expect(result.svg).toContain('preserveAspectRatio="none" transform="translate(100 0) scale(-1 1)"');
    expect(result.skipped).toEqual([]); // data URL + 필터 없음 → 완전 벡터(고지 없음)
  });

  it("픽셀 필터가 있는 이미지는 원본으로 근사하고 정직하게 고지한다", () => {
    const result = exportPageToSvg(
      page([{ id: "i2", type: "image", src: "data:image/png;base64,AAA", x: 0, y: 0, width: 10, height: 10, rotation: 0, brightness: 0.4 }])
    );
    expect(result.skipped.some((s) => s.id === "i2" && s.label.includes("픽셀 필터"))).toBe(true);
  });

  it("순서형 스마트 필터 스택도 원본 근사 경고 대상에서 빠지지 않는다", () => {
    const result = exportPageToSvg(page([{
      id: "i-smart",
      type: "image",
      src: "data:image/png;base64,AAA",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      rotation: 0,
      smartFilters: {
        version: 1,
        entries: [{
          id: "tone-a",
          engine: "brightness-contrast",
          enabled: true,
          params: { brightness: 0.2 },
        }],
      },
    }]));

    expect(result.skipped.some((skip) =>
      skip.id === "i-smart" && skip.label.includes("픽셀 필터")
    )).toBe(true);
  });

  it("외부 URL 이미지는 임베드가 아님을 고지한다", () => {
    const result = exportPageToSvg(
      page([{ id: "i3", type: "image", src: "https://cdn.example.com/a.png", x: 0, y: 0, width: 10, height: 10, rotation: 0 }])
    );
    expect(result.skipped.some((s) => s.id === "i3" && s.label.includes("외부 주소"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 집중선·속도선 — 시드 난수 재현
// ---------------------------------------------------------------------------

describe("집중선·속도선", () => {
  it("집중선 — lineCount만큼의 선을 시드 난수로 결정적으로 그린다", () => {
    const el: SvgExportEl = { id: "fl1", type: "focusLines", x: 5, y: 6, width: 400, height: 300, lineCount: 8, innerRadius: 50, outerRadius: 150, stroke: "#101010", strokeWidth: 2, noise: 10, rotation: 30 };
    const a = exportPageToSvg(page([el]));
    const b = exportPageToSvg(page([el]));
    expect(a.svg).toBe(b.svg);
    const d = /<path d="([^"]+)" fill="none" stroke="#101010"/.exec(a.svg)?.[1] ?? "";
    expect((d.match(/M /g) ?? []).length).toBe(8);
    expect(a.svg).toContain('transform="translate(5 6) rotate(30)"');
  });

  it("속도선 — 방향·개수를 유지하고 id가 다르면 배치도 달라진다", () => {
    const mk = (id: string): SvgExportEl => ({ id, type: "speedLines", x: 0, y: 0, width: 200, height: 100, lineCount: 5, direction: "horizontal", stroke: "#000000", strokeWidth: 2, rotation: 0 });
    const a = exportPageToSvg(page([mk("sl1")]));
    const b = exportPageToSvg(page([mk("sl2")]));
    const dA = /<path d="([^"]+)"/.exec(a.svg)?.[1] ?? "";
    expect((dA.match(/M /g) ?? []).length).toBe(5);
    expect(a.svg).not.toBe(b.svg);
  });
});

// ---------------------------------------------------------------------------
// 패널 클리핑·혼합 모드·아래로 클리핑
// ---------------------------------------------------------------------------

describe("레이어 규약(클립·혼합)", () => {
  const frame: SvgExportEl = { id: "f1", type: "frame", x: 0, y: 0, width: 300, height: 300 };

  it("패널 안 요소는 패널 rect로 클립된다(wrapClip 규약)", () => {
    const { svg } = exportPageToSvg(page([frame, textEl({ x: 50, y: 50, width: 100, align: "left" })]));
    expect((svg.match(/clip-path="url\(#/g) ?? []).length).toBe(2); // 프레임 자체 + 패널 클립
    expect(svg).toMatch(/<clipPath id="sc\d+"><rect x="0" y="0" width="300" height="300"\/><\/clipPath>/);
  });

  it("noClip 요소는 패널 클립을 받지 않는다", () => {
    const { svg } = exportPageToSvg(page([frame, textEl({ x: 50, y: 50, width: 100, align: "left", noClip: true })]));
    expect((svg.match(/clip-path="url\(#/g) ?? []).length).toBe(1); // 프레임 자체만
  });

  it("혼합 모드는 CSS mix-blend-mode로 매핑한다", () => {
    const { svg } = exportPageToSvg(page([rectEl({ blendMode: "multiply" })]));
    expect(svg).toContain('<g style="mix-blend-mode:multiply">');
  });

  it("표현 불가한 혼합 모드는 보통 합성으로 그리고 근사 고지한다", () => {
    const result = exportPageToSvg(page([rectEl({ blendMode: "destination-out" })]));
    expect(result.svg).not.toContain("mix-blend-mode");
    expect(result.skipped.some((s) => s.id === "d1" && s.label.includes("혼합 모드"))).toBe(true);
  });

  it("아래 레이어 클리핑(clipBelow)은 근사로 고지한다", () => {
    const result = exportPageToSvg(page([rectEl({ id: "base" }), rectEl({ id: "top", clipBelow: true })]));
    expect(result.skipped.some((s) => s.id === "top" && s.mode === "approximated" && s.label.includes("클리핑"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 결과 메타 — 글꼴/주의사항/메시지/파일명/MIME
// ---------------------------------------------------------------------------

describe("결과 메타·헬퍼", () => {
  it("사용 글꼴을 수집하고 임베드 불가 주의사항을 담는다", () => {
    const result = exportPageToSvg(page([textEl({ font: "Jua" }), bubbleEl()]));
    expect(result.fontFamilies).toContain("Jua");
    expect(result.fontFamilies).toContain("Pretendard, sans-serif");
    expect(result.caveats.some((c) => c.includes("글꼴"))).toBe(true);
  });

  it("도형만 있으면 글꼴 주의사항이 없다", () => {
    const result = exportPageToSvg(page([rectEl()]));
    expect(result.fontFamilies).toEqual([]);
    expect(result.caveats).toEqual([]);
  });

  it("svgExportResultMessage — 전부 벡터 보존/제외/근사를 정직하게 요약한다", () => {
    const clean = exportPageToSvg(page([rectEl()]));
    expect(svgExportResultMessage(clean)).toBe("SVG 저장 완료 — 요소 1개 벡터 변환 · 전부 벡터 보존");
    const mixed = exportPageToSvg(
      page([
        rectEl({ id: "e1", kind: "freehand", mode: "eraser", points: [0, 0, 10, 0, 20, 10] }),
        { id: "i2", type: "image", src: "data:image/png;base64,AAA", x: 0, y: 0, width: 10, height: 10, rotation: 0, brightness: 0.4 },
      ])
    );
    expect(svgExportResultMessage(mixed)).toBe("SVG 저장 완료 — 요소 2개 벡터 변환 · 제외 1개 · 근사 1개");
  });

  it("svgExportFileName — 래스터 내보내기와 같은 제목 규칙(.svg)", () => {
    expect(svgExportFileName("  ")).toBe("toonspectrum-comic.svg");
    expect(svgExportFileName(" 나의 웹툰 ")).toBe("나의 웹툰.svg");
  });

  it("escapeXml — 다섯 가지 특수문자를 전부 치환한다", () => {
    expect(escapeXml(`<a & "b" 'c'>`)).toBe("&lt;a &amp; &quot;b&quot; &apos;c&apos;&gt;");
  });

  it("SVG MIME 타입을 노출한다(콜러 Blob 생성용)", () => {
    expect(SVG_EXPORT_MIME).toBe("image/svg+xml;charset=utf-8");
  });

  it("결과 타입 — 스킵 항목은 id/type/mode/label을 갖춘다", () => {
    const result: SvgExportResult = exportPageToSvg(page([rectEl({ id: "e1", kind: "freehand", mode: "eraser", points: [0, 0, 10, 0, 20, 10] })]));
    expect(result.skipped[0]).toMatchObject({ id: "e1", type: "draw", mode: "skipped" });
    expect(result.elementCount).toBe(1);
  });
});
