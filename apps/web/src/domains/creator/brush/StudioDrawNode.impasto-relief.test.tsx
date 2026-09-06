// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  STUDIO_OIL_IMPASTO_RELIEF_HIGHLIGHT_COLOR,
} from "./studio-oil-ribbon-carrier";
import { StudioDrawNode } from "./StudioDrawNode";

import type { DrawEl } from "../studio-element-model";

interface CapturedKonvaNode {
  kind: string;
  props: Record<string, unknown>;
}

const konvaCapture = vi.hoisted(() => ({
  nodes: [] as CapturedKonvaNode[],
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

interface RecordedStroke {
  alpha: number;
  cap: CanvasLineCap;
  composite: string;
  style: string;
  width: number;
}

/** Records every stroke pass with the compositing state it was painted under. */
class OilSceneContext {
  readonly fills: Array<{ alpha: number; style: string }> = [];
  readonly strokes: RecordedStroke[] = [];
  fillStyle: string | CanvasGradient | CanvasPattern = "";
  globalAlpha = 1;
  globalCompositeOperation = "source-over";
  lineCap: CanvasLineCap = "butt";
  lineJoin: CanvasLineJoin = "miter";
  lineWidth = 1;
  strokeStyle: string | CanvasGradient | CanvasPattern = "";

  save(): void {}
  restore(): void {}
  beginPath(): void {}
  closePath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  fill(): void {
    this.fills.push({ alpha: this.globalAlpha, style: String(this.fillStyle) });
  }
  stroke(): void {
    this.strokes.push({
      alpha: this.globalAlpha,
      cap: this.lineCap,
      composite: this.globalCompositeOperation,
      style: String(this.strokeStyle),
      width: this.lineWidth,
    });
  }
}

function oilEl(brush: string): DrawEl {
  return {
    id: `impasto-node-${brush}`,
    type: "draw",
    kind: "freehand",
    brush,
    points: [8, 60, 120, 64, 260, 52, 420, 66],
    pressures: [0.42, 0.78, 0.6, 0.7],
    stroke: "#8b3f31",
    strokeWidth: 24,
  };
}

function paintOilShape(): OilSceneContext {
  const shapes = konvaCapture.nodes.filter(({ kind }) => kind === "Shape");
  expect(shapes).toHaveLength(1);
  const context = new OilSceneContext();
  (shapes[0]!.props.sceneFunc as (context: OilSceneContext) => void)(context);
  return context;
}

beforeEach(() => {
  konvaCapture.nodes.length = 0;
});

afterEach(() => {
  cleanup();
});

describe("StudioDrawNode — impastoRelief Canvas 릴리프 오버레이", () => {
  // oil--impasto-ribbon 은 2026-08-15 에 이 프로그램에 합류했다. 이름만 임파스토였던 레인으로,
  // 릴리프가 없으면 선언 필드가 oil--filbert-ribbon 과 완전히 동일했고 렌더 픽셀 거리도
  // oil--flat-ribbon 0.163 / acrylic--stiff-ribbon 0.168 로 코퍼스 중앙값(1.04)의 6분의 1이었다.
  it.each([
    "brush--impasto-relief",
    "oil--impasto-ribbon",
    // 2026-08-20 에 세 프로그램을 모두 켜고 매트릭스에 들어온 기본 유화 — Canvas 가 매트릭스가
    // 아니라 옛 두-레인 목록을 보면 여기서 글린트가 빠진다.
    "oil",
    "acrylic",
  ])(
    "임파스토 릴리프 프로그램이 켜진 id(%s)는 screen 글린트와 round-cap 코어 섀도우를 페인트한다",
    (brush) => {
    render(<StudioDrawNode el={oilEl(brush)} />);
    const context = paintOilShape();

    // 유화 바디는 그대로 한 번 채운다.
    expect(context.fills.length).toBeGreaterThan(0);
    // 강모 밴드와 릴리프 섀도우는 이제 캔버스 API 로 구분되지 않는다 — 강모 런의 각진 끝을
    // 없애려고 밴드도 round 캡으로 바꿨고(studio-oil-ribbon-carrier), 둘 다 multiply 에 스트로크
    // 색이다. 그래서 판별은 관찰 가능한 것만 쓴다: screen 글린트는 유일하고, 릴리프가 붙었다는
    // 사실은 형제 레인보다 multiply 패스가 더 많다는 것으로 확인한다(아래 별도 테스트).
    const bandStrokes = context.strokes.filter(
      ({ composite }) => composite === "multiply",
    );
    const glints = context.strokes.filter(
      ({ composite, style }) =>
        composite === "screen" && style === STUDIO_OIL_IMPASTO_RELIEF_HIGHLIGHT_COLOR,
    );
    const coreShadows = context.strokes.filter(
      ({ cap, composite, style }) =>
        cap === "round" && composite === "multiply" && style === "#8b3f31",
    );
    expect(bandStrokes.length).toBeGreaterThan(0);
    expect(glints.length).toBeGreaterThan(0);
    expect(coreShadows.length).toBeGreaterThan(0);
    // (kind × 톤 버킷) 양자화: 글린트는 최대 3 패스.
    expect(glints.length).toBeLessThanOrEqual(3);
    for (const glint of glints) {
      expect(glint.cap).toBe("round");
      expect(glint.alpha).toBeGreaterThan(0);
      expect(glint.alpha).toBeLessThanOrEqual(0.44);
    }
    // 페인트 순서 계약: 글린트는 모든 multiply 패스 뒤에 온다(릴리프가 마지막 층이다).
    const firstGlint = context.strokes.findIndex(
      ({ composite }) => composite === "screen",
    );
    const lastMultiply = context.strokes
      .map(({ composite }) => composite === "multiply")
      .lastIndexOf(true);
    expect(firstGlint).toBeGreaterThan(lastMultiply);
  },
  );

  it.each(["brush--oil-lanes", "brush--bristle-depletion"])(
    "프로그램에 핀되지 않은 유화 형제 레인(%s)은 릴리프 패스를 전혀 페인트하지 않는다",
    (brush) => {
      render(<StudioDrawNode el={oilEl(brush)} />);
      const context = paintOilShape();

      expect(context.strokes.length).toBeGreaterThan(0);
      expect(context.strokes.every(({ composite }) => composite === "multiply")).toBe(true);
      expect(context.strokes.some(({ composite }) => composite === "screen")).toBe(false);
      expect(context.strokes.some(
        ({ style }) => style === STUDIO_OIL_IMPASTO_RELIEF_HIGHLIGHT_COLOR,
      )).toBe(false);
    },
  );
});
