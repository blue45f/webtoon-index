// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";


import { exportPageToSvg } from "../export/studio-svg-export";
import {
  planStudioCausalDynamicBrushDepositSegmentsV3,
  planStudioCausalDynamicBrushDepositsV2,
  STUDIO_CAUSAL_DYNAMIC_BRUSH_MAX_DABS,
} from "../studio-causal-dynamic-brush-deposit-v2";
import {
  clearStudioDynamicCoverageCommittedCache,
  studioDynamicCoverageCommittedCacheStats,
} from "../studio-dynamic-brush-coverage-renderer";
import { planGlowBrushPasses, planNeonBrushPasses } from "../studio-fx-brush";
import { STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1 } from "../studio-material-pressure-model";
import {
  captureStudioOutlineStrokeContractV1,
  planStudioPerfectFreehandRender,
} from "../studio-outline-stroke-contract";
import { peekStudioPerfectFreehandStroker } from "../studio-perfect-freehand";

import {
  applyStudioBrushAliasWatercolorMaterial,
  mapStudioBrushAliasPressureSamples,
} from "./studio-brush-alias-profile";
import {
  normalizeStudioBrushDynamicsSettings,
  STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V2,
  STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3,
  studioBrushDynamicsPresetSettings,
} from "./studio-brush-dynamics";
import {
  planStudioDynamicBrushRenderBudget,
  STUDIO_DYNAMIC_BRUSH_CAUSAL_CONTINUATION_MARK_BUDGET,
  STUDIO_DYNAMIC_BRUSH_CAUSAL_MARK_BUDGET,
  STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID,
  STUDIO_DYNAMIC_BRUSH_LIVE_MARK_BUDGET,
} from "./studio-brush-render-budget";
import { clearStudioBrushTextureStampCache } from "./studio-brush-textured-stamp";
import { encodeStudioBrushTipAlphaMapBase64 } from "./studio-brush-tip-stamp";
import { planStudioInteractiveWetInkBrushReplay } from "./studio-wet-ink-backend-capability";
import { STUDIO_WET_RIBBON_OPACITY_BUCKET_COUNT, planStudioWetRibbonCarrier  } from "./studio-wet-ribbon-carrier";
import { STUDIO_PENCIL_RIBBON_ALPHA_BUCKET_COUNT, StudioDrawNode } from "./StudioDrawNode";

import type { DrawEl } from "../studio-element-model";
import type { StudioPatternSpec } from "../studio-pattern-fill";

interface CapturedKonvaNode {
  kind: string;
  props: Record<string, unknown>;
}

class StampSceneContext {
  readonly arcs: string[] = [];
  readonly drawImages: Array<{ alpha: number; args: readonly number[] }> = [];
  readonly fills: Array<{ alpha: number; color: string }> = [];
  readonly paths: number[][] = [];
  readonly transforms: string[] = [];
  saveCount = 0;
  restoreCount = 0;
  fillStyleWrites = 0;
  globalAlpha = 1;
  _context = {
    getTransform: () => ({
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      e: 0,
      f: 0,
    }) as DOMMatrix,
  };
  private currentFillStyle: string | CanvasGradient | CanvasPattern = "";
  private currentPath: number[] = [];

  get fillStyle(): string | CanvasGradient | CanvasPattern {
    return this.currentFillStyle;
  }
  set fillStyle(value: string | CanvasGradient | CanvasPattern) {
    this.currentFillStyle = value;
    this.fillStyleWrites += 1;
  }
  save(): void {
    this.saveCount += 1;
  }
  restore(): void {
    this.restoreCount += 1;
  }
  beginPath(): void {
    this.currentPath = [];
  }
  moveTo(x: number, y: number): void {
    this.currentPath.push(x, y);
  }
  lineTo(x: number, y: number): void {
    this.currentPath.push(x, y);
  }
  closePath(): void {
    this.paths.push([...this.currentPath]);
  }
  fill(): void {
    this.fills.push({ alpha: this.globalAlpha, color: String(this.fillStyle) });
  }
  arc(x: number, y: number, radius: number): void {
    this.arcs.push(`${x},${y},${radius}`);
  }
  ellipse(
    x: number,
    y: number,
    radiusX: number,
  ): void {
    this.arcs.push(`${x},${y},${radiusX}`);
  }
  drawImage(
    _image: CanvasImageSource,
    ...args: [number, number, number, number, number, number, number, number]
  ): void {
    this.drawImages.push({ alpha: this.globalAlpha, args });
  }
  translate(): void {}
  rotate(): void {}
  scale(): void {}
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.transforms.push(`${a},${b},${c},${d},${e},${f}`);
  }
  fillStrokeShape(): void {
    this.fills.push({ alpha: this.globalAlpha, color: String(this.fillStyle) });
  }
}

class AliasSceneContext {
  readonly arcs: Array<{ alpha: number; radius: number; x: number; y: number }> = [];
  readonly fillAlphas: number[] = [];
  readonly fillCompoundPaths: number[][] = [];
  readonly fillPolygons: number[][] = [];
  readonly fillRects: Array<{
    alpha: number;
    height: number;
    width: number;
    x: number;
    y: number;
  }> = [];
  readonly strokeAlphas: number[] = [];
  readonly strokeCaps: CanvasLineCap[] = [];
  readonly strokeWidths: number[] = [];
  fillStyle: string | CanvasGradient | CanvasPattern = "";
  globalAlpha = 1;
  lineCap: CanvasLineCap = "butt";
  lineJoin: CanvasLineJoin = "miter";
  lineWidth = 1;
  strokeStyle: string | CanvasGradient | CanvasPattern = "";
  private activePolygon: number[] = [];
  private activeCompoundPath: number[] = [];
  /**
   * 한 beginPath 안에서 moveTo 로 시작된 이전 서브패스들. 연필 리본은 알파 버킷별로 셀 수백 개를
   * 한 번의 fill 로 채우므로(e90aadbe 배칭), 마지막 서브패스만 기억하면 셀이 전부 사라진 것처럼
   * 읽힌다. `fillPolygons`/`fillCompoundPaths`/`fillAlphas` 는 예전처럼 fill 당 한 항목을 유지하고,
   * 서브패스 단위 기하는 `fillSubpathPolygons`/`fillSubpathAlphas` 로 따로 노출한다.
   */
  private pendingPolygons: number[][] = [];
  readonly fillSubpathPolygons: number[][] = [];
  readonly fillSubpathAlphas: number[] = [];

  save(): void {}
  restore(): void {}
  beginPath(): void {
    this.activePolygon = [];
    this.activeCompoundPath = [];
    this.pendingPolygons = [];
  }
  closePath(): void {}
  fill(): void {
    if (this.activePolygon.length >= 6) {
      this.fillPolygons.push([...this.activePolygon]);
      this.fillCompoundPaths.push([...this.activeCompoundPath]);
      this.fillAlphas.push(this.globalAlpha);
    }
    for (const polygon of [...this.pendingPolygons, this.activePolygon]) {
      if (polygon.length < 6) continue;
      this.fillSubpathPolygons.push([...polygon]);
      this.fillSubpathAlphas.push(this.globalAlpha);
    }
    this.pendingPolygons = [];
  }
  moveTo(x: number, y: number): void {
    if (this.activePolygon.length >= 6) this.pendingPolygons.push(this.activePolygon);
    this.activePolygon = [x, y];
    this.activeCompoundPath.push(x, y);
  }
  lineTo(x: number, y: number): void {
    this.activePolygon.push(x, y);
    this.activeCompoundPath.push(x, y);
  }
  quadraticCurveTo(): void {}
  bezierCurveTo(): void {}
  stroke(): void {
    this.strokeAlphas.push(this.globalAlpha);
    this.strokeCaps.push(this.lineCap);
    this.strokeWidths.push(this.lineWidth);
  }
  arc(x: number, y: number, radius: number): void {
    this.arcs.push({ alpha: this.globalAlpha, radius, x, y });
  }
  createRadialGradient(): CanvasGradient {
    return { addColorStop: () => undefined } as unknown as CanvasGradient;
  }
  fillRect(x: number, y: number, width: number, height: number): void {
    this.fillRects.push({ alpha: this.globalAlpha, height, width, x, y });
  }
}

class CalligraphySceneContext {
  readonly arcs: Array<{ radius: number; x: number; y: number }> = [];
  readonly lines: Array<{ x: number; y: number }> = [];
  fillCount = 0;
  fillStyle: string | CanvasGradient | CanvasPattern = "";

  beginPath(): void {}
  closePath(): void {}
  moveTo(): void {}
  lineTo(x: number, y: number): void {
    this.lines.push({ x, y });
  }
  arc(x: number, y: number, radius: number): void {
    this.arcs.push({ radius, x, y });
  }
  fill(): void {
    this.fillCount += 1;
  }
}

class AngledBrushSceneContext {
  readonly polygons: number[][] = [];
  fillCount = 0;
  private activePolygon: number[] = [];

  beginPath(): void {
    this.activePolygon = [];
  }
  moveTo(x: number, y: number): void {
    this.activePolygon = [x, y];
  }
  lineTo(x: number, y: number): void {
    this.activePolygon.push(x, y);
  }
  closePath(): void {
    this.polygons.push(this.activePolygon);
    this.activePolygon = [];
  }
  fillStrokeShape(): void {
    this.fillCount += 1;
  }
}

const konvaCapture = vi.hoisted(() => ({
  nodes: [] as CapturedKonvaNode[],
}));

const patternLoader = vi.hoisted(() => ({
  loads: [] as Array<{
    reject: (reason?: unknown) => void;
    resolve: (image: HTMLImageElement) => void;
    src: string;
  }>,
}));

const watercolorCapture = vi.hoisted(() => ({
  causalPlan: vi.fn((
    _input?: {
      baseWidth?: number;
      pressures?: readonly number[];
      spacing?: number;
      [key: string]: unknown;
    },
    _finalize?: boolean,
  ): Array<{
      opacity: number;
      radius: number;
      role: "core" | "diffuse";
      x: number;
      y: number;
    }> => []),
}));

vi.mock("react-konva/lib/ReactKonvaCore", async () => {
  const { Fragment, createElement } = await import("react");
  const capture = (kind: string, renderChildren = false) =>
    (props: Record<string, unknown>) => {
      konvaCapture.nodes.push({ kind, props });
      return renderChildren
        ? createElement(Fragment, null, props.children as import("react").ReactNode)
        : null;
    };

  return {
    Arrow: capture("Arrow"),
    Circle: capture("Circle"),
    Ellipse: capture("Ellipse"),
    Group: capture("Group", true),
    Line: capture("Line"),
    Path: capture("Path"),
    Rect: capture("Rect"),
    Shape: capture("Shape"),
    Star: capture("Star"),
  };
});

vi.mock("../studio-pattern-fill", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../studio-pattern-fill")>();
  return {
    ...actual,
    // Scale is applied through Konva props and intentionally does not change the tile bitmap URL.
    patternDataUrl: (pattern: StudioPatternSpec) =>
      `pattern:${pattern.patternId}:${pattern.fg}:${pattern.bg ?? "transparent"}`,
    loadPatternTileImage: (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
      patternLoader.loads.push({ reject, resolve, src });
    }),
  };
});

vi.mock("../studio-causal-watercolor-brush", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../studio-causal-watercolor-brush")>();
  return {
    ...actual,
    planCausalWatercolorBrushDabs: watercolorCapture.causalPlan,
  };
});

const wetWashCapture = vi.hoisted(() => ({
  livePlan: vi.fn((..._args: unknown[]): void => {}),
}));

vi.mock("./studio-wet-wash-live-pipeline", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./studio-wet-wash-live-pipeline")>();
  return {
    ...actual,
    // 스파이 후 실제 파이프라인으로 통과시킨다 — 배선 계약만 검증하고 동작은 실물을 쓴다.
    planStudioWetWashLivePipeline: ((strokeKey, params) => {
      wetWashCapture.livePlan(strokeKey, params);
      return actual.planStudioWetWashLivePipeline(strokeKey, params);
    }) as typeof actual.planStudioWetWashLivePipeline,
  };
});

function drawEl(overrides: Partial<DrawEl> = {}): DrawEl {
  return {
    id: "draw-1",
    type: "draw",
    points: [0, 0, 10, 0],
    stroke: "#123456",
    strokeWidth: 10,
    ...overrides,
  };
}

function segmentedCausalTestDynamics() {
  return normalizeStudioBrushDynamicsSettings({
    ...studioBrushDynamicsPresetSettings("ink-particle"),
    depositPipeline: STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3,
    width: { base: 2, mappings: [] },
    opacity: { base: 1, mappings: [] },
    flow: { base: 1, mappings: [] },
    tip: { shape: "round", softness: 0 },
    grain: { amount: 0 },
    tipLayers: [],
    dualBrush: { enabled: false },
    taper: { enabled: false },
    spacingRatio: null,
    spacing: { base: 0.25, mappings: [] },
    scatterRatio: null,
    scatter: { base: 0, mappings: [] },
    roundness: { base: 1, mappings: [] },
  });
}

/**
 * 148 alternating 112px legs produce 66,305 causal stations at 0.25px spacing. The path and its
 * four radial copies stay inside one logical tile while crossing both the historical 65,536-dab
 * document ceiling and the 262,144 tile-reference ceiling.
 */
function segmentedCausalLongRoute(): number[] {
  return Array.from({ length: 149 }, (_, index) => [
    index % 2 === 0 ? 8 : 120,
    64,
  ]).flat();
}

function pattern(overrides: Partial<StudioPatternSpec> = {}): StudioPatternSpec {
  return {
    patternId: "dots",
    fg: "#111111",
    scale: 1,
    ...overrides,
  };
}

function captured(kind: string): CapturedKonvaNode[] {
  return konvaCapture.nodes.filter((node) => node.kind === kind);
}

interface PencilSvgPath {
  readonly coords: readonly number[];
  readonly opacity: number;
}

function pencilSvgPaths(
  svg: string,
  attribute: "data-pencil-ribbon-cell" | "data-pencil-endcap",
): PencilSvgPath[] {
  return Array.from(
    svg.matchAll(
      new RegExp(`<path d="([^"]+)"[^>]*${attribute}="[^"]+"[^>]*opacity="([^"]+)"[^>]*/>`, "gu"),
    ),
    (match) => ({
      coords: Array.from(
        match[1]!.matchAll(/-?\d+(?:\.\d+)?/gu),
        (numberMatch) => Number(numberMatch[0]),
      ),
      opacity: Number(match[2]),
    }),
  );
}

function roundedPolygon(points: readonly number[]): number[] {
  return points.map((coordinate) => Math.round(coordinate * 100) / 100 + 0);
}

function polygonKeys(polygons: readonly (readonly number[])[]): string[] {
  return polygons.map((polygon) => polygon.join(",")).sort();
}

/**
 * Canvas batches every pencil ribbon cell of a pass into one compound fill per alpha level
 * (2026-09-02 long-stroke batching) while SVG writes the exact per-cell alpha. The ladder is the
 * only permitted difference: at most STUDIO_PENCIL_RIBBON_ALPHA_BUCKET_COUNT fills per pass, every
 * fill alpha on a ladder step, and every exported cell present on Canvas within half a step —
 * under one 8-bit alpha level, so no cell that can change a pixel is dropped or visibly shifted.
 */
function expectPencilAlphaLadder(
  context: AliasSceneContext,
  svgPaths: readonly PencilSvgPath[],
  strokeOpacity: number,
  passCount: number,
): void {
  const ladder = STUDIO_PENCIL_RIBBON_ALPHA_BUCKET_COUNT;
  expect(context.fillAlphas.length).toBeLessThanOrEqual(ladder * passCount);
  const alphaByCell = new Map<string, number>();
  context.fillSubpathPolygons.forEach((polygon, subpathIndex) => {
    const alpha = context.fillSubpathAlphas[subpathIndex]!;
    expect(alpha * ladder).toBeCloseTo(Math.round(alpha * ladder), 6);
    alphaByCell.set(roundedPolygon(polygon).join(","), alpha);
  });
  for (const path of svgPaths) {
    const canvasAlpha = alphaByCell.get(path.coords.join(","));
    expect(canvasAlpha, `cell ${path.coords.join(",")} missing on Canvas`).toBeDefined();
    expect(Math.abs(path.opacity / strokeOpacity - canvasAlpha!))
      .toBeLessThanOrEqual(1 / (2 * ladder) + 1e-5);
  }
}

async function flushStampRenderer(): Promise<void> {
  await act(async () => {
    await import("../StudioStampDrawShape");
  });
}

beforeEach(() => {
  konvaCapture.nodes.length = 0;
  patternLoader.loads.length = 0;
  watercolorCapture.causalPlan.mockClear();
  wetWashCapture.livePlan.mockClear();
});

afterEach(() => {
  cleanup();
  clearStudioBrushTextureStampCache();
  vi.unstubAllGlobals();
});

describe("StudioDrawNode pattern image lifecycle", () => {
  it("ignores stale loads, reuses a scale-independent tile, and clears removed patterns", async () => {
    const firstPattern = pattern({ patternId: "dots", fg: "#111111" });
    const secondPattern = pattern({ patternId: "grid", fg: "#222222" });
    const view = render(
      <StudioDrawNode
        el={drawEl({ kind: "rect", pattern: firstPattern, points: [0, 0, 10, 10] })}
      />,
    );

    expect(patternLoader.loads.map((load) => load.src)).toEqual([
      "pattern:dots:#111111:transparent",
    ]);
    view.rerender(
      <StudioDrawNode
        el={drawEl({ kind: "rect", pattern: secondPattern, points: [0, 0, 10, 10] })}
      />,
    );
    expect(patternLoader.loads.map((load) => load.src)).toEqual([
      "pattern:dots:#111111:transparent",
      "pattern:grid:#222222:transparent",
    ]);

    const staleImage = { id: "stale" } as unknown as HTMLImageElement;
    await act(async () => {
      patternLoader.loads[0]!.resolve(staleImage);
      await Promise.resolve();
    });
    expect(captured("Rect").at(-1)!.props.fillPatternImage).toBeUndefined();

    const currentImage = { id: "current" } as unknown as HTMLImageElement;
    await act(async () => {
      patternLoader.loads[1]!.resolve(currentImage);
      await Promise.resolve();
    });
    expect(captured("Rect").at(-1)!.props.fillPatternImage).toBe(currentImage);

    view.rerender(
      <StudioDrawNode
        el={drawEl({
          kind: "rect",
          pattern: { ...secondPattern, scale: 2 },
          points: [0, 0, 10, 10],
        })}
      />,
    );
    expect(patternLoader.loads).toHaveLength(2);
    expect(captured("Rect").at(-1)!.props.fillPatternImage).toBe(currentImage);

    view.rerender(
      <StudioDrawNode el={drawEl({ kind: "rect", points: [0, 0, 10, 10] })} />,
    );
    expect(captured("Rect").at(-1)!.props.fillPatternImage).toBeUndefined();
  });

  it("keeps the fallback empty after a failed tile load or a late unmounted result", async () => {
    const first = render(
      <StudioDrawNode
        el={drawEl({
          kind: "rect",
          pattern: pattern({ patternId: "stripes" }),
          points: [0, 0, 10, 10],
        })}
      />,
    );
    await act(async () => {
      patternLoader.loads[0]!.reject(new Error("tile failed"));
      await Promise.resolve();
    });
    expect(captured("Rect").at(-1)!.props.fillPatternImage).toBeUndefined();
    first.unmount();

    const second = render(
      <StudioDrawNode
        el={drawEl({
          kind: "rect",
          pattern: pattern({ patternId: "checker" }),
          points: [0, 0, 10, 10],
        })}
      />,
    );
    const lateLoad = patternLoader.loads[1]!;
    second.unmount();
    await act(async () => {
      lateLoad.resolve({ id: "late" } as unknown as HTMLImageElement);
      await Promise.resolve();
    });
    expect(patternLoader.loads).toHaveLength(2);
  });

  it("reuses a resolved document tile synchronously for an exact transform draft", async () => {
    const resolvedPattern = pattern({ patternId: "honeycomb", fg: "#345678" });
    const source = drawEl({
      kind: "rect",
      pattern: resolvedPattern,
      points: [0, 0, 20, 10],
    });
    const documentView = render(
      <StudioDrawNode el={source} renderPurpose="document" />,
    );
    expect(patternLoader.loads.map((load) => load.src)).toEqual([
      "pattern:honeycomb:#345678:transparent",
    ]);

    const resolvedImage = { id: "resolved-document-pattern" } as unknown as HTMLImageElement;
    await act(async () => {
      patternLoader.loads[0]!.resolve(resolvedImage);
      await Promise.resolve();
    });
    expect(captured("Rect").at(-1)!.props.fillPatternImage).toBe(resolvedImage);
    documentView.unmount();
    konvaCapture.nodes.length = 0;

    render(
      <StudioDrawNode
        el={{ ...source, points: [4, 3, 36, 24] }}
        exposeSceneIdentity={false}
        renderPurpose="transform-draft"
      />,
    );

    expect(patternLoader.loads).toHaveLength(1);
    expect(captured("Rect").at(-1)!.props).toMatchObject({
      fillPatternImage: resolvedImage,
      fillPatternRepeat: "repeat",
      fillPriority: "pattern",
    });
  });

  it("shares a cold transform-draft tile load and ignores stale patterns on non-fill routes", async () => {
    const coldPattern = pattern({ patternId: "sparkles", fg: "#56789a" });
    const view = render(
      <>
        <StudioDrawNode
          el={drawEl({
            id: "draft-a",
            kind: "triangle",
            pattern: coldPattern,
            points: [0, 0, 20, 20],
          })}
          exposeSceneIdentity={false}
          renderPurpose="transform-draft"
        />
        <StudioDrawNode
          el={drawEl({
            id: "draft-b",
            kind: "polygon",
            pattern: coldPattern,
            points: [30, 0, 50, 20],
          })}
          exposeSceneIdentity={false}
          renderPurpose="transform-draft"
        />
      </>,
    );
    expect(patternLoader.loads.map((load) => load.src)).toEqual([
      "pattern:sparkles:#56789a:transparent",
    ]);

    const loadedImage = { id: "cold-transform-pattern" } as unknown as HTMLImageElement;
    await act(async () => {
      patternLoader.loads[0]!.resolve(loadedImage);
      await Promise.resolve();
    });
    expect(
      captured("Line").filter((node) => node.props.fillPatternImage === loadedImage),
    ).toHaveLength(2);

    view.rerender(
      <StudioDrawNode
        el={drawEl({
          id: "freehand-with-stale-pattern",
          kind: "freehand",
          pattern: pattern({ patternId: "clouds", fg: "#abcdef" }),
        })}
        exposeSceneIdentity={false}
        renderPurpose="transform-draft"
      />,
    );
    expect(patternLoader.loads).toHaveLength(1);
  });
});

/** Luminous lanes plan their own pass stacks; the count is derived so a shell retune stays honest. */
function luminousPassCount(brush: string, strokeWidth: number): number {
  return brush === "neon"
    ? planNeonBrushPasses(strokeWidth).length
    : planGlowBrushPasses(strokeWidth, brush === "soft-glow").length;
}

describe("StudioDrawNode orchestration", () => {
  it("keeps the hot-path React memo boundary", () => {
    expect((StudioDrawNode as unknown as { $$typeof: symbol }).$$typeof).toBe(
      Symbol.for("react.memo"),
    );
  });

  it("tags the retained vector layer for layer-scoped sampling and export", () => {
    render(<StudioDrawNode el={drawEl({ id: "ink-layer" })} />);

    expect(captured("Group")[0]?.props).toMatchObject({
      listening: false,
      studioElementId: "ink-layer",
    });
  });

  it("renders source-first and mirrored rectangle bounds", () => {
    render(
      <StudioDrawNode
        el={drawEl({
          kind: "rect",
          points: [2, 3, 8, 11],
          symmetry: { type: "vertical", centerX: 10, centerY: 0 },
        })}
      />,
    );

    expect(captured("Rect").map(({ props }) => ({
      height: props.height,
      width: props.width,
      x: props.x,
      y: props.y,
    }))).toEqual([
      { x: 2, y: 3, width: 6, height: 8 },
      { x: 12, y: 3, width: 6, height: 8 },
    ]);
  });

  it("routes arrow shapes to the registered Konva Arrow node", () => {
    render(
      <StudioDrawNode
        el={drawEl({
          kind: "arrow",
          points: [2, 3, 42, 23],
          stroke: "#654321",
          strokeWidth: 5,
        })}
      />,
    );

    expect(captured("Arrow")).toHaveLength(1);
    expect(captured("Arrow")[0]!.props).toMatchObject({
      fill: "#654321",
      points: [2, 3, 42, 23],
      pointerLength: 10,
      pointerWidth: 10,
      stroke: "#654321",
      strokeWidth: 5,
    });
  });

  it("routes ordinary and eraser taps to generic dots with the correct composite", () => {
    const pen = render(<StudioDrawNode el={drawEl({ points: [4, 7] })} />);
    expect(captured("Circle")).toHaveLength(1);
    expect(captured("Circle")[0]!.props).toMatchObject({
      fill: "#123456",
      globalCompositeOperation: "source-over",
      x: 4,
      y: 7,
    });

    pen.unmount();
    konvaCapture.nodes.length = 0;
    render(
      <StudioDrawNode
        el={drawEl({ mode: "eraser", points: [4, 7], stroke: "#ffffff" })}
      />,
    );
    expect(captured("Circle")).toHaveLength(1);
    expect(captured("Circle")[0]!.props).toMatchObject({
      fill: "#16100c",
      globalCompositeOperation: "destination-out",
    });
  });

  it("makes equal-size fineliner and bold-marker taps visibly distinct through alias profiles", () => {
    const fineliner = render(
      <StudioDrawNode
        el={drawEl({ brush: "fineliner", points: [4, 7], pressures: [0] })}
      />,
    );
    expect(captured("Circle")[0]!.props.radius).toBeCloseTo(3.408);

    fineliner.unmount();
    konvaCapture.nodes.length = 0;
    render(
      <StudioDrawNode
        el={drawEl({ brush: "marker-bold", points: [4, 7], pressures: [0] })}
      />,
    );
    expect(captured("Circle")[0]!.props.radius).toBeCloseTo(11.91);
  });

  it("renders perfect-ink short 2-point strokes through a visible generic-dot fallback", () => {
    render(
      <StudioDrawNode
        el={drawEl({
          brush: "perfect-ink",
          points: [4, 7, 13, 7],
          strokeWidth: 9,
          pressures: [0.5],
        })}
      />,
    );

    const circles = captured("Circle");
    expect(circles.length).toBe(1);
    expect(circles[0]!.props.radius).toBeGreaterThanOrEqual(3);
  });

  it("applies alias diameter and pressure curves to causal pen/marker retained dabs", () => {
    const renderRadii = (brush: "fineliner" | "marker-bold") => {
      const view = render(
        <StudioDrawNode
          el={drawEl({
            brush,
            mode: "pen",
            points: [0, 0, 12, 0],
            pressures: [0.5, 0.5],
            pressureModel: "linear-residual-path-v3",
            sampleSpacing: 1,
          })}
        />,
      );
      const context = new AliasSceneContext();
      const sceneFunc = captured("Shape")[0]!.props.sceneFunc as (
        context: CanvasRenderingContext2D
      ) => void;
      sceneFunc(context as unknown as CanvasRenderingContext2D);
      view.unmount();
      konvaCapture.nodes.length = 0;
      return context.arcs.map((arc) => arc.radius);
    };

    const fineliner = renderRadii("fineliner");
    const boldMarker = renderRadii("marker-bold");
    expect(fineliner.length).toBeGreaterThan(0);
    expect(boldMarker.length).toBeGreaterThan(0);
    expect(Math.max(...boldMarker)).toBeGreaterThan(Math.max(...fineliner) * 3);
  });

  it("renders G-pen aliases as distinct single-outline curves instead of capped segments", async () => {
    const { loadStudioPerfectFreehandStroker } = await import("../studio-perfect-freehand");
    await act(async () => {
      await loadStudioPerfectFreehandStroker();
    });
    const renderPath = (brush: "gpen" | "mapping-pen" | "kaburapen" | "liner") => {
      const view = render(
        <StudioDrawNode
          el={drawEl({
            brush,
            mode: "pen",
            points: [0, 24, 8, 8, 20, 2, 34, 8, 42, 24, 38, 39, 24, 47, 10, 41],
            pressures: [0.2, 0.36, 0.7, 0.92, 0.74, 0.5, 0.28, 0.14],
            sampleSpacing: 1,
          })}
        />,
      );
      const paths = captured("Path");
      expect(paths).toHaveLength(1);
      const data = paths[0]!.props.data as string;
      view.unmount();
      konvaCapture.nodes.length = 0;
      return data;
    };

    const gpen = renderPath("gpen");
    const mapping = renderPath("mapping-pen");
    const kabura = renderPath("kaburapen");
    const liner = renderPath("liner");
    for (const outline of [gpen, mapping, kabura, liner]) {
      expect(outline.match(/M/g)).toHaveLength(1);
      expect(outline.match(/Q/g)?.length).toBeGreaterThan(4);
      expect(outline.match(/Z/g)).toHaveLength(1);
    }
    expect(new Set([gpen, mapping, kabura, liner]).size).toBe(4);
  });

  it("renders equal-input equal-width pen and G-pen with visibly distinct geometry", async () => {
    const points = [0, 24, 8, 8, 20, 2, 34, 8, 42, 24, 38, 39, 24, 47, 10, 41];
    const pressures = [0.2, 0.36, 0.7, 0.92, 0.74, 0.5, 0.28, 0.14];
    const strokeWidth = 12;
    const penView = render(
      <StudioDrawNode
        el={drawEl({
          brush: "pen",
          mode: "pen",
          points,
          pressures,
          strokeWidth,
          pressureModel: "linear-residual-path-v3",
          sampleSpacing: 0,
        })}
      />,
    );
    const penContext = new AliasSceneContext();
    const penSceneFunc = captured("Shape")[0]!.props.sceneFunc as (
      context: CanvasRenderingContext2D
    ) => void;
    penSceneFunc(penContext as unknown as CanvasRenderingContext2D);
    expect(captured("Path")).toHaveLength(0);
    expect(penContext.arcs.length).toBeGreaterThan(8);
    penView.unmount();
    konvaCapture.nodes.length = 0;

    const { loadStudioPerfectFreehandStroker } = await import("../studio-perfect-freehand");
    await act(async () => {
      await loadStudioPerfectFreehandStroker();
    });
    render(
      <StudioDrawNode
        el={drawEl({
          brush: "gpen",
          mode: "pen",
          points,
          pressures,
          strokeWidth,
          sampleSpacing: 0,
        })}
      />,
    );

    expect(captured("Shape")).toHaveLength(0);
    const gpenPaths = captured("Path");
    expect(gpenPaths).toHaveLength(1);
    const gpenOutline = gpenPaths[0]!.props.data as string;
    expect(gpenOutline.match(/Q/g)?.length).toBeGreaterThan(4);
    expect(gpenOutline.endsWith("Z")).toBe(true);
  });

  it("fills a multi-sample calligraphy stroke once instead of compounding round-cap opacity", () => {
    render(
      <StudioDrawNode
        el={drawEl({
          brush: "calligraphy",
          mode: "pen",
          points: [0, 0, 12, 0, 24, 10, 38, 10],
          pressures: [0.2, 0.45, 0.7, 0.9],
          strokeWidth: 12,
        })}
      />,
    );

    const context = new CalligraphySceneContext();
    const sceneFunc = captured("Shape")[0]!.props.sceneFunc as (
      context: CanvasRenderingContext2D
    ) => void;
    sceneFunc(context as unknown as CanvasRenderingContext2D);

    expect(context.lines.length).toBeGreaterThan(3);
    expect(context.arcs).toHaveLength(2);
    expect(context.fillCount).toBe(1);
  });

  it.each(["brush", "flat-brush"] as const)(
    "keeps %s retrace subpaths on one positive-winding source-over coverage fill",
    (brush) => {
      const renderCoverage = (activeDraft: boolean) => {
        const view = render(
          <StudioDrawNode
            activeDraft={activeDraft}
            el={drawEl({
              brush,
              mode: "pen",
              points: [0, 0, 24, 0, 0, 0, 24, 0],
              pressures: [0.6, 0.6, 0.6, 0.6],
              sampleSpacing: 1,
              strokeWidth: 10,
              opacity: 0.6,
            })}
          />,
        );
        const shape = captured("Shape")[0]!;
        const context = new AngledBrushSceneContext();
        const sceneFunc = shape.props.sceneFunc as (
          context: CanvasRenderingContext2D,
          shape: unknown,
        ) => void;
        sceneFunc(
          context as unknown as CanvasRenderingContext2D,
          {} as never,
        );
        const result = {
          composite: shape.props.globalCompositeOperation,
          fillCount: context.fillCount,
          opacity: shape.props.opacity,
          polygons: context.polygons,
        };
        view.unmount();
        konvaCapture.nodes.length = 0;
        return result;
      };
      const live = renderCoverage(true);
      const committed = renderCoverage(false);
      const signedArea = (points: readonly number[]) => {
        let twiceArea = 0;
        for (let index = 0; index < points.length; index += 2) {
          const next = (index + 2) % points.length;
          twiceArea +=
            points[index]! * points[next + 1]!
            - points[next]! * points[index + 1]!;
        }
        return twiceArea / 2;
      };

      expect(live).toEqual(committed);
      expect(committed.composite).toBe("source-over");
      expect(committed.opacity).toBe(0.6);
      expect(committed.fillCount).toBe(1);
      expect(committed.polygons).toHaveLength(3);
      expect(committed.polygons.every((polygon) => signedArea(polygon) > 0)).toBe(true);
    },
  );

  it.each(["brush", "flat-brush"] as const)(
    "versions %s nib pressure while legacy retained geometry stays fixed",
    (brush) => {
      const renderPressure = (
        pressures: readonly number[],
        pressureModel = true,
        materialMinimumDiameterRatio?: number,
      ) => {
        const view = render(
          <StudioDrawNode
            el={drawEl({
              brush,
              mode: "pen",
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
              strokeWidth: 10,
            })}
          />,
        );
        const context = new AngledBrushSceneContext();
        const sceneFunc = captured("Shape")[0]!.props.sceneFunc as (
          context: CanvasRenderingContext2D,
          shape: unknown,
        ) => void;
        sceneFunc(
          context as unknown as CanvasRenderingContext2D,
          {} as never,
        );
        view.unmount();
        konvaCapture.nodes.length = 0;
        return context.polygons;
      };
      const polygonWidth = (polygon: readonly number[]) => Math.hypot(
        polygon[2]! - polygon[0]!,
        polygon[3]! - polygon[1]!,
      );
      const light = renderPressure([0, 0, 0]);
      const heavy = renderPressure([1, 1, 1]);

      expect(polygonWidth(heavy[0]!)).toBeGreaterThan(
        polygonWidth(light[0]!) * 2,
      );
      expect(renderPressure([0, 0, 0], false)).toEqual(
        renderPressure([1, 1, 1], false),
      );
      expect(polygonWidth(renderPressure([0, 0, 0], true, 1)[0]!))
        .toBeGreaterThan(polygonWidth(renderPressure([0, 0, 0], true, 0)[0]!));
    },
  );

  it("hands committed ink-wash to the shared wet-ink replay instead of the retained ribbon", () => {
    // 2026-09-02: ink-wash, inkwash-bleed-wash and sumi joined the InkWash fluid list so the live
    // draft and the committed DrawNode share one Stam-wash renderer. The causal dab plan is still
    // authored for the compatibility path, but once the wet-ink replay plan is ok the scene
    // function never traces the retained ribbon or the legacy dab circles for this snapshot.
    const authoredDabs = [
      { x: 1, y: 2, radius: 10, opacity: 0.6, role: "core" },
      { x: 3, y: 4, radius: 12, opacity: 0.2, role: "diffuse" },
    ] as const;
    watercolorCapture.causalPlan.mockReturnValueOnce([...authoredDabs]);
    const element = drawEl({
      brush: "ink-wash",
      mode: "pen",
      points: [0, 0, 8, 0],
      pressures: [0.5, 0.5],
      strokeWidth: 20,
      watercolorPipeline: "causal-walker-v2",
    });
    render(<StudioDrawNode el={element} />);

    const replay = planStudioInteractiveWetInkBrushReplay(element, { phase: "committed" });
    expect(
      replay?.ok,
      replay && !replay.ok ? `${replay.reason}: ${replay.detail}` : "wet-ink replay missing",
    ).toBe(true);
    // The authored dabs were consumed, so the compatibility renderers had pigment to draw and
    // the empty context below is a renderer-selection fact, not an empty stroke.
    expect(watercolorCapture.causalPlan).toHaveBeenCalledTimes(1);
    const context = new AliasSceneContext();
    const sceneFunc = captured("Shape")[0]!.props.sceneFunc as (
      context: CanvasRenderingContext2D
    ) => void;
    sceneFunc(context as unknown as CanvasRenderingContext2D);
    expect(context.fillPolygons).toEqual([]);
    expect(context.arcs).toEqual([]);
  });

  it("applies inkwash-white-ink spacing, pressure, and material scales to retained watercolor", () => {
    // ink-wash 자체는 2026-09-02(b871ff48)부터 공유 Stam 유체 워시(studio-wet-ink-brush-runtime)로
    // 그려져 dab 워시를 타지 않는다. 별칭 배율 계약은 아직 dab 워시에 남은 화이트 잉크로 고정한다.
    const authoredDabs = [
      { x: 1, y: 2, radius: 10, opacity: 0.6, role: "core" },
      { x: 3, y: 4, radius: 12, opacity: 0.2, role: "diffuse" },
    ] as const;
    watercolorCapture.causalPlan.mockReturnValueOnce([...authoredDabs]);
    render(
      <StudioDrawNode
        el={drawEl({
          brush: "inkwash-white-ink",
          mode: "pen",
          points: [0, 0, 8, 0],
          pressures: [0.5, 0.5],
          strokeWidth: 20,
          watercolorPipeline: "causal-walker-v2",
        })}
      />,
    );

    const [planInput, finalize] = watercolorCapture.causalPlan.mock.calls[0]!;
    // inkwash-white-ink diameterScale 0.85 × strokeWidth 20 = 17; spacing 2.618 of scaled width
    // (resolveStudioBrushAliasWatercolorPlanSettings 실측, 2026-09-02).
    expect(planInput?.baseWidth).toBeCloseTo(17);
    expect(planInput?.spacing).toBeCloseTo(2.618);
    expect(planInput?.pressures).toEqual([
      expect.any(Number),
      expect.any(Number),
    ]);
    expect(planInput?.pressures?.[0]).toBeGreaterThan(0.5);
    expect(finalize).toBe(true);
    const context = new AliasSceneContext();
    const sceneFunc = captured("Shape")[0]!.props.sceneFunc as (
      context: CanvasRenderingContext2D
    ) => void;
    sceneFunc(context as unknown as CanvasRenderingContext2D);
    expect(context.arcs).toHaveLength(0);
    const retainedPlan = planStudioWetRibbonCarrier(
      applyStudioBrushAliasWatercolorMaterial("inkwash-white-ink", authoredDabs),
    );
    expect(retainedPlan.batches.length).toBeGreaterThan(4);
    expect(retainedPlan.batches.length).toBeLessThanOrEqual(4 * STUDIO_WET_RIBBON_OPACITY_BUCKET_COUNT);
    expect(retainedPlan.batches.every(({ polygons }) => polygons.length > 0))
      .toBe(true);
    expect(context.fillPolygons).toHaveLength(retainedPlan.batches.length);
    expect(context.fillAlphas).toEqual(
      retainedPlan.batches.map(({ opacity }) => opacity),
    );
    const polygonSpan = (polygon: readonly number[]) => {
      const xs = polygon.filter((_, coordinateIndex) => coordinateIndex % 2 === 0);
      const ys = polygon.filter((_, coordinateIndex) => coordinateIndex % 2 === 1);
      return Math.max(
        Math.max(...xs) - Math.min(...xs),
        Math.max(...ys) - Math.min(...ys),
      );
    };
    const diffuseOuterBatchIndex = retainedPlan.batches.findIndex(
      ({ layer }) => layer === "diffuse-outer",
    );
    const coreBatchIndex = retainedPlan.batches.findIndex(
      ({ layer }) => layer === "core",
    );
    expect(diffuseOuterBatchIndex).toBeGreaterThanOrEqual(0);
    expect(coreBatchIndex).toBeGreaterThan(diffuseOuterBatchIndex);
    // 화이트 잉크의 diffuse 스커트는 ink-wash(2배)보다 좁지만 코어보다 뚜렷이 넓어야 한다(실측 1.7배).
    expect(polygonSpan(context.fillPolygons[diffuseOuterBatchIndex]!))
      .toBeGreaterThan(polygonSpan(context.fillPolygons[coreBatchIndex]!) * 1.5);
  });

  it("renders soft pencil as a pale wide skirt plus a rough core", () => {
    const standard = render(
      <StudioDrawNode
        el={drawEl({ brush: "pencil", mode: "pen", points: [0, 0, 10, 0] })}
      />,
    );
    expect(captured("Shape")).toHaveLength(0);
    expect(captured("Line").map((node) => node.props.strokeWidth)).toEqual([10]);
    expect(captured("Line").map((node) => node.props.opacity)).toEqual([1]);
    expect(captured("Line").map((node) => node.props.lineCap)).toEqual(["round"]);

    standard.unmount();
    konvaCapture.nodes.length = 0;
    render(
      <StudioDrawNode
        el={drawEl({ brush: "soft-pencil", mode: "pen", points: [0, 0, 10, 0] })}
      />,
    );
    expect(captured("Shape")).toHaveLength(0);
    // soft-edge 는 껍질 여러 장으로 펼쳐진다. 예전엔 코어 뒤에 폭만 넓힌 단단한 선 하나였고,
    // 확대하면 부드러운 가장자리가 아니라 균일한 회색 테두리로 보였다.
    const widths = captured("Line").map((node) => node.props.strokeWidth as number);
    const opacities = captured("Line").map((node) => node.props.opacity as number);
    expect(widths.length).toBeGreaterThan(2);
    // 가장 넓은 껍질은 예전 skirt 폭 그대로, 마지막은 코어 폭이다.
    expect(widths[0]).toBeCloseTo(24.32, 6);
    expect(widths.at(-1)).toBeCloseTo(12.8, 6);
    expect(opacities.at(-1)).toBeCloseTo(0.72, 6);
    // 껍질들이 접히면 예전 skirt 불투명도에 정확히 도달한다.
    const folded = opacities.slice(0, -1)
      .reduce((carried, value) => 1 - (1 - carried) * (1 - value), 0);
    expect(folded).toBeCloseTo(0.18, 6);
    expect(new Set(captured("Line").map((node) => node.props.lineCap)))
      .toEqual(new Set(["round"]));
  });

  it("versions pencil pressure while legacy strokes retain their fixed width and pigment", () => {
    const renderPressure = (
      pressures: number[],
      activeDraft = false,
      pressureModel = true,
      materialMinimumDiameterRatio?: number,
    ) => {
      const view = render(
        <StudioDrawNode
          activeDraft={activeDraft}
          el={drawEl({
            brush: "pencil-2b",
            mode: "pen",
            points: [0, 0, 12, 4, 24, 0],
            pressures,
            ...(pressureModel
              ? {
                  materialPressureModel:
                    STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
                  ...(materialMinimumDiameterRatio === undefined
                    ? {}
                    : { materialMinimumDiameterRatio }),
                }
              : {}),
          })}
        />,
      );
      const result = pressureModel
        ? (() => {
            const context = new AliasSceneContext();
            const sceneFunc = captured("Shape")[0]!.props.sceneFunc as (
              context: CanvasRenderingContext2D
            ) => void;
            sceneFunc(context as unknown as CanvasRenderingContext2D);
            // 리본 셀은 알파 버킷별로 한 번의 fill 에 묶여 찍히므로 서브패스 단위로 읽는다.
            const ribbonCells = context.fillSubpathPolygons.filter(
              (polygon) => polygon.length === 8,
            );
            return {
              arcs: context.arcs,
              strokeAlphas: context.fillSubpathAlphas,
              strokeCaps: context.strokeCaps,
              strokeWidths: ribbonCells.map((polygon) => Math.max(
                Math.hypot(
                  polygon[0]! - polygon[6]!,
                  polygon[1]! - polygon[7]!,
                ),
                Math.hypot(
                  polygon[2]! - polygon[4]!,
                  polygon[3]! - polygon[5]!,
                ),
              )),
              terminalCapCount: context.fillSubpathPolygons.filter(
                (polygon) => polygon.length > 8,
              ).length,
            };
          })()
        : {
            arcs: [],
            strokeAlphas: captured("Line").map((node) => node.props.opacity as number),
            strokeCaps: captured("Line").map((node) => node.props.lineCap as string),
            strokeWidths: captured("Line").map((node) => node.props.strokeWidth as number),
            terminalCapCount: 0,
          };
      view.unmount();
      konvaCapture.nodes.length = 0;
      return result;
    };
    const light = renderPressure([0, 0, 0]);
    const neutral = renderPressure([0.5, 0.5, 0.5]);
    const heavy = renderPressure([1, 1, 1]);
    const liveHeavy = renderPressure([1, 1, 1], true);
    const legacyLight = renderPressure([0, 0, 0], false, false);
    const legacyHeavy = renderPressure([1, 1, 1], false, false);

    expect(Math.max(...heavy.strokeWidths)).toBeGreaterThan(
      Math.max(...neutral.strokeWidths),
    );
    expect(Math.max(...neutral.strokeWidths)).toBeGreaterThan(
      Math.max(...light.strokeWidths),
    );
    expect(Math.max(...heavy.strokeAlphas)).toBeGreaterThan(
      Math.max(...light.strokeAlphas),
    );
    expect(heavy.strokeCaps).toEqual([]);
    expect(heavy.arcs).toEqual([]);
    expect(heavy.terminalCapCount).toBe(2);
    expect(liveHeavy.strokeWidths).toEqual(heavy.strokeWidths);
    expect(liveHeavy.strokeAlphas).toEqual(heavy.strokeAlphas);
    expect(liveHeavy.strokeCaps).toEqual(heavy.strokeCaps);
    expect(liveHeavy.arcs).toEqual(heavy.arcs);
    expect(legacyLight.strokeWidths).toEqual(legacyHeavy.strokeWidths);
    expect(legacyLight.strokeAlphas).toEqual(legacyHeavy.strokeAlphas);
    const sliderZero = renderPressure([0, 0, 0], false, true, 0);
    const sliderFull = renderPressure([0, 0, 0], false, true, 1);
    expect(Math.max(...sliderFull.strokeWidths)).toBeGreaterThan(
      Math.max(...sliderZero.strokeWidths),
    );
    expect(sliderFull.strokeAlphas).toEqual(sliderZero.strokeAlphas);
  });

  it("shares one deterministic pressure-ribbon mesh between Canvas and SVG on a sharp S-curve", () => {
    const element = drawEl({
      id: "retained-ribbon-parity",
      brush: "pencil-2b",
      mode: "pen",
      points: [0, 0, 18, 34, 36, -32, 54, 36, 78, 0],
      pressures: [0.08, 0.92, 0.2, 1, 0.35],
      materialPressureModel: STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
      materialMinimumDiameterRatio: 0.25,
      sampleSpacing: 1,
      strokeWidth: 14,
      opacity: 0.64,
    });
    render(<StudioDrawNode el={element} />);
    const context = new AliasSceneContext();
    const sceneFunc = captured("Shape")[0]!.props.sceneFunc as (
      context: CanvasRenderingContext2D,
    ) => void;
    sceneFunc(context as unknown as CanvasRenderingContext2D);

    const exported = exportPageToSvg({
      width: 120,
      height: 100,
      bg: "#ffffff",
      elements: [element],
    }).svg;
    const pathCoordinates = (attribute: "data-pencil-ribbon-cell" | "data-pencil-endcap") => (
      Array.from(
        exported.matchAll(
          new RegExp(`<path d="([^"]+)"[^>]*${attribute}="[^"]+"[^>]*/>`, "gu"),
        ),
        (match) => Array.from(
          match[1]!.matchAll(/-?\d+(?:\.\d+)?/gu),
          (numberMatch) => Number(numberMatch[0]),
        ),
      )
    );
    const roundCoordinates = (points: readonly number[]) => points.map(
      (coordinate) => Math.round(coordinate * 100) / 100 + 0,
    );
    // Canvas 는 셀을 알파 버킷별로 묶어 채우고 SVG 는 경로 순서대로 쓴다 — 같은 메시라는
    // 계약은 순서가 아니라 집합이 같다는 뜻이므로 양쪽을 같은 키로 정렬해 비교한다.
    const sortMesh = (mesh: number[][]) => [...mesh].sort((a, b) =>
      a.join(",").localeCompare(b.join(","), "en"));
    const canvasCells = context.fillSubpathPolygons
      .filter((polygon) => polygon.length === 8)
      .map(roundCoordinates);
    const canvasCaps = context.fillSubpathPolygons
      .filter((polygon) => polygon.length > 8)
      .map(roundCoordinates);
    // 연속성 검사는 경로 순서가 필요하므로 SVG 가 쓰는 순서(경로 진행순)를 기준으로 걷는다.
    const svgCells = pathCoordinates("data-pencil-ribbon-cell");

    expect(exported).toContain('data-brush-engine="retained-pressure-ribbon-v1"');
    expect(sortMesh(svgCells)).toEqual(sortMesh(canvasCells));
    expect(sortMesh(pathCoordinates("data-pencil-endcap"))).toEqual(sortMesh(canvasCaps));
    expect(canvasCaps).toHaveLength(2);
    expect(context.arcs).toEqual([]);
    for (let cellIndex = 1; cellIndex < svgCells.length; cellIndex += 1) {
      const previous = new Set(
        Array.from({ length: 4 }, (_, pointIndex) => (
          `${svgCells[cellIndex - 1]![pointIndex * 2]},${svgCells[cellIndex - 1]![pointIndex * 2 + 1]}`
        )),
      );
      const current = new Set(
        Array.from({ length: 4 }, (_, pointIndex) => (
          `${svgCells[cellIndex]![pointIndex * 2]},${svgCells[cellIndex]![pointIndex * 2 + 1]}`
        )),
      );
      expect([...previous].filter((point) => current.has(point))).toHaveLength(2);
    }
    // The alpha ladder is the only place Canvas and SVG may differ: SVG writes the exact per-cell
    // alpha, Canvas rounds it to the nearest ladder step.
    expectPencilAlphaLadder(
      context,
      [
        ...pencilSvgPaths(exported, "data-pencil-ribbon-cell"),
        ...pencilSvgPaths(exported, "data-pencil-endcap"),
      ],
      element.opacity ?? 1,
      1,
    );
  });

  it.each(["neon", "glow"] as const)(
    "keeps legacy %s on continuous Konva Lines and gates segmented Shapes to canonical-v1",
    (brush) => {
      const base = {
        brush,
        mode: "pen" as const,
        points: [0, 0, 12, 8, 24, -2, 40, 6],
        pressures: [0, 1, 0, 1],
        sampleSpacing: 1,
        strokeWidth: 12,
      };
      const legacy = render(<StudioDrawNode el={drawEl(base)} />);

      expect(captured("Line").length).toBeGreaterThan(0);
      expect(captured("Line").every(
        (line) => line.props.globalCompositeOperation === "source-over",
      )).toBe(true);
      expect(captured("Shape")).toHaveLength(0);
      legacy.unmount();
      konvaCapture.nodes.length = 0;

      render(
        <StudioDrawNode
          el={drawEl({
            ...base,
            materialPressureModel:
              STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
          })}
        />,
      );
      expect(captured("Shape").length).toBeGreaterThan(0);
      expect(captured("Shape").every(
        (shape) => shape.props.globalCompositeOperation === "source-over",
      )).toBe(true);
    },
  );

  it.each(["neon", "glow", "soft-glow"] as const)(
    "keeps %s taps colour-preserving in legacy and canonical documents",
    (brush) => {
      for (const canonical of [false, true]) {
        const view = render(
          <StudioDrawNode
            el={drawEl({
              brush,
              mode: "pen",
              points: [24, 28],
              pressures: [0.82],
              stroke: "#2a7bd6",
              strokeWidth: 18,
              ...(canonical
                ? {
                    materialPressureModel:
                      STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
                  }
                : {}),
            })}
          />,
        );
        const circles = captured("Circle");
        // Derived, not pinned: the halo is resampled into shells so a hard-edged ring stack does
        // not band, and the shell count is a tunable tradeoff. One pass per shell is the invariant.
        expect(circles).toHaveLength(luminousPassCount(brush, 18));
        expect(circles.every(
          (circle) => circle.props.globalCompositeOperation === "source-over",
        )).toBe(true);
        view.unmount();
        konvaCapture.nodes.length = 0;
      }
    },
  );

  it("keeps overlapping glitter particles on the colour-preserving composite", () => {
    render(
      <StudioDrawNode
        el={drawEl({
          brush: "glitter",
          mode: "pen",
          points: [0, 0, 30, 18, 60, 0],
          pressures: [0.5, 0.9, 0.7],
          stroke: "#55ccff",
          strokeWidth: 20,
        })}
      />,
    );

    expect(captured("Shape")).toHaveLength(1);
    expect(captured("Shape")[0]!.props.globalCompositeOperation)
      .toBe("source-over");
  });

  it("uses the one-wash highlighter Shape for both legacy and canonical pressure documents", () => {
    const renderWash = (pressureModel: boolean) => {
      const view = render(
        <StudioDrawNode
          el={drawEl({
            brush: "highlighter",
            mode: "pen",
            points: [0, 0, 12, 8, 24, -2, 40, 6],
            pressures: [0, 1, 0, 1],
            sampleSpacing: 1,
            strokeWidth: 12,
            ...(pressureModel
              ? {
                  materialPressureModel:
                    STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
                }
              : {}),
          })}
        />,
      );
      const context = new AliasSceneContext();
      const sceneFunc = captured("Shape")[0]!.props.sceneFunc as (
        context: CanvasRenderingContext2D,
      ) => void;
      sceneFunc(context as unknown as CanvasRenderingContext2D);
      const result = {
        lineCount: captured("Line").length,
        shapeCount: captured("Shape").length,
        fillCount: context.fillPolygons.length,
        strokeCount: context.strokeWidths.length,
      };
      view.unmount();
      konvaCapture.nodes.length = 0;
      return result;
    };

    // Two compound fills, never more: one base wash and one rim/fibre detail wash. Each pass is a
    // single fill, so a self-crossing still receives each wash at most once — the invariant this
    // test guards — while the marker stops printing a single flat alpha over its whole area.
    expect(renderWash(false)).toEqual({
      lineCount: 0,
      shapeCount: 1,
      fillCount: 2,
      strokeCount: 0,
    });
    expect(renderWash(true)).toEqual({
      lineCount: 0,
      shapeCount: 1,
      fillCount: 2,
      strokeCount: 0,
    });
  });

  it.each([
    "neon",
    "glow",
    "soft-glow",
  ] as const)(
    "maps %s pressure identically through one compound fill per pass without butt-segment seams",
    (brush) => {
      const renderPressure = (
        pressure: number,
        activeDraft: boolean,
        materialMinimumDiameterRatio?: number,
      ) => {
        const view = render(
          <StudioDrawNode
            activeDraft={activeDraft}
            el={drawEl({
              brush,
              mode: "pen",
              points: [0, 0, 12, 8, 24, -2, 40, 6],
              pressures: [pressure, pressure, pressure, pressure],
              materialPressureModel: STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
              ...(materialMinimumDiameterRatio === undefined
                ? {}
                : { materialMinimumDiameterRatio }),
              sampleSpacing: 1,
              strokeWidth: 12,
              opacity: 0.7,
            })}
          />,
        );
        const context = new AliasSceneContext();
        for (const shape of captured("Shape")) {
          const sceneFunc = shape.props.sceneFunc as (
            context: CanvasRenderingContext2D,
          ) => void;
          context.globalAlpha = 1;
          sceneFunc(context as unknown as CanvasRenderingContext2D);
        }
        const geometrySpans = context.fillCompoundPaths.map((path) => {
          const xs = path.filter((_, coordinateIndex) => coordinateIndex % 2 === 0);
          const ys = path.filter((_, coordinateIndex) => coordinateIndex % 2 === 1);
          return Math.max(...xs) - Math.min(...xs)
            + Math.max(...ys) - Math.min(...ys);
        });
        const result = {
          capCount: context.arcs.length + context.fillRects.length,
          fillAlphas: [...context.fillAlphas],
          fillCount: context.fillCompoundPaths.length,
          geometrySpans,
          colorPreservingShapeCount: captured("Shape").filter(
            (shape) => shape.props.globalCompositeOperation === "source-over",
          ).length,
          strokeCount: context.strokeWidths.length,
        };
        view.unmount();
        konvaCapture.nodes.length = 0;
        return result;
      };

      const light = renderPressure(0, false);
      const heavy = renderPressure(1, false);
      const liveHeavy = renderPressure(1, true);

      expect(Math.max(...heavy.geometrySpans)).toBeGreaterThan(
        Math.max(...light.geometrySpans),
      );
      expect(Math.max(...heavy.fillAlphas)).toBeGreaterThan(
        Math.max(...light.fillAlphas),
      );
      expect(heavy.fillCount).toBe(luminousPassCount(brush, 12));
      expect(heavy.colorPreservingShapeCount).toBe(heavy.fillCount);
      expect(heavy.strokeCount).toBe(0);
      expect(heavy.capCount).toBe(0);
      expect(liveHeavy).toEqual(heavy);
      const sliderZero = renderPressure(0, false, 0);
      const sliderFull = renderPressure(0, false, 1);
      expect(sliderFull.geometrySpans).not.toEqual(sliderZero.geometrySpans);
      expect(sliderFull.fillAlphas).toEqual(sliderZero.fillAlphas);
    },
  );

  it.each([
    "neon",
    "glow",
    "soft-glow",
  ] as const)(
    "shares the exact %s compound ribbon geometry between active, retained and SVG rendering",
    (brush) => {
      const element = drawEl({
        id: `luminous-ribbon-parity-${brush}`,
        brush,
        mode: "pen",
        points: [0, 0, 30, 30, 60, 0, 30, -30, 0, 0, 30, 30, 60, 0],
        pressures: [0.8, 0.75, 0.9, 0.65, 0.8, 0.75, 0.9],
        materialPressureModel: STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
        sampleSpacing: 1,
        stroke: "#13579b",
        strokeWidth: 14,
        opacity: 0.64,
      });
      const roundCoordinates = (coordinates: readonly number[]) => (
        coordinates.map((coordinate) => Math.round(coordinate * 100) / 100 + 0)
      );
      const renderRibbon = (activeDraft: boolean) => {
        const view = render(
          <StudioDrawNode activeDraft={activeDraft} el={element} />,
        );
        const context = new AliasSceneContext();
        for (const shape of captured("Shape")) {
          const sceneFunc = shape.props.sceneFunc as (
            context: CanvasRenderingContext2D,
          ) => void;
          context.globalAlpha = 1;
          sceneFunc(context as unknown as CanvasRenderingContext2D);
        }
        const groupOpacity = Number(
          captured("Group").find(
            (group) => typeof group.props.opacity === "number",
          )?.props.opacity ?? 1,
        );
        const result = {
          alphas: context.fillAlphas.map(
            (alpha) => Math.round(alpha * groupOpacity * 1_000_000) / 1_000_000,
          ),
          paths: context.fillCompoundPaths.map(roundCoordinates),
        };
        view.unmount();
        konvaCapture.nodes.length = 0;
        return result;
      };
      const active = renderRibbon(true);
      const retained = renderRibbon(false);
      const exported = exportPageToSvg({
        width: 90,
        height: 90,
        bg: "#ffffff",
        elements: [element],
      }).svg;
      const svgPaths = Array.from(
        exported.matchAll(
          /data-luminous-ribbon="single-fill"[^>]*\sd="([^"]+)"/gu,
        ),
        (match) => roundCoordinates(Array.from(
          match[1]!.matchAll(/-?\d+(?:\.\d+)?/gu),
          (coordinateMatch) => Number(coordinateMatch[0]),
        )),
      );
      const svgAlphas = Array.from(
        exported.matchAll(
          /data-luminous-ribbon="single-fill"[^>]*opacity="([^"]+)"/gu,
        ),
        (match) => Number(match[1]),
      );

      expect(active).toEqual(retained);
      expect(svgPaths).toEqual(active.paths);
      expect(svgAlphas).toEqual(active.alphas);
      expect(active.paths).toHaveLength(luminousPassCount(brush, 14));
      expect(exported.match(
        /data-luminous-ribbon="single-fill"[^>]*data-luminous-composite="source-over"/gu,
      ))
        .toHaveLength(active.paths.length);
      expect(exported.match(
        /<g[^>]*data-luminous-composite="source-over"/gu,
      )).toHaveLength(1);
      expect(exported).not.toContain("mix-blend-mode:screen");
      expect(exported).not.toContain('stroke-linecap="butt"');
      expect(exported).not.toContain("data-pressure-endcap=");
    },
  );

  it.each([
    "neon",
    "glow",
    "soft-glow",
  ] as const)(
    "grows the live %s draft into the same ribbon a whole-stroke render produces",
    (brush) => {
      // 위 parity 테스트는 완성된 획을 한 번에 마운트한다 — 라이브 초안이 실제로 지나는 경로,
      // 즉 같은 컴포넌트 인스턴스가 점이 하나씩 늘어난 요소로 다시 렌더되는 경로는 지나지 않는다.
      // 발광 리본은 이제 그 성장 과정에서 섹션·런·폴리곤을 유지하므로(패스당 증분 빌더), 마지막
      // 프레임이 배치 플래너의 결과와 한 좌표라도 다르면 라이브와 커밋/SVG 가 갈라진다.
      // 유지 Path2D 자체는 여기서 실행되지 않는다(jsdom 에 `Path2D` 가 없어 폴백 경로가 돈다) —
      // 그쪽은 `studio-fx-luminous-ribbon-incremental.test.ts` 의 기록형 shim 이 잡는다.
      const sampleCount = 24;
      const points: number[] = [];
      const pressures: number[] = [];
      for (let index = 0; index < sampleCount; index += 1) {
        // 자기 교차하는 리사주 — 겹침 위에서 성장해도 마지막 프레임이 배치와 일치하는지를 본다.
        // 런 분할 분기는 여기서 지나지 않는다: 압력 경로 생산자가 만들 수 있는 입력으로는 런이
        // 갈리지 않는다(평범한 곡선·중복점·큰 점프·압력 0 구간 모두 실측 런 1개). 그 분기는
        // 방어 코드로 남아 있고, 어떤 테스트도 그것을 덮지 않는다고 적어 두는 편이 덮는다고
        // 적어 두는 것보다 정직하다.
        const t = index / (sampleCount - 1) * Math.PI * 2;
        points.push(
          Math.round((45 + Math.sin(t * 2) * 40) * 100) / 100,
          Math.round((45 + Math.sin(t * 3) * 40) * 100) / 100,
        );
        pressures.push(0.3 + 0.6 * (1 + Math.sin(t * 5)) / 2);
      }
      const elementAt = (count: number) => drawEl({
        id: `luminous-growing-${brush}`,
        brush,
        mode: "pen",
        points: points.slice(0, count * 2),
        pressures: pressures.slice(0, count),
        materialPressureModel: STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
        sampleSpacing: 1,
        stroke: "#13579b",
        strokeWidth: 14,
        opacity: 0.64,
      });
      const paintCapturedShapes = () => {
        const context = new AliasSceneContext();
        for (const shape of captured("Shape")) {
          const sceneFunc = shape.props.sceneFunc as (
            context: CanvasRenderingContext2D,
          ) => void;
          context.globalAlpha = 1;
          sceneFunc(context as unknown as CanvasRenderingContext2D);
        }
        return {
          alphas: context.fillAlphas.map(
            (alpha) => Math.round(alpha * 1_000_000) / 1_000_000,
          ),
          paths: context.fillCompoundPaths.map((coordinates) => (
            coordinates.map((coordinate) => Math.round(coordinate * 100) / 100 + 0)
          )),
        };
      };

      const view = render(
        <StudioDrawNode activeDraft el={elementAt(2)} />,
      );
      let live = paintCapturedShapes();
      for (let count = 3; count <= sampleCount; count += 1) {
        konvaCapture.nodes.length = 0;
        view.rerender(<StudioDrawNode activeDraft el={elementAt(count)} />);
        live = paintCapturedShapes();
      }
      view.unmount();
      konvaCapture.nodes.length = 0;

      // 같은 최종 획을 커밋 렌더(배치 플래너)로 다시 그린다.
      render(<StudioDrawNode el={elementAt(sampleCount)} />);
      const settled = paintCapturedShapes();

      expect(live.paths).toHaveLength(luminousPassCount(brush, 14));
      expect(live).toEqual(settled);
    },
  );

  it.each([
    "highlighter",
    "chisel-highlighter",
    "pastel-highlighter",
  ] as const)(
    "maps %s pressure through one active/retained wash fill with embedded terminal caps",
    (brush) => {
      const renderPressure = (
        pressure: number,
        activeDraft: boolean,
        materialMinimumDiameterRatio?: number,
      ) => {
        const view = render(
          <StudioDrawNode
            activeDraft={activeDraft}
            el={drawEl({
              brush,
              mode: "pen",
              points: [0, 0, 12, 8, 24, -2, 40, 6],
              pressures: [pressure, pressure, pressure, pressure],
              materialPressureModel: STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
              ...(materialMinimumDiameterRatio === undefined
                ? {}
                : { materialMinimumDiameterRatio }),
              sampleSpacing: 1,
              strokeWidth: 12,
              opacity: 0.7,
            })}
          />,
        );
        const context = new AliasSceneContext();
        const sceneFunc = captured("Shape")[0]!.props.sceneFunc as (
          context: CanvasRenderingContext2D,
        ) => void;
        sceneFunc(context as unknown as CanvasRenderingContext2D);
        const polygon = context.fillCompoundPaths[0] ?? [];
        const xs = polygon.filter((_, index) => index % 2 === 0);
        const ys = polygon.filter((_, index) => index % 2 === 1);
        const result = {
          alpha: context.fillAlphas[0],
          boundsSpan:
            Math.max(...xs) - Math.min(...xs)
            + Math.max(...ys) - Math.min(...ys),
          detailAlpha: context.fillAlphas[1],
          fillCount: context.fillPolygons.length,
          separateCaps: context.arcs.length + context.fillRects.length,
          strokeCount: context.strokeWidths.length,
        };
        view.unmount();
        konvaCapture.nodes.length = 0;
        return result;
      };

      const light = renderPressure(0, false);
      const heavy = renderPressure(1, false);
      const liveHeavy = renderPressure(1, true);

      expect(heavy.boundsSpan).toBeGreaterThan(light.boundsSpan);
      expect(heavy.alpha).toBeGreaterThan(light.alpha);
      // Base wash + detail wash; still no per-segment capsule stack.
      expect(heavy.fillCount).toBe(2);
      // The rim/fibre wash is a lighter second glaze, never a repaint of the whole body.
      expect(heavy.detailAlpha).toBeGreaterThan(0);
      expect(heavy.detailAlpha).toBeLessThan(heavy.alpha ?? 0);
      expect(heavy.separateCaps).toBe(0);
      expect(heavy.strokeCount).toBe(0);
      expect(liveHeavy).toEqual(heavy);
      const sliderZero = renderPressure(0, false, 0);
      const sliderFull = renderPressure(0, false, 1);
      expect(sliderFull.boundsSpan).toBeGreaterThan(sliderZero.boundsSpan);
      expect(sliderFull.alpha).toBe(sliderZero.alpha);
    },
  );

  it("shares the exact one-wash figure-eight outline across active, retained and SVG rendering", () => {
    const element = drawEl({
      id: "highlighter-one-wash-parity",
      brush: "highlighter",
      mode: "pen",
      points: [10, 10, 50, 50, 10, 50, 50, 10],
      pressures: [0.15, 0.9, 0.35, 0.75],
      materialPressureModel: STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
      sampleSpacing: 1,
      stroke: "#13579b",
      strokeWidth: 12,
      opacity: 0.7,
    });
    const renderOutline = (activeDraft: boolean) => {
      const view = render(
        <StudioDrawNode activeDraft={activeDraft} el={element} />,
      );
      const context = new AliasSceneContext();
      const sceneFunc = captured("Shape")[0]!.props.sceneFunc as (
        context: CanvasRenderingContext2D,
      ) => void;
      sceneFunc(context as unknown as CanvasRenderingContext2D);
      const result = {
        alpha: context.fillAlphas[0],
        outline: context.fillCompoundPaths[0],
        fillCount: context.fillPolygons.length,
      };
      view.unmount();
      konvaCapture.nodes.length = 0;
      return result;
    };
    const active = renderOutline(true);
    const retained = renderOutline(false);
    const exported = exportPageToSvg({
      width: 80,
      height: 80,
      bg: "#ffffff",
      elements: [element],
    }).svg;
    const exportedPath = /data-highlighter-wash="single-fill"[^>]*><path d="([^"]+)"/u
      .exec(exported)?.[1] ?? "";
    const exportedOutline = Array.from(
      exportedPath.matchAll(/-?\d+(?:\.\d+)?/gu),
      (match) => Number(match[0]),
    );
    const exportedAlpha = Number(
      /fill="#13579b"[^>]*opacity="([^"]+)"/u.exec(exported)?.[1] ?? 0,
    );

    expect(active).toEqual(retained);
    expect(active.fillCount).toBe(2);
    expect(exportedOutline).toEqual(active.outline);
    expect(exportedAlpha).toBeCloseTo(active.alpha ?? 0, 6);
    expect(exported).not.toContain("data-pressure-endcap=");
  });

  it.each([
    ["one accepted sample", [4, 7], [0.5]],
    ["two coincident samples", [4, 7, 4, 7], [0.5, 0.5]],
    ["three coincident samples", [4, 7, 4, 7, 4, 7], [0.5, 0.5, 0.5]],
  ])(
    "deposits a full pencil nib when a gesture never travels — %s",
    (_name, points, pressures) => {
      render(
        <StudioDrawNode
          el={drawEl({
            brush: "pencil",
            mode: "pen",
            points: [...points],
            pressures: [...pressures],
            sampleSpacing: 1,
            materialPressureModel: STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
            strokeWidth: 6,
            opacity: 1,
          })}
        />,
      );
      const context = new AliasSceneContext();
      for (const shape of captured("Shape")) {
        (shape.props.sceneFunc as (context: CanvasRenderingContext2D) => void)(
          context as unknown as CanvasRenderingContext2D,
        );
      }
      const dots = captured("Circle");

      // The grain jitter separates coincident samples by well under a pixel. Planning that as a
      // ribbon produced a sliver whose coverage was invisible against the page, so a tap has to
      // reach the same nib the single-sample route already draws.
      expect(dots).toHaveLength(1);
      expect(dots[0]!.props).toMatchObject({ x: 4, y: 7, radius: 3, fill: "#123456" });
      expect(Number(dots[0]!.props.opacity)).toBeGreaterThan(0.5);
      expect(context.fillPolygons).toEqual([]);
    },
  );

  it("keeps the travelling pencil ribbon untouched by the tap route", () => {
    const renderRibbon = () => {
      const view = render(
        <StudioDrawNode
          el={drawEl({
            brush: "pencil",
            mode: "pen",
            points: [0, 0, 12, 4, 24, 0],
            pressures: [0.3, 0.6, 0.9],
            sampleSpacing: 1,
            materialPressureModel: STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
            strokeWidth: 6,
            opacity: 1,
          })}
        />,
      );
      const context = new AliasSceneContext();
      for (const shape of captured("Shape")) {
        (shape.props.sceneFunc as (context: CanvasRenderingContext2D) => void)(
          context as unknown as CanvasRenderingContext2D,
        );
      }
      const result = {
        circles: captured("Circle").length,
        polygons: context.fillSubpathPolygons.map((polygon) => [...polygon]),
        alphas: [...context.fillSubpathAlphas],
      };
      view.unmount();
      konvaCapture.nodes.length = 0;
      return result;
    };
    const first = renderRibbon();
    const replay = renderRibbon();

    // A stroke with extent must never reach the contact dab, and must stay byte-for-byte stable.
    expect(first.circles).toBe(0);
    expect(first.polygons.length).toBeGreaterThan(2);
    expect(replay).toEqual(first);
  });

  it("keeps every faint pencil cell on Canvas through the alpha ladder", () => {
    // The 2026-09-02 long-stroke batching quantizes the pressure-driven cell alpha into fill
    // buckets. At its original 16 levels every cell under 1/32 rounded into the empty bucket and
    // was never drawn: soft-pencil's 0.18-scale skirt lost 40 of its 45 cells at light pressure
    // while the SVG export kept them. The ladder now has STUDIO_PENCIL_RIBBON_ALPHA_BUCKET_COUNT
    // levels, so the Canvas cell multiset equals the SVG one and no visible cell is dropped.
    const element = drawEl({
      brush: "soft-pencil",
      mode: "pen",
      points: [0, 0, 12, 4, 24, 0],
      pressures: [0, 0, 0],
      materialPressureModel: STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
      strokeWidth: 6,
      opacity: 1,
    });
    render(<StudioDrawNode el={element} />);
    const context = new AliasSceneContext();
    for (const shape of captured("Shape")) {
      (shape.props.sceneFunc as (context: CanvasRenderingContext2D) => void)(
        context as unknown as CanvasRenderingContext2D,
      );
    }
    const exported = exportPageToSvg({
      width: 40,
      height: 20,
      bg: "#ffffff",
      elements: [element],
    }).svg;
    const svgCells = pencilSvgPaths(exported, "data-pencil-ribbon-cell");
    const svgCaps = pencilSvgPaths(exported, "data-pencil-endcap");
    const canvasPolygons = context.fillSubpathPolygons.map(roundedPolygon);

    expect(svgCells.length).toBeGreaterThan(20);
    expect(polygonKeys(canvasPolygons.filter((polygon) => polygon.length === 8)))
      .toEqual(polygonKeys(svgCells.map((path) => path.coords)));
    expect(polygonKeys(canvasPolygons.filter((polygon) => polygon.length > 8)))
      .toEqual(polygonKeys(svgCaps.map((path) => path.coords)));
    // The skirt really is fainter than the 16-level ladder could represent.
    expect(Math.min(...context.fillAlphas)).toBeLessThan(1 / 32);
    expectPencilAlphaLadder(context, [...svgCells, ...svgCaps], 1, 2);
  });

  it("bounds a long two-pass pencil stroke to the alpha ladder's fill budget", () => {
    // The batching exists so a long stroke never issues one fill per cell: the fill count is
    // bounded by the ladder per pass, whatever the cell count.
    const pointCount = 160;
    render(
      <StudioDrawNode
        el={drawEl({
          brush: "pencil-6b",
          mode: "pen",
          points: Array.from({ length: pointCount }, (_, index) => [
            index * 3,
            index % 2 === 0 ? 0 : 9,
          ]).flat(),
          pressures: Array.from(
            { length: pointCount },
            (_, index) => 0.2 + 0.6 * ((index % 7) / 6),
          ),
          materialPressureModel: STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
          sampleSpacing: 1,
          strokeWidth: 8,
          opacity: 1,
        })}
      />,
    );
    const context = new AliasSceneContext();
    for (const shape of captured("Shape")) {
      (shape.props.sceneFunc as (context: CanvasRenderingContext2D) => void)(
        context as unknown as CanvasRenderingContext2D,
      );
    }

    expect(context.fillSubpathPolygons.length)
      .toBeGreaterThan(2 * STUDIO_PENCIL_RIBBON_ALPHA_BUCKET_COUNT);
    expect(context.fillAlphas.length)
      .toBeLessThanOrEqual(2 * STUDIO_PENCIL_RIBBON_ALPHA_BUCKET_COUNT);
  });

  it("keeps the soft-pencil two-pass material on a one-point tap", () => {
    render(
      <StudioDrawNode
        el={drawEl({ brush: "soft-pencil", mode: "pen", points: [4, 7] })}
      />,
    );

    // 탭도 같은 껍질 구성을 쓴다 — 획과 탭이 다른 재질로 보이면 안 된다.
    const circles = captured("Circle").map(({ props }) => ({
      opacity: props.opacity as number,
      radius: props.radius as number,
    }));
    expect(circles.length).toBeGreaterThan(2);
    expect(circles[0]!.radius).toBeCloseTo(12.16, 6);
    expect(circles.at(-1)!).toEqual({ opacity: 0.72, radius: 6.4 });
    const foldedTap = circles.slice(0, -1)
      .reduce((carried, circle) => 1 - (1 - carried) * (1 - circle.opacity), 0);
    expect(foldedTap).toBeCloseTo(0.18, 6);
  });

  it.each(["pencil-2b", "brush"] as const)(
    "applies the persisted minimum diameter to a %s tap without lifting alpha",
    (brush) => {
      const renderTap = (materialMinimumDiameterRatio: number) => {
        const view = render(
          <StudioDrawNode
            el={drawEl({
              brush,
              mode: "pen",
              points: [4, 7],
              pressures: [0],
              materialPressureModel: STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
              materialMinimumDiameterRatio,
              strokeWidth: 12,
              opacity: 0.7,
            })}
          />,
        );
        const nodes = [
          ...captured("Circle"),
          ...captured("Ellipse"),
          ...captured("Rect"),
        ];
        const result = {
          alphas: nodes.map(({ props }) => props.opacity),
          diameters: nodes.map(({ kind, props }) => (
            kind === "Circle"
              ? Number(props.radius) * 2
              : kind === "Ellipse"
                ? Number(props.radiusX) * 2
                : Number(props.width)
          )),
        };
        view.unmount();
        konvaCapture.nodes.length = 0;
        return result;
      };
      const sliderZero = renderTap(0);
      const sliderFull = renderTap(1);

      expect(Math.max(...sliderFull.diameters)).toBeGreaterThan(
        Math.max(...sliderZero.diameters),
      );
      expect(sliderFull.alphas).toEqual(sliderZero.alphas);
    },
  );

  it("applies highlighter tap minimum diameter through one natural wash footprint", () => {
    const renderTap = (materialMinimumDiameterRatio: number) => {
      const view = render(
        <StudioDrawNode
          el={drawEl({
            brush: "highlighter",
            mode: "pen",
            points: [4, 7],
            pressures: [0],
            materialPressureModel: STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
            materialMinimumDiameterRatio,
            strokeWidth: 12,
            opacity: 0.7,
          })}
        />,
      );
      const context = new AliasSceneContext();
      const sceneFunc = captured("Shape")[0]!.props.sceneFunc as (
        context: CanvasRenderingContext2D,
      ) => void;
      sceneFunc(context as unknown as CanvasRenderingContext2D);
      const polygon = context.fillPolygons[0] ?? [];
      const xs = polygon.filter((_, index) => index % 2 === 0);
      const ys = polygon.filter((_, index) => index % 2 === 1);
      const result = {
        alpha: context.fillAlphas[0],
        diameter: Math.max(
          Math.max(...xs) - Math.min(...xs),
          Math.max(...ys) - Math.min(...ys),
        ),
        fillCount: context.fillPolygons.length,
      };
      view.unmount();
      konvaCapture.nodes.length = 0;
      return result;
    };
    const sliderZero = renderTap(0);
    const sliderFull = renderTap(1);

    expect(sliderFull.diameter).toBeGreaterThan(sliderZero.diameter);
    expect(sliderFull.alpha).toBe(sliderZero.alpha);
    expect(sliderFull.fillCount).toBe(1);
  });

  it.each([
    ["causal pen", { points: [4, 7], sampleSpacing: 1 }],
    ["causal stamp", {
      brush: "ink-brush",
      mode: "pen",
      points: [4, 7],
      stampPipeline: "causal-walker-v2",
    }],
  ])("keeps a one-point %s on its engine-specific Shape route", async (_label, overrides) => {
    render(<StudioDrawNode el={drawEl(overrides as Partial<DrawEl>)} />);
    await flushStampRenderer();

    expect(captured("Circle")).toHaveLength(0);
    expect(captured("Shape").length).toBeGreaterThan(0);
  });

  it("renders a symmetric v2 pencil stamp as per-variation document-space plans", async () => {
    render(
      <StudioDrawNode
        el={drawEl({
          brush: "pencil-grain",
          mode: "pen",
          points: [2, 3],
          pressures: [0.7],
          stampPipeline: "causal-walker-v2",
          symmetry: { type: "vertical", centerX: 10, centerY: 0 },
        })}
      />,
    );
    await flushStampRenderer();

    expect(captured("Shape")).toHaveLength(1);
    const context = new StampSceneContext();
    const sceneFunc = captured("Shape")[0]!.props.sceneFunc as (
      context: CanvasRenderingContext2D
    ) => void;
    sceneFunc(context as unknown as CanvasRenderingContext2D);

    // Copies are planned in document space and drawn without a context transform, so the
    // mirrored copy re-derives its index-keyed tip jitter at the mirrored dab centre —
    // the SVG per-variation procedure (and the shared paper sheet for pinned lanes).
    expect(context.transforms).toEqual([]);
    expect(context.arcs).toHaveLength(6);
    const parseArc = (arc: string): number[] => arc.split(",").map(Number);
    const sourceArcs = context.arcs.slice(0, 3).map(parseArc);
    const mirroredArcs = context.arcs.slice(3).map(parseArc);
    mirroredArcs.forEach((arc, index) => {
      const source = sourceArcs[index]!;
      // Same jitter offsets around the mirrored dab centre: x shifts by 2·(centerX − x₀) = 16.
      expect(arc[0]).toBeCloseTo(source[0]! + 16, 12);
      expect(arc.slice(1)).toEqual(source.slice(1));
    });
  });

  it("does not overpaint a kaleidoscope center tap through duplicate Shapes or dabs", async () => {
    render(
      <StudioDrawNode
        el={drawEl({
          brush: "ink-brush",
          mode: "pen",
          points: [50, 40],
          pressures: [0.5],
          stampPipeline: "causal-walker-v2",
          symmetry: {
            type: "kaleidoscope",
            centerX: 50,
            centerY: 40,
            radialCount: 16,
          },
        })}
      />,
    );
    await flushStampRenderer();

    expect(captured("Shape")).toHaveLength(1);
    const context = new StampSceneContext();
    const sceneFunc = captured("Shape")[0]!.props.sceneFunc as (
      context: CanvasRenderingContext2D
    ) => void;
    sceneFunc(context as unknown as CanvasRenderingContext2D);
    expect(context.transforms).toEqual(["1,0,0,1,0,0"]);
    expect(context.arcs).toHaveLength(0);
    expect(context.paths).toHaveLength(1);
    expect(context.paths[0]).toHaveLength(48);
    expect(context.fills).toHaveLength(1);
  });

  it("renders phase-two colour, fixed grain and multi-tip marks on the Canvas path", () => {
    const brushDynamics = normalizeStudioBrushDynamicsSettings({
      tip: { shape: "round", softness: 0.1 },
      colorDynamics: { hueJitter: 65, saturationJitter: 0.2, valueJitter: 0.12 },
      grain: { space: "canvas-fixed", amount: 0.7, scale: 4, contrast: 0.75, seed: 81 },
      tipLayers: [
        { tip: { shape: "star" }, scale: 0.6, opacity: 0.65, offsetY: -0.45 },
        { tip: { shape: "grain" }, scale: 0.4, opacity: 0.45, offsetY: 0.5 },
      ],
      taper: { enabled: false },
      spacingRatio: null,
      spacing: { base: 8, mappings: [] },
      scatterRatio: null,
      scatter: { base: 0, mappings: [] },
    });
    const element = drawEl({
      id: "phase-two-canvas",
      brush: "ink-particle",
      mode: "pen",
      paintModel: "bounded-flow-v2",
      points: [10, 20, 50, 20],
      pressures: [0.7, 0.7],
      stroke: "#356dcc",
      brushDynamics,
    });
    const view = render(<StudioDrawNode el={element} />);
    const layeredContext = new StampSceneContext();
    const layeredScene = captured("Shape")[0]!.props.sceneFunc as (
      context: CanvasRenderingContext2D
    ) => void;
    layeredScene(layeredContext as unknown as CanvasRenderingContext2D);

    view.unmount();
    konvaCapture.nodes.length = 0;
    render(<StudioDrawNode el={{
      ...element,
      brushDynamics: normalizeStudioBrushDynamicsSettings({ ...brushDynamics, tipLayers: [] }),
    }} />);
    const singleContext = new StampSceneContext();
    const singleScene = captured("Shape")[0]!.props.sceneFunc as (
      context: CanvasRenderingContext2D
    ) => void;
    singleScene(singleContext as unknown as CanvasRenderingContext2D);

    expect(layeredContext.arcs.length).toBeGreaterThan(singleContext.arcs.length * 1.5);
    expect(new Set(layeredContext.fills.map((fill) => fill.color)).size).toBeGreaterThan(2);
    expect(new Set(layeredContext.fills.map((fill) => fill.alpha.toFixed(4))).size).toBeGreaterThan(5);
    expect(layeredContext.fills.every((fill) => fill.alpha >= 0 && fill.alpha <= 1)).toBe(true);
  });

  it("routes bounded-flow-v2 dynamics through stroke-local coverage with one final opacity", () => {
    const surfaceFills: number[] = [];
    class CoverageSurface {
      width: number;
      height: number;
      private readonly context = {
        globalAlpha: 1,
        globalCompositeOperation: "source-over",
        fillStyle: "",
        setTransform: () => undefined,
        clearRect: () => undefined,
        beginPath: () => undefined,
        ellipse: () => undefined,
        fill: () => {
          surfaceFills.push(this.context.globalAlpha);
        },
      };
      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }
      getContext(): typeof this.context {
        return this.context;
      }
    }
    vi.stubGlobal("OffscreenCanvas", CoverageSurface);
    const brushDynamics = normalizeStudioBrushDynamicsSettings({
      tip: { shape: "round" },
      grain: { amount: 0 },
      taper: { enabled: false },
      spacingRatio: null,
      spacing: { base: 8, mappings: [] },
      opacity: { base: 0.5, mappings: [] },
      flow: { base: 0.4, mappings: [] },
    });
    render(<StudioDrawNode el={drawEl({
      id: "bounded-flow-v2-canvas",
      brush: "ink-particle",
      mode: "pen",
      points: [10, 20, 50, 20],
      pressures: [0.7, 0.7],
      stroke: "#356dcc",
      opacity: 0.3,
      sampleSpacing: 0.5,
      paintModel: "bounded-flow-v2",
      brushDynamics,
    })} />);
    const context = new StampSceneContext();
    const sceneFunc = captured("Shape")[0]!.props.sceneFunc as (
      context: CanvasRenderingContext2D
    ) => void;
    sceneFunc(context as unknown as CanvasRenderingContext2D);

    expect(surfaceFills.length).toBeGreaterThan(2);
    expect(surfaceFills.every((alpha) => alpha === 0.2)).toBe(true);
    expect(context.arcs).toHaveLength(0);
    expect(context.drawImages.length).toBeGreaterThan(0);
    expect(context.drawImages.every(({ alpha }) => alpha === 0.3)).toBe(true);
  });

  it("fails bounded-flow-v2 closed when its coverage surface is unavailable", () => {
    vi.stubGlobal("OffscreenCanvas", class {
      constructor() {
        throw new Error("coverage unavailable");
      }
    });
    const brushDynamics = normalizeStudioBrushDynamicsSettings({
      tip: { shape: "round" },
      grain: { amount: 0 },
      taper: { enabled: false },
      spacingRatio: null,
      spacing: { base: 8, mappings: [] },
      opacity: { base: 0.5, mappings: [] },
      flow: { base: 0.5, mappings: [] },
    });
    render(<StudioDrawNode el={drawEl({
      id: "bounded-flow-v2-fail-closed",
      brush: "ink-particle",
      mode: "pen",
      points: [10, 20, 50, 20],
      pressures: [0.7, 0.7],
      stroke: "#356dcc",
      opacity: 0.5,
      sampleSpacing: 0.5,
      paintModel: "bounded-flow-v2",
      brushDynamics,
    })} />);
    const context = new StampSceneContext();
    const sceneFunc = captured("Shape")[0]!.props.sceneFunc as (
      context: CanvasRenderingContext2D
    ) => void;
    sceneFunc(context as unknown as CanvasRenderingContext2D);

    // Replaying the same .5-alpha dabs with .5 stroke opacity would produce .4375 overlap.
    // Bounded-flow-v2 instead remains empty when it cannot preserve the .375 coverage contract.
    expect(context.arcs).toHaveLength(0);
    expect(context.fills).toHaveLength(0);
    expect(context.drawImages).toHaveLength(0);
  });

  it("renders custom alpha tips without a Canvas save/restore pair for every sample", () => {
    const alphaMapSize = 8;
    const alphaBytes = new Uint8Array(alphaMapSize * alphaMapSize);
    alphaBytes.fill(255);
    const brushDynamics = normalizeStudioBrushDynamicsSettings({
      tip: {
        shape: "hard",
        softness: 0,
        alphaMapBase64: encodeStudioBrushTipAlphaMapBase64(alphaBytes),
        alphaMapSize,
      },
      grain: { amount: 0 },
      taper: { enabled: false },
      spacingRatio: null,
      spacing: { base: 12, mappings: [] },
    });
    render(<StudioDrawNode
      el={drawEl({
        id: "allocation-free-alpha-tip",
        brush: "ink-particle",
        mode: "pen",
        paintModel: "bounded-flow-v2",
        points: [0, 0, 36, 0],
        pressures: [0.7, 0.7],
        brushDynamics,
      })}
    />);

    const context = new StampSceneContext();
    const sceneFunc = captured("Shape")[0]!.props.sceneFunc as (
      context: CanvasRenderingContext2D
    ) => void;
    sceneFunc(context as unknown as CanvasRenderingContext2D);

    expect(context.fills.length).toBeGreaterThan(10);
    expect(context.saveCount).toBe(1);
    expect(context.restoreCount).toBe(1);
    expect(context.fillStyleWrites).toBeLessThan(context.fills.length);
  });

  it("uses the same full causal alpha texture authority on Canvas and SVG", () => {
    const alphaMapSize = 8;
    const alphaBytes = new Uint8Array(alphaMapSize * alphaMapSize);
    alphaBytes.fill(255);
    const brushDynamics = normalizeStudioBrushDynamicsSettings({
      ...studioBrushDynamicsPresetSettings("ink-particle"),
      tip: {
        shape: "hard",
        softness: 0,
        alphaMapBase64: encodeStudioBrushTipAlphaMapBase64(alphaBytes),
        alphaMapSize,
      },
      grain: { amount: 0 },
      tipLayers: [],
      dualBrush: { enabled: false },
      taper: { enabled: false },
      spacingRatio: null,
      spacing: { base: 8, mappings: [] },
    });
    const element = drawEl({
      id: "causal-grid3-cross-layer",
      brush: "ink-particle",
      mode: "pen",
      points: [0, 0, 16, 0, 32, 8, 48, 4],
      pressures: [0.25, 0.5, 0.8, 1],
      speeds: [0.2, 0.4, 0.7, 0.3],
      stroke: "#3257d6",
      strokeWidth: 16,
      opacity: 1,
      paintModel: "bounded-flow-v2",
      sampleSpacing: 1,
      brushDynamics,
    });
    const budget = planStudioDynamicBrushRenderBudget({
      settings: brushDynamics,
      dabCount: 1,
      symmetryCount: 1,
      markBudget: STUDIO_DYNAMIC_BRUSH_LIVE_MARK_BUDGET,
    });
    expect(budget.stampGrid).toBe(STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID);
    expect(budget.marksPerDab).toBe(1);

    class TextureCoverageSurface {
      width: number;
      height: number;
      private readonly context = {
        globalAlpha: 1,
        globalCompositeOperation: "source-over" as GlobalCompositeOperation,
        fillStyle: "",
        imageSmoothingEnabled: true,
        imageSmoothingQuality: "high" as ImageSmoothingQuality,
        save: () => undefined,
        restore: () => undefined,
        setTransform: () => undefined,
        clearRect: () => undefined,
        translate: () => undefined,
        rotate: () => undefined,
        scale: () => undefined,
        beginPath: () => undefined,
        arc: () => undefined,
        ellipse: () => undefined,
        fill: () => undefined,
        drawImage: () => undefined,
        fillRect: () => undefined,
        createImageData: (width: number, height: number) => ({
          width,
          height,
          colorSpace: "srgb",
          data: new Uint8ClampedArray(width * height * 4),
        } as ImageData),
        putImageData: () => undefined,
      };
      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }
      getContext(): typeof this.context {
        return this.context;
      }
    }
    vi.stubGlobal("OffscreenCanvas", TextureCoverageSurface);

    render(<StudioDrawNode el={element} />);
    const context = new StampSceneContext();
    const sceneFunc = captured("Shape")[0]!.props.sceneFunc as (
      context: CanvasRenderingContext2D,
    ) => void;
    sceneFunc(context as unknown as CanvasRenderingContext2D);
    const svg = exportPageToSvg({
      width: 128,
      height: 96,
      bg: "#ffffff",
      elements: [element],
    }).svg;
    const svgMarks = svg.match(/data-brush-coverage="alpha-map"/gu) ?? [];

    expect(context.arcs).toHaveLength(0);
    expect(context.drawImages.length).toBeGreaterThan(0);
    expect(svg).toContain('data-brush-tip-asset="full-alpha-map-v1"');
    expect(svgMarks.length).toBeGreaterThan(0);
    expect(svg).not.toContain("<circle");
  });

  it("keeps a 1,300-dab causal stroke identical and non-skipped after pointer-up and SVG export", () => {
    const brushDynamics = normalizeStudioBrushDynamicsSettings({
      ...studioBrushDynamicsPresetSettings("ink-particle"),
      depositPipeline: STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V2,
      width: { base: 16 },
      tip: { shape: "round", softness: 0 },
      grain: { amount: 0 },
      tipLayers: [],
      dualBrush: { enabled: false },
      taper: { enabled: false },
      spacingRatio: null,
      spacing: { base: 1, mappings: [] },
      scatterRatio: null,
      scatter: { base: 0, mappings: [] },
      roundness: { base: 1, mappings: [] },
    });
    const element = drawEl({
      id: "causal-1300-cross-surface",
      kind: "freehand",
      brush: "ink-particle",
      mode: "pen",
      paintModel: "bounded-flow-v2",
      points: [0, 24, 1_299, 24],
      pressures: [0.72, 0.72],
      stroke: "#3257d6",
      strokeWidth: 16,
      opacity: 1,
      sampleSpacing: 1,
      brushDynamics,
    });
    const causal = planStudioCausalDynamicBrushDepositsV2({
      points: element.points,
      pressures: element.pressures,
      settings: brushDynamics,
      maximumDabs: STUDIO_CAUSAL_DYNAMIC_BRUSH_MAX_DABS,
    });
    expect(causal.ok).toBe(true);
    if (!causal.ok) return;
    expect(causal.dabs.length).toBeGreaterThan(1_024);
    expect(causal.dabs.length).toBeLessThanOrEqual(1_500);
    const budget = planStudioDynamicBrushRenderBudget({
      settings: brushDynamics,
      dabCount: causal.dabs.length,
      symmetryCount: 1,
      markBudget: STUDIO_DYNAMIC_BRUSH_CAUSAL_MARK_BUDGET,
    });
    expect(budget.maxDabsPerVariation).toBe(causal.dabs.length);

    // bounded-flow-v2 accumulates marks on stroke-local OffscreenCanvas tiles and composites the
    // result once, so per-mark deposits are observed on the offscreen surface (not scene arcs).
    const depositedEllipses: Array<{ radius: number }> = [];
    class CountingCoverageSurface {
      width: number;
      height: number;
      readonly context = {
        canvas: this as unknown as OffscreenCanvas,
        globalAlpha: 1,
        globalCompositeOperation: "source-over",
        fillStyle: "",
        save: () => undefined,
        restore: () => undefined,
        setTransform: () => undefined,
        clearRect: () => undefined,
        translate: () => undefined,
        rotate: () => undefined,
        scale: () => undefined,
        beginPath: () => undefined,
        ellipse: (
          _cx: number,
          _cy: number,
          radiusX: number,
        ) => {
          depositedEllipses.push({ radius: radiusX });
        },
        fill: () => undefined,
        drawImage: () => undefined,
      };
      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }
      getContext(): typeof this.context {
        return this.context;
      }
    }
    vi.stubGlobal("OffscreenCanvas", CountingCoverageSurface);

    render(<StudioDrawNode el={element} />);
    const context = new StampSceneContext();
    const sceneFunc = captured("Shape")[0]!.props.sceneFunc as (
      context: CanvasRenderingContext2D,
    ) => void;
    sceneFunc(context as unknown as CanvasRenderingContext2D);

    const exported = exportPageToSvg({
      width: 1_320,
      height: 64,
      bg: "#ffffff",
      elements: [element],
    });
    const svgMarks = Array.from(
      exported.svg.matchAll(
        /<ellipse data-brush-coverage="ellipse" cx="([^"]+)" cy="([^"]+)" rx="([^"]+)"/gu,
      ),
      (match) => ({
        radius: Number(match[3]),
        x: Number(match[1]),
        y: Number(match[2]),
      }),
    );

    // Tile-boundary marks are deposited once per intersecting 256px coverage tile, so the
    // offscreen deposit count may exceed the dab count by the boundary overlap only.
    expect(depositedEllipses.length).toBeGreaterThanOrEqual(causal.dabs.length);
    expect(depositedEllipses.length).toBeLessThanOrEqual(Math.ceil(causal.dabs.length * 1.2));
    expect(context.drawImages.length).toBeGreaterThan(0);
    expect(svgMarks).toHaveLength(causal.dabs.length);
    expect(exported.skipped).toEqual([]);
    // Cross-surface identity: both surfaces consume the same causal dab plan, so the SVG marks
    // must sit exactly on the causal dab stations with the deposited canvas radii.
    expect(svgMarks[0]!.x).toBeCloseTo(causal.dabs[0]!.x, 3);
    expect(svgMarks[0]!.y).toBeCloseTo(causal.dabs[0]!.y, 3);
    expect(svgMarks[0]!.radius).toBeCloseTo(depositedEllipses[0]!.radius, 3);
    expect(svgMarks.at(-1)!.x).toBeCloseTo(causal.dabs.at(-1)!.x, 3);
    expect(svgMarks.at(-1)!.y).toBeCloseTo(causal.dabs.at(-1)!.y, 3);
    expect(svgMarks.at(-1)!.radius).toBeCloseTo(depositedEllipses.at(-1)!.radius, 3);
  });

  it("retains one v3 DrawEl beyond 65,536 dabs with an exact v2 prefix and one final opacity", () => {
    const points = segmentedCausalLongRoute();
    const pointCount = points.length / 2;
    const brushDynamics = segmentedCausalTestDynamics();
    const v2Dynamics = normalizeStudioBrushDynamicsSettings({
      ...brushDynamics,
      depositPipeline: STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V2,
    });
    const pressures = Array.from({ length: pointCount }, () => 0.72);
    const v2 = planStudioCausalDynamicBrushDepositsV2({
      points,
      pressures,
      settings: v2Dynamics,
      maximumDabs: STUDIO_CAUSAL_DYNAMIC_BRUSH_MAX_DABS,
    });
    const segmented = planStudioCausalDynamicBrushDepositSegmentsV3({
      points,
      pressures,
      settings: brushDynamics,
    });

    expect(v2.ok).toBe(true);
    expect(segmented.ok).toBe(true);
    if (!v2.ok || !segmented.ok) return;
    expect(v2).toMatchObject({
      dabCapped: true,
      sourcePointCount: pointCount,
    });
    expect(v2.dabs).toHaveLength(STUDIO_CAUSAL_DYNAMIC_BRUSH_MAX_DABS);
    expect(segmented).toMatchObject({
      continuationCapped: false,
      sourcePointCount: pointCount,
    });
    expect(segmented.dabCount).toBeGreaterThan(
      STUDIO_CAUSAL_DYNAMIC_BRUSH_MAX_DABS,
    );
    expect(segmented.segments).toHaveLength(2);
    expect(segmented.segments[0]).toMatchObject({
      segmentIndex: 0,
      firstDabIndex: 0,
      nextDabIndex: STUDIO_CAUSAL_DYNAMIC_BRUSH_MAX_DABS,
    });
    expect(segmented.segments[0]!.dabs).toEqual(v2.dabs);
    expect(segmented.segments[1]).toMatchObject({
      segmentIndex: 1,
      firstDabIndex: STUDIO_CAUSAL_DYNAMIC_BRUSH_MAX_DABS,
      nextDabIndex: segmented.dabCount,
    });
    expect(segmented.segments[1]!.dabs[0]!.index).toBe(
      STUDIO_CAUSAL_DYNAMIC_BRUSH_MAX_DABS,
    );
    expect(segmented.segments[1]!.dabs.at(-1)!.index).toBe(
      segmented.dabCount - 1,
    );

    const budget = planStudioDynamicBrushRenderBudget({
      settings: brushDynamics,
      dabCount: segmented.dabCount,
      symmetryCount: 4,
      markBudget: STUDIO_DYNAMIC_BRUSH_CAUSAL_CONTINUATION_MARK_BUDGET,
    });
    expect(budget).toMatchObject({
      maxDabsPerVariation: segmented.dabCount,
      estimatedMarks: segmented.dabCount * 4,
      dabCapped: false,
    });

    let depositedMarks = 0;
    class CountingCoverageSurface {
      width: number;
      height: number;
      private readonly context = {
        globalAlpha: 1,
        globalCompositeOperation: "source-over" as GlobalCompositeOperation,
        fillStyle: "",
        save: () => undefined,
        restore: () => undefined,
        setTransform: () => undefined,
        clearRect: () => undefined,
        translate: () => undefined,
        rotate: () => undefined,
        scale: () => undefined,
        beginPath: () => undefined,
        ellipse: () => undefined,
        fill: () => {
          depositedMarks += 1;
        },
      };
      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }
      getContext(): typeof this.context {
        return this.context;
      }
    }
    vi.stubGlobal("OffscreenCanvas", CountingCoverageSurface);
    const element = drawEl({
      id: "causal-v3-segmented-retained",
      kind: "freehand",
      brush: "ink-particle",
      mode: "pen",
      points,
      pressures,
      stroke: "#3257d6",
      strokeWidth: 2,
      opacity: 0.37,
      sampleSpacing: 1,
      paintModel: "bounded-flow-v2",
      brushDynamics,
      symmetry: {
        type: "radial",
        centerX: 64,
        centerY: 64,
        radialCount: 4,
      },
    });

    render(<StudioDrawNode el={element} />);
    expect(captured("Group")[0]?.props).toMatchObject({
      listening: false,
      studioElementId: element.id,
    });
    expect(captured("Shape")).toHaveLength(1);
    const context = new StampSceneContext();
    const sceneFunc = captured("Shape")[0]!.props.sceneFunc as (
      context: CanvasRenderingContext2D,
    ) => void;
    sceneFunc(context as unknown as CanvasRenderingContext2D);

    expect(depositedMarks).toBe(segmented.dabCount * 4);
    expect(context.arcs).toHaveLength(0);
    expect(context.drawImages.length).toBeGreaterThan(0);
    expect(context.drawImages.every(({ alpha }) => alpha === element.opacity))
      .toBe(true);
  }, 30_000);

  it("retains the bounded causal deposit prefix when the source exceeds the dab ceiling", () => {
    const brushDynamics = normalizeStudioBrushDynamicsSettings({
      ...studioBrushDynamicsPresetSettings("ink-particle"),
      depositPipeline: STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V2,
      tip: { shape: "round", softness: 0 },
      grain: { amount: 0 },
      tipLayers: [],
      dualBrush: { enabled: false },
      taper: { enabled: false },
      spacingRatio: null,
      spacing: { base: 0.5, mappings: [] },
    });
    render(<StudioDrawNode
      el={drawEl({
        id: "causal-deposit-overflow",
        kind: "freehand",
        brush: "ink-particle",
        mode: "pen",
        points: [0, 0, 100_000, 0],
        pressures: [0.7, 0.7],
        brushDynamics,
      })}
    />);

    expect(captured("Shape")).toHaveLength(1);
  });

  it("reuses committed coverage tiles across two CRDT replays of the same stroke identity", () => {
    clearStudioDynamicCoverageCommittedCache();
    let tileDeposits = 0;
    class CountingCoverageSurface {
      width: number;
      height: number;
      private readonly context = {
        globalAlpha: 1,
        globalCompositeOperation: "source-over" as GlobalCompositeOperation,
        fillStyle: "",
        save: () => undefined,
        restore: () => undefined,
        setTransform: () => undefined,
        clearRect: () => undefined,
        translate: () => undefined,
        rotate: () => undefined,
        scale: () => undefined,
        beginPath: () => undefined,
        ellipse: () => undefined,
        fill: () => {
          tileDeposits += 1;
        },
      };
      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }
      getContext(): typeof this.context {
        return this.context;
      }
    }
    vi.stubGlobal("OffscreenCanvas", CountingCoverageSurface);
    // A CRDT replay rebuilds the element object (fresh point/pressure arrays, fresh dynamics
    // normalization) while retaining the stroke identity. The committed cache key derives from
    // `el.id`, so the replayed render must reuse the retained tiles instead of re-depositing.
    const replayedElement = () => drawEl({
      id: "committed-crdt-replay-cache",
      kind: "freehand",
      brush: "ink-particle",
      mode: "pen",
      points: [8, 64, 120, 64],
      pressures: [0.7, 0.7],
      stroke: "#3257d6",
      strokeWidth: 2,
      opacity: 0.37,
      sampleSpacing: 1,
      paintModel: "bounded-flow-v2",
      brushDynamics: segmentedCausalTestDynamics(),
    });

    render(<StudioDrawNode el={replayedElement()} />);
    const firstScene = new StampSceneContext();
    (captured("Shape")[0]!.props.sceneFunc as (
      context: CanvasRenderingContext2D,
    ) => void)(firstScene as unknown as CanvasRenderingContext2D);
    const firstReplayDeposits = tileDeposits;
    expect(firstReplayDeposits).toBeGreaterThan(0);
    expect(firstScene.drawImages.length).toBeGreaterThan(0);
    expect(studioDynamicCoverageCommittedCacheStats()).toMatchObject({
      entries: 1,
    });

    cleanup();
    konvaCapture.nodes.length = 0;
    render(<StudioDrawNode el={replayedElement()} />);
    const secondScene = new StampSceneContext();
    (captured("Shape")[0]!.props.sceneFunc as (
      context: CanvasRenderingContext2D,
    ) => void)(secondScene as unknown as CanvasRenderingContext2D);

    // Tile reuse: the replay deposits zero additional marks on offscreen tile surfaces while the
    // destination still receives the identical composite sequence.
    expect(tileDeposits).toBe(firstReplayDeposits);
    expect(secondScene.drawImages).toEqual(firstScene.drawImages);
    expect(studioDynamicCoverageCommittedCacheStats()).toMatchObject({
      entries: 1,
    });
    clearStudioDynamicCoverageCommittedCache();
  });

  it("keeps pathological live multi-tip kaleidoscope work inside the shared mark budget", () => {
    const alphaMapSize = 8;
    const alphaBytes = new Uint8Array(alphaMapSize * alphaMapSize);
    alphaBytes.fill(255);
    const tip = {
      shape: "hard" as const,
      softness: 0,
      alphaMapBase64: encodeStudioBrushTipAlphaMapBase64(alphaBytes),
      alphaMapSize,
    };
    const brushDynamics = normalizeStudioBrushDynamicsSettings({
      tip,
      tipLayers: [{ tip }, { tip }],
      taper: { enabled: false },
      spacingRatio: null,
      spacing: { base: 0.25, mappings: [] },
    });
    render(<StudioDrawNode
      activeDraft
      el={drawEl({
        id: "bounded-live-kaleidoscope",
        brush: "ink-particle",
        mode: "pen",
        paintModel: "bounded-flow-v2",
        points: [0, 0, 5_000, 0],
        pressures: [0.7, 0.7],
        brushDynamics,
        symmetry: {
          type: "kaleidoscope",
          centerX: 0,
          centerY: 0,
          radialCount: 32,
        },
      })}
    />);

    const shapes = captured("Shape");
    const context = new StampSceneContext();
    // One bounded Shape owns all 64 affine copies; React/Konva no longer reconcile 64 nodes or
    // allocate 64 transformed source-point arrays on every active-draft frame.
    expect(shapes).toHaveLength(1);
    const sceneFunc = shapes[0]!.props.sceneFunc as (context: CanvasRenderingContext2D) => void;
    sceneFunc(context as unknown as CanvasRenderingContext2D);

    expect(context.arcs).toHaveLength(3_456);
    expect(context.arcs.length).toBeLessThanOrEqual(STUDIO_DYNAMIC_BRUSH_LIVE_MARK_BUDGET);
    expect(context.fills).toHaveLength(context.arcs.length);
  });

  it("routes the active causal draft through the incremental wet-wash pipeline", () => {
    render(
      <StudioDrawNode
        activeDraft
        el={drawEl({
          brush: "watercolor",
          mode: "pen",
          points: [0, 0, 8, 0],
          watercolorPipeline: "causal-walker-v2",
        })}
      />,
    );

    // 활성 초안(프로그램 없는 레인)은 요소 id 로 키된 증분 파이프라인이 이동당 비용을 진다
    // (장획 게이트 wet-dabs). 배치 리플레이는 커밋 렌더 전용이다.
    expect(wetWashCapture.livePlan).toHaveBeenCalledTimes(1);
    const [strokeKey, params] = wetWashCapture.livePlan.mock.calls[0]! as [
      string,
      { brushId: unknown; input: Record<string, unknown> },
    ];
    // 획 키는 요소 id + 대칭 변형 인덱스 — 변형 간 유지 플래너 격리(P2 리뷰).
    expect(strokeKey).toBe("draw-1#0");
    expect(params.brushId).toBe("watercolor");
    expect(params.input).toEqual(
      expect.objectContaining({ points: [0, 0, 8, 0], previewEndpoint: true }),
    );
    expect(watercolorCapture.causalPlan).not.toHaveBeenCalled();
  });

  it("keeps symmetric screentone draft variants on isolated incremental dot plans", () => {
    render(
      <StudioDrawNode
        activeDraft
        el={drawEl({
          brush: "screentone",
          mode: "pen",
          points: [0, 0, 60, 10, 120, 0],
          strokeWidth: 24,
          symmetry: { type: "vertical", centerX: 200, centerY: 0 },
        })}
      />,
    );
    const shapes = captured("Shape");
    expect(shapes).toHaveLength(2);
    const arcSets = shapes.map((shape) => {
      const context = new StampSceneContext();
      (shape.props.sceneFunc as (c: unknown, s: unknown) => void)(context, {});
      return context.arcs.join("|");
    });
    expect(arcSets[0]).not.toBe("");
    expect(arcSets[1]).not.toBe("");
    // 변형들이 같은 요소 키의 유지 빌더(내부 가변 배열)를 공유하면 두 sceneFunc 클로저가
    // 마지막 변형의 도트만 그린다(P2 리뷰 회귀) — 변형 인덱스 키 격리로 서로 달라야 한다.
    expect(arcSets[0]).not.toBe(arcSets[1]);
  });

  it("keeps the committed causal render on the batch replay with finalization=true", () => {
    render(
      <StudioDrawNode
        el={drawEl({
          brush: "watercolor",
          mode: "pen",
          points: [0, 0, 8, 0],
          watercolorPipeline: "causal-walker-v2",
        })}
      />,
    );

    // 커밋 렌더는 배치 리플레이를 유지해 후처리 워커의 전면 치환 같은 내부 점 재작성에도
    // 항상 정본을 그린다.
    expect(wetWashCapture.livePlan).not.toHaveBeenCalled();
    expect(watercolorCapture.causalPlan).toHaveBeenCalledTimes(1);
    expect(watercolorCapture.causalPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        points: [0, 0, 8, 0],
        previewEndpoint: false,
      }),
      true,
    );
  });
});

describe("StudioDrawNode perfect-freehand outline brush", () => {
  const perfectEl = (overrides: Partial<DrawEl> = {}): DrawEl =>
    drawEl({
      brush: "perfect-ink",
      mode: "pen",
      points: [0, 0, 20, 4, 40, 0, 60, 6, 80, 2],
      pressures: [0.3, 0.6, 0.9, 0.5, 0.4],
      sampleSpacing: 1,
      ...overrides,
    });

  it("falls back to a clean Line before the stroker chunk loads, then swaps to a filled Path", async () => {
    // 로더 상태는 모듈 전역이라 이 파일에서는 아직 로드 전이다 — 폴백 계약을 먼저 검증한다.
    const { peekStudioPerfectFreehandStroker, loadStudioPerfectFreehandStroker } =
      await import("../studio-perfect-freehand");
    const alreadyLoaded = peekStudioPerfectFreehandStroker() !== null;
    if (alreadyLoaded) {
      return;
    }

    render(<StudioDrawNode el={perfectEl()} />);
    expect(captured("Path")).toHaveLength(0);
    const fallbackLines = captured("Line");
    expect(fallbackLines).toHaveLength(1);
    expect(fallbackLines[0]!.props.stroke).toBe("#123456");
    expect(fallbackLines[0]!.props.tension).toBe(0);
    expect(fallbackLines[0]!.props.points).toEqual([0, 0, 20, 4, 40, 0, 60, 6, 80, 2]);

    // 훅이 걸어둔 동적 import가 끝나면 상태 변경으로 채워진 아웃라인 Path로 교체된다.
    await act(async () => {
      await loadStudioPerfectFreehandStroker();
    });
    const paths = captured("Path");
    expect(paths).toHaveLength(1);
    expect(paths[0]!.props.fill).toBe("#123456");
    expect(paths[0]!.props.listening).toBe(false);
    const data = paths[0]!.props.data as string;
    expect(data).toMatch(/^M-?\d/);
    expect(data).toContain("Q");
    expect(data.endsWith("Z")).toBe(true);
  });

  it("keeps very short perfect strokes on Line fallback even after stroker loads", async () => {
    const { loadStudioPerfectFreehandStroker } = await import("../studio-perfect-freehand");
    await act(async () => {
      await loadStudioPerfectFreehandStroker();
    });
    render(
      <StudioDrawNode
        el={perfectEl({
          brush: "perfect-ink",
          points: [0, 0, 9, 3],
          pressures: [0.5, 0.8],
        })}
      />,
    );
    expect(captured("Path")).toHaveLength(0);
    const dots = captured("Circle");
    expect(dots).toHaveLength(1);
    expect(dots[0]!.props.radius).toBeGreaterThanOrEqual(3);
  });

  it("keeps pressure geometry for a very short G-pen flick", async () => {
    const { loadStudioPerfectFreehandStroker } = await import("../studio-perfect-freehand");
    await act(async () => {
      await loadStudioPerfectFreehandStroker();
    });
    render(
      <StudioDrawNode
        el={perfectEl({
          brush: "gpen",
          points: [0, 0, 9, 3],
          pressures: [0.18, 0.92],
        })}
      />,
    );
    expect(captured("Line")).toHaveLength(0);
    expect(captured("Path")).toHaveLength(1);
    expect(captured("Path")[0]!.props.data).toMatch(/^M.*Q.*Z$/);
  });

  it("keeps legacy missing-pressure G-pen at the historical 0.6 fallback without draft drift", async () => {
    const { loadStudioPerfectFreehandStroker } = await import("../studio-perfect-freehand");
    await act(async () => {
      await loadStudioPerfectFreehandStroker();
    });
    const points = [0, 4, 12, 0, 24, 6, 36, 18, 48, 22, 60, 16, 72, 5];
    const renderData = (pressures: number[] | undefined, activeDraft: boolean) => {
      const view = render(
        <StudioDrawNode
          activeDraft={activeDraft}
          el={perfectEl({ brush: "gpen", points, pressures })}
        />,
      );
      const data = captured("Path")[0]!.props.data as string;
      view.unmount();
      konvaCapture.nodes.length = 0;
      return data;
    };

    const missing = renderData(undefined, false);
    expect(renderData(Array(points.length / 2).fill(0.6), false)).toBe(missing);
    expect(renderData(undefined, true)).toBe(missing);
  });

  it("renders both perfect profiles as distinct deterministic outlines once loaded", async () => {
    const { loadStudioPerfectFreehandStroker } = await import("../studio-perfect-freehand");
    await act(async () => {
      await loadStudioPerfectFreehandStroker();
    });
    const stableStroke = perfectEl({
      points: [
        0, 1, 8, 2, 16, 1, 24, 0, 32, 3, 40, 1, 48, -1, 56, 2, 64, 1, 72, 0,
        80, 3, 88, 1, 96, 0, 104, -2, 112, 1, 120, 2, 128, 0, 136, 1, 144, 2,
      ],
    });
    render(<StudioDrawNode el={stableStroke} />);
    const inkData = captured("Path")[0]!.props.data as string;
    konvaCapture.nodes.length = 0;

    render(<StudioDrawNode el={stableStroke} />);
    expect(captured("Path")[0]!.props.data).toBe(inkData);
    konvaCapture.nodes.length = 0;

    render(<StudioDrawNode el={perfectEl({ ...stableStroke, brush: "perfect-marker" })} />);
    const markerData = captured("Path")[0]!.props.data as string;
    expect(markerData).toMatch(/^M-?\d/);
    expect(markerData).not.toBe(inkData);
  });

  it("keeps eraser strokes and taps out of the outline branch", () => {
    render(<StudioDrawNode el={perfectEl({ mode: "eraser" })} />);
    expect(captured("Path")).toHaveLength(0);
    konvaCapture.nodes.length = 0;

    // 한 점 탭은 generic-dot 계약(퍼펙트 테이퍼가 탭을 지우지 않도록)으로 원 도트를 그린다.
    render(
      <StudioDrawNode
        el={perfectEl({ points: [5, 5], pressures: [0.6], sampleSpacing: undefined })}
      />,
    );
    expect(captured("Path")).toHaveLength(0);
    expect(captured("Circle")).toHaveLength(1);
  });
});

describe("StudioDrawNode durable outline contract", () => {
  const contractFor = (brushId: string) => {
    const contract = captureStudioOutlineStrokeContractV1({
      brushId,
      pressureSource: "recorded",
    });
    if (!contract) throw new Error(`missing outline contract for ${brushId}`);
    return contract;
  };

  it("uses one immutable path for active draft, committed replay, and SVG export", () => {
    const element = drawEl({
      id: "durable-outline-parity",
      brush: "gpen",
      mode: "pen",
      points: [0, 24, 8, 8, 20, 2, 34, 8, 42, 24, 38, 39, 24, 47, 10, 41],
      pressures: [0.2, 0.36, 0.7, 0.92, 0.74, 0.5, 0.28, 0.14],
      stroke: "#26384a",
      strokeWidth: 12,
      sampleSpacing: 0,
      outlineStroke: contractFor("gpen"),
    });

    const active = render(<StudioDrawNode activeDraft el={element} />);
    const activePath = captured("Path")[0]!.props.data as string;
    active.unmount();
    konvaCapture.nodes.length = 0;

    render(<StudioDrawNode el={element} />);
    const committedPath = captured("Path")[0]!.props.data as string;
    const exported = exportPageToSvg({
      width: 160,
      height: 100,
      bg: "#ffffff",
      elements: [element],
    });
    const svgPath = /<path d="([^"]+)" fill="#26384a" data-brush-engine="perfect-outline-contract-v1"/u
      .exec(exported.svg)?.[1];

    expect(activePath).toBe(committedPath);
    expect(svgPath).toBe(committedPath);
    expect(committedPath).toMatch(/^M.*Q.*Z$/u);
    expect(exported.skipped).toEqual([]);
  });

  it("does not apply the mutable alias pressure adapter a second time", () => {
    const points = [0, 18, 12, 4, 28, 0, 44, 9, 56, 25, 48, 40, 28, 46];
    const recordedPressures = [0.08, 0.2, 0.48, 0.9, 0.75, 0.38, 0.12];
    const strokeWidth = 17;
    const element = drawEl({
      id: "recorded-pressure-not-remapped",
      brush: "mapping-pen",
      mode: "pen",
      points,
      pressures: recordedPressures,
      strokeWidth,
      sampleSpacing: 0,
      outlineStroke: contractFor("mapping-pen"),
    });
    const stroker = peekStudioPerfectFreehandStroker();
    const direct = planStudioPerfectFreehandRender({
      contract: element.outlineStroke,
      stroker,
      points,
      pressures: recordedPressures,
      strokeWidth,
      sampleSpacing: 0,
    });
    const doubleMapped = planStudioPerfectFreehandRender({
      contract: element.outlineStroke,
      stroker,
      points,
      pressures: mapStudioBrushAliasPressureSamples(
        "mapping-pen",
        recordedPressures,
        recordedPressures.length,
        0.6,
      ),
      strokeWidth,
      sampleSpacing: 0,
    });
    expect(direct.kind).toBe("outline");
    expect(doubleMapped.kind).toBe("outline");
    if (direct.kind !== "outline" || doubleMapped.kind !== "outline") return;
    expect(direct.pathData).not.toBe(doubleMapped.pathData);

    render(<StudioDrawNode el={element} />);
    expect(captured("Path")[0]!.props.data).toBe(direct.pathData);
  });

  it("renders the shared compact fallback with the same line and endpoint caps as SVG", () => {
    const element = drawEl({
      id: "durable-outline-compact",
      brush: "perfect-ink",
      mode: "pen",
      points: [10, 10, 14, 14],
      pressures: [0.5, 0.5],
      stroke: "#654321",
      strokeWidth: 4,
      sampleSpacing: 1,
      outlineStroke: contractFor("perfect-ink"),
    });

    render(<StudioDrawNode activeDraft el={element} />);
    const line = captured("Line")[0]!;
    expect(line.props).toMatchObject({
      points: [10, 10, 14, 14],
      tension: 0.32,
      strokeWidth: 4,
    });
    expect(captured("Circle").map((node) => node.props.radius)).toEqual([2, 2]);

    const exported = exportPageToSvg({
      width: 64,
      height: 64,
      bg: "#ffffff",
      elements: [element],
    });
    expect(exported.svg).toContain('data-brush-fallback="very-short-perfect"');
    expect(exported.svg).toContain('d="M 10 10 L 14 14"');
    expect(exported.svg).toContain('stroke-width="4"');
    expect(exported.svg.match(/r="2"/gu)).toHaveLength(2);
    expect(exported.skipped).toEqual([]);
  });

  it("keeps a one-point G-pen tap visible as the same single cap in live, commit, and SVG", () => {
    const element = drawEl({
      id: "durable-outline-tap",
      brush: "gpen",
      mode: "pen",
      points: [12, 18],
      pressures: [0.45],
      stroke: "#3d2b22",
      strokeWidth: 7,
      sampleSpacing: 0,
      outlineStroke: contractFor("gpen"),
    });

    const active = render(<StudioDrawNode activeDraft el={element} />);
    expect(captured("Circle")).toHaveLength(1);
    expect(captured("Circle")[0]!.props).toMatchObject({
      x: 12,
      y: 18,
      radius: 3.22875,
      fill: "#3d2b22",
    });
    active.unmount();
    konvaCapture.nodes.length = 0;

    render(<StudioDrawNode el={element} />);
    expect(captured("Circle")).toHaveLength(1);
    expect(captured("Circle")[0]!.props.radius).toBe(3.22875);

    const exported = exportPageToSvg({
      width: 48,
      height: 48,
      bg: "#ffffff",
      elements: [element],
    });
    expect(exported.svg).toContain('data-brush-fallback="insufficient-points"');
    expect(exported.svg).toContain(
      '<circle cx="12" cy="18" r="3.23" fill="#3d2b22"/>',
    );
    expect(exported.skipped).toEqual([]);
  });

  it("shows damaged or future contracts as diagnostics instead of legacy geometry", () => {
    const futureContract = {
      ...contractFor("gpen"),
      version: 99,
    };
    const element = drawEl({
      id: "future-outline-contract",
      brush: "gpen",
      mode: "pen",
      points: [4, 30, 24, 4, 48, 28],
      pressures: [0.3, 0.9, 0.4],
      outlineStroke: futureContract as unknown as DrawEl["outlineStroke"],
    });

    render(<StudioDrawNode el={element} />);
    expect(captured("Path")).toHaveLength(0);
    expect(captured("Group")).toEqual(expect.arrayContaining([
      expect.objectContaining({
        props: expect.objectContaining({
          name: "studio-outline-contract-error:unsupported-version",
        }),
      }),
    ]));

    const exported = exportPageToSvg({
      width: 80,
      height: 60,
      bg: "#ffffff",
      elements: [element],
    });
    expect(exported.svg).not.toContain('data-brush-engine="perfect-outline"');
    expect(exported.skipped).toEqual([
      expect.objectContaining({
        id: element.id,
        mode: "skipped",
        label: expect.stringContaining("unsupported-version"),
      }),
    ]);
  });
});
