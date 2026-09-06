// @ts-expect-error -- jsdom is a test-only runtime fixture and does not bundle TypeScript types.
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  exportStudioInkMl,
  importStudioInkMl,
  studioInkMlFileName,
} from "./studio-inkml-interchange";

import type { DrawEl } from "./studio-element-model";

const originalDomParser = globalThis.DOMParser;

beforeEach(() => {
  const window = new JSDOM("").window;
  Object.defineProperty(globalThis, "DOMParser", {
    configurable: true,
    value: window.DOMParser,
  });
});

afterEach(() => {
  if (originalDomParser) {
    Object.defineProperty(globalThis, "DOMParser", {
      configurable: true,
      value: originalDomParser,
    });
  } else {
    Reflect.deleteProperty(globalThis, "DOMParser");
  }
});

function stroke(overrides: Partial<DrawEl> = {}): DrawEl {
  return {
    id: "stroke-1",
    type: "draw",
    kind: "freehand",
    mode: "pen",
    points: [1, 2, 3, 4, 8, 9],
    stroke: "#123456",
    strokeWidth: 7,
    opacity: 0.8,
    brush: "g-pen",
    pressures: [0.2, 0.6, 1],
    tiltXs: [-10, 0, 10],
    tiltYs: [20, 10, 0],
    twists: [0, 90, 359],
    speeds: [0, 0.5, 2],
    tangentialPressures: [-0.2, 0, 0.4],
    ...overrides,
  };
}

describe("Studio InkML product interchange", () => {
  it("보이는 펜 자유곡선만 내보내고 손실 요소를 명시적으로 보고한다", async () => {
    const result = await exportStudioInkMl([
      stroke(),
      stroke({ id: "shape-1", kind: "rect" }),
      stroke({ id: "eraser-1", mode: "eraser" }),
      stroke({ id: "hidden-1", hidden: true }),
    ]);

    expect(result.mediaType).toBe("application/inkml+xml");
    expect(result.exportedStrokeIds).toEqual(["stroke-1"]);
    expect(result.skipped).toEqual([
      { elementId: "shape-1", reason: "non-freehand-shape" },
      { elementId: "eraser-1", reason: "eraser-semantic-not-representable" },
      { elementId: "hidden-1", reason: "hidden-element" },
    ]);
    expect(result.conformance.result).toMatchObject({
      conformance: "passed",
      normalization: "stable",
      traceCount: 1,
      sampleCount: 3,
    });
    expect(result.xml).toContain("toonspectrum-inkml-v1");
  });

  it("검증된 InkML을 보수적인 pen 요소로 가져오며 모든 입력 채널을 보존한다", async () => {
    const exported = await exportStudioInkMl([stroke()]);
    const imported = await importStudioInkMl(exported.xml, {
      stroke: "#ABCDEF",
      strokeWidth: 5.5,
      opacity: 0.75,
      brushId: "pen",
      idPrefix: "review-",
    });
    const element = imported.elements[0]!;

    expect(element).toMatchObject({
      id: "review-stroke-1",
      type: "draw",
      kind: "freehand",
      mode: "pen",
      stroke: "#abcdef",
      strokeWidth: 5.5,
      opacity: 0.75,
      brush: "pen",
      points: [1, 2, 3, 4, 8, 9],
      pressures: [0.2, 0.6, 1],
      tiltXs: [-10, 0, 10],
      tiltYs: [20, 10, 0],
      twists: [0, 90, 359],
      speeds: [0, 0.5, 2],
      tangentialPressures: [-0.2, 0, 0.4],
    });
    expect(imported.conformance.result.conformance).toBe("passed");
    expect(imported.ignoredChannels).toEqual([]);
  });

  it("같은 요소 입력은 XML과 conformance receipt가 결정적이다", async () => {
    const first = await exportStudioInkMl([stroke()]);
    const second = await exportStudioInkMl([stroke()]);

    expect(second.xml).toBe(first.xml);
    expect(second.conformance).toEqual(first.conformance);
  });

  it("적합성 실패 XML과 잘못된 스타일 옵션을 fail-closed로 거부한다", async () => {
    await expect(importStudioInkMl(new Uint8Array())).rejects.toThrow(
      "UTF-8 XML 문자열",
    );
    await expect(importStudioInkMl("<ink/>")).rejects.toThrow("적합성 검사");
    const exported = await exportStudioInkMl([stroke()]);
    await expect(
      importStudioInkMl(exported.xml, { stroke: "red" }),
    ).rejects.toThrow("6자리 hex");
    await expect(
      importStudioInkMl(exported.xml, { strokeWidth: 0 }),
    ).rejects.toThrow("0.25px");
    await expect(
      importStudioInkMl(exported.xml, { opacity: 2 }),
    ).rejects.toThrow("불투명도");
    await expect(
      importStudioInkMl(exported.xml, { brushId: "../bad" }),
    ).rejects.toThrow("브러시 ID");
  });

  it("내보낼 수 있는 자유곡선이 없으면 빈 성공 파일을 만들지 않는다", async () => {
    await expect(
      exportStudioInkMl([stroke({ kind: "ellipse" })]),
    ).rejects.toThrow("자유곡선이 없어요");
  });

  it("파일명을 운영체제 금지문자와 길이 예산 안에서 정규화한다", () => {
    expect(studioInkMlFileName("  1화:/초안*  ")).toBe("1화초안.inkml");
    expect(studioInkMlFileName("")).toBe("toonspectrum-ink.inkml");
    expect(studioInkMlFileName("가".repeat(200))).toBe(`${"가".repeat(120)}.inkml`);
  });
});
