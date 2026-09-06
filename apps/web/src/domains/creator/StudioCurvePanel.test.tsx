// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { STUDIO_CURVE_MAX_CONTROL_POINTS, type CurvePoint } from "./studio-curves";
import { StudioCurvePanel } from "./StudioCurvePanel";

import type { StudioImageDataLike } from "./studio-filters";

const curvePanelSource = readFileSync(
  resolve(process.cwd(), "apps/web/src/domains/creator/StudioCurvePanel.tsx"),
  "utf8",
);

// SVG viewBox(170)와 CSS 크기를 1:1로 맞춰 clientX/Y를 그대로 SVG 좌표로 읽게 한다.
const SVG_SIZE = 170;

function stubSvgGeometry(svg: SVGSVGElement): void {
  svg.getBoundingClientRect = () =>
    ({
      bottom: SVG_SIZE,
      height: SVG_SIZE,
      left: 0,
      right: SVG_SIZE,
      toJSON: () => ({}),
      top: 0,
      width: SVG_SIZE,
      x: 0,
      y: 0,
    }) as DOMRect;
}

function ControlledCurvePanel({
  initial,
  onEmit,
}: {
  initial: CurvePoint[];
  onEmit: (points: CurvePoint[]) => void;
}): React.ReactElement {
  const [points, setPoints] = useState(initial);
  return (
    <StudioCurvePanel
      points={points}
      onChange={(next) => {
        onEmit(next);
        setPoints(next);
      }}
      onReset={vi.fn()}
    />
  );
}

function renderControlledCurvePanel(initial: CurvePoint[] = [
  { x: 0, y: 0 },
  { x: 255, y: 255 },
]) {
  const onEmit = vi.fn<(points: CurvePoint[]) => void>();
  const view = render(<ControlledCurvePanel initial={initial} onEmit={onEmit} />);
  const svg = view.container.querySelector<SVGSVGElement>(
    'svg[aria-label^="톤 커브 편집기"]',
  )!;
  stubSvgGeometry(svg);
  return { onEmit, svg, view };
}

function visiblePointCount(svg: SVGSVGElement): number {
  return svg.querySelectorAll('circle[r="4"]').length;
}

afterEach(cleanup);

function renderCurvePanel(): string {
  return renderToStaticMarkup(
    <StudioCurvePanel
      points={[
        { x: 0, y: 0 },
        { x: 128, y: 160 },
        { x: 255, y: 255 },
      ]}
      onChange={vi.fn()}
      onReset={vi.fn()}
    />,
  );
}

describe("StudioCurvePanel", () => {
  it("keeps the visible point geometry while adding a 44px-equivalent transparent target", () => {
    const html = renderCurvePanel();

    expect(html.match(/data-studio-curve-point-hit-target="true"/g)).toHaveLength(3);
    expect(html.match(/width="44" height="44"/g)).toHaveLength(3);
    expect(html.match(/r="4"/g)).toHaveLength(3);
    expect(curvePanelSource).toContain('fill="transparent"');
    expect(curvePanelSource).toContain('pointerEvents="none"');
    expect(curvePanelSource).toContain("const POINT_HIT_SIZE = 44");
    expect(curvePanelSource).toContain("function hitTargetOrigin(coordinate: number)");
    expect(html).toContain("min-w-[170px]");
  });

  it("resolves overlapping touch targets by nearest-point geometry instead of SVG paint order", () => {
    expect(curvePanelSource).toContain("const pointHitRefs = useRef<Array<SVGRectElement | null>>([])");
    expect(curvePanelSource).toContain("POINT_HIT_SIZE / Math.SQRT2");
    expect(curvePanelSource).toContain("onPointerDown={handlePointerDown}");
    expect(curvePanelSource).toContain("pointHitRefs.current[index]?.focus()");
    expect(curvePanelSource).toContain("if (event.detail === 0) setSelectedPointIndex(i)");
    expect(curvePanelSource.match(/setPointerCapture/g)).toHaveLength(1);
    expect(curvePanelSource).not.toContain("onPointerDown={(event) =>");
  });

  it("exposes every curve point as a focusable keyboard control", () => {
    const html = renderCurvePanel();

    expect(html.match(/tabindex="0"/g)).toHaveLength(3);
    expect(html.match(/role="button"/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(html.match(/aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown/g)).toHaveLength(3);
    expect(html).toContain('role="group" aria-label="톤 커브 편집기 (RGB 채널)"');
    expect(html).not.toContain('role="img"');
  });

  it("moves points by one or ten with arrows through the existing normalized engine", () => {
    expect(curvePanelSource).toContain(
      "const step = event.shiftKey ? KEYBOARD_LARGE_STEP : KEYBOARD_STEP",
    );
    expect(curvePanelSource).toContain('if (event.key === "ArrowLeft") x -= step');
    expect(curvePanelSource).toContain('else if (event.key === "ArrowRight") x += step');
    expect(curvePanelSource).toContain('else if (event.key === "ArrowUp") y += step');
    expect(curvePanelSource).toContain('else if (event.key === "ArrowDown") y -= step');
    expect(curvePanelSource).toContain('event.key === "Enter" || event.key === " "');
    expect(curvePanelSource).toContain("emitCurve(moveCurvePoint(curve, index, x, y))");
  });

  it("provides selected-point X/Y inputs and explicit add/delete actions", () => {
    const html = renderCurvePanel();

    expect(html).toContain('data-studio-curve-point-editor="true"');
    expect(html).toContain('aria-label="선택한 제어점 X 좌표"');
    expect(html).toContain('aria-label="선택한 제어점 Y 좌표"');
    expect(html).toContain("점 추가");
    expect(html).toContain("점 삭제");
    expect(html.match(/min-h-11/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(curvePanelSource).toContain("const next = addCurvePoint(curve, suggestedPoint.x, suggestedPoint.y)");
    expect(curvePanelSource).toContain("const next = removeCurvePoint(curve, index)");
  });

  it("protects endpoint X and explains why deletion is unavailable", () => {
    const html = renderCurvePanel();

    expect(html).toMatch(/<input[^>]*readOnly=""[^>]*value="0"/);
    expect(html).toContain("첫 점과 마지막 점의 X 위치는 고정되며 Y만 조절할 수 있습니다.");
    expect(html).toMatch(/disabled=""[^>]*aria-describedby=/);
    expect(curvePanelSource).toContain(
      "const selectedPointIsEndpoint = selectedIndex === 0 || selectedIndex === curve.length - 1",
    );
  });

  it("normalizes malformed ordering before exposing point coordinates", () => {
    const html = renderToStaticMarkup(
      <StudioCurvePanel
        points={[
          { x: 220, y: 200 },
          { x: 30, y: 40 },
        ]}
        onChange={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    const first = html.indexOf("X 0, Y 40");
    const second = html.indexOf("X 30, Y 40");
    const third = html.indexOf("X 220, Y 200");
    const last = html.indexOf("X 255, Y 200");
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second);
    expect(last).toBeGreaterThan(third);
  });

  it("renders unchanged without a histogram source and mounts the luma histogram above the curve when provided", () => {
    expect(renderCurvePanel()).not.toContain("data-studio-histogram");

    const histogramSource: StudioImageDataLike = {
      data: new Uint8ClampedArray([
        0, 0, 0, 255,
        255, 255, 255, 255,
        128, 128, 128, 255,
        9, 9, 9, 0,
      ]),
      width: 2,
      height: 2,
    };
    const html = renderToStaticMarkup(
      <StudioCurvePanel
        points={[
          { x: 0, y: 0 },
          { x: 255, y: 255 },
        ]}
        histogramSource={histogramSource}
        onChange={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    expect(html).toContain('data-studio-histogram-section="true"');
    expect(html).toContain('data-studio-histogram-bars="true"');
    expect(html).toContain("휘도 히스토그램");
    const histogramIndex = html.indexOf("data-studio-histogram-section");
    const curveEditorIndex = html.indexOf("톤 커브 편집기");
    expect(histogramIndex).toBeGreaterThan(0);
    expect(curveEditorIndex).toBeGreaterThan(histogramIndex);
  });

  it("disables point insertion at the bounded shared-document limit and explains recovery", () => {
    const points = Array.from({ length: STUDIO_CURVE_MAX_CONTROL_POINTS }, (_, index) => ({
      x: Math.round(index * 255 / (STUDIO_CURVE_MAX_CONTROL_POINTS - 1)),
      y: Math.round(index * 255 / (STUDIO_CURVE_MAX_CONTROL_POINTS - 1)),
    }));
    const html = renderToStaticMarkup(
      <StudioCurvePanel points={points} onChange={vi.fn()} onReset={vi.fn()} />,
    );

    expect(html).toMatch(/disabled=""[^>]*title="채널마다 제어점은 최대 16개/);
    expect(html).toContain("채널마다 최대 16개까지 사용할 수 있습니다.");
    expect(curvePanelSource).toContain("if (curvePointLimitReached) return;");
  });

  it("adds a point where the graph is clicked and hands the same gesture straight to the drag", () => {
    const { onEmit, svg } = renderControlledCurvePanel();
    expect(visiblePointCount(svg)).toBe(2);

    // 그래프 정중앙 — 어떤 제어점과도 멀어 예전에는 아무 일도 일어나지 않던 좌표.
    // detail은 Chromium의 실제 pointerdown 값(0)을 쓴다 — 클릭 횟수에 기대지 않는다는 계약.
    fireEvent.pointerDown(svg, { button: 0, clientX: 85, clientY: 85, detail: 0 });

    expect(visiblePointCount(svg)).toBe(3);
    expect(onEmit).toHaveBeenCalledTimes(1);
    expect(onEmit.mock.calls[0]?.[0]).toEqual([
      { x: 0, y: 0 },
      { x: 128, y: 128 },
      { x: 255, y: 255 },
    ]);

    // 손을 떼지 않은 채 그대로 끌면 방금 만든 점이 따라온다(다시 잡을 필요 없음).
    fireEvent.pointerMove(svg, { clientX: 85, clientY: 45 });
    const dragged = onEmit.mock.calls.at(-1)?.[0];
    expect(onEmit.mock.calls.length).toBeGreaterThan(1);
    expect(dragged?.[1]).toEqual({ x: 128, y: 195 });
    expect(visiblePointCount(svg)).toBe(3);
  });

  it("keeps a point created by the first press when the gesture becomes a double click", () => {
    const { svg } = renderControlledCurvePanel();

    fireEvent.pointerDown(svg, { button: 0, clientX: 85, clientY: 85, detail: 0 });
    fireEvent.pointerUp(svg, { clientX: 85, clientY: 85 });
    fireEvent.pointerDown(svg, { button: 0, clientX: 85, clientY: 85, detail: 0 });
    fireEvent.pointerUp(svg, { clientX: 85, clientY: 85 });
    fireEvent.doubleClick(svg, { clientX: 85, clientY: 85, detail: 2 });

    expect(visiblePointCount(svg)).toBe(3);
  });

  it("still deletes an existing middle point on a later double click", () => {
    const { svg } = renderControlledCurvePanel([
      { x: 0, y: 0 },
      { x: 128, y: 128 },
      { x: 255, y: 255 },
    ]);
    expect(visiblePointCount(svg)).toBe(3);

    fireEvent.pointerDown(svg, { button: 0, clientX: 85, clientY: 85, detail: 0 });
    fireEvent.pointerUp(svg, { clientX: 85, clientY: 85 });
    fireEvent.pointerDown(svg, { button: 0, clientX: 85, clientY: 85, detail: 0 });
    fireEvent.pointerUp(svg, { clientX: 85, clientY: 85 });
    fireEvent.doubleClick(svg, { clientX: 85, clientY: 85, detail: 2 });

    expect(visiblePointCount(svg)).toBe(2);
  });

  it("documents the pointer contract next to the keyboard one", () => {
    const html = renderCurvePanel();

    expect(html).toContain("그래프의 빈 곳을 클릭하면 그 자리에 점이 생기고 그대로 드래그됩니다.");
    expect(html).toContain("점 위를 더블클릭하면 삭제됩니다.");
    expect(html).toContain("화살표 키로 1, Shift+화살표로 10씩 이동합니다.");
  });
});
