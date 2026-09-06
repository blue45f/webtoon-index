import { describe, expect, it } from "vitest";

import {
  TONE_DEFAULT_SIZE,
  TONE_PRESETS,
  type ToneCategory,
  toneCategoryLabel,
  toneDataUrl,
} from "./studio-tones";

const CATEGORIES: ToneCategory[] = ["dot", "line", "gradient", "crosshatch"];

describe("TONE_DEFAULT_SIZE", () => {
  it("양수 폭/높이를 가진다(패널을 덮는 기본 배치 크기)", () => {
    expect(TONE_DEFAULT_SIZE.width).toBeGreaterThan(0);
    expect(TONE_DEFAULT_SIZE.height).toBeGreaterThan(0);
  });
});

describe("TONE_PRESETS", () => {
  it("16개 내외의 프리셋을 담고 네 카테고리를 모두 포함한다", () => {
    expect(TONE_PRESETS.length).toBeGreaterThanOrEqual(14);
    expect(TONE_PRESETS.length).toBeLessThanOrEqual(18);
    const used = new Set(TONE_PRESETS.map((p) => p.category));
    for (const c of CATEGORIES) {
      expect(used.has(c)).toBe(true);
    }
  });

  it("id가 전부 고유하다", () => {
    const ids = TONE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("각 프리셋이 카테고리·라벨·tip·타일링 SVG를 갖춘다", () => {
    for (const p of TONE_PRESETS) {
      // 카테고리는 4-세트 안.
      expect(CATEGORIES).toContain(p.category);
      // 라벨/팁 비어있지 않음.
      expect(p.label.trim().length).toBeGreaterThan(0);
      expect(p.tip.trim().length).toBeGreaterThan(0);
      // SVG는 루트 + userSpaceOnUse 타일 패턴 + 고유 pattern id 포함.
      expect(p.svg).toContain("<svg");
      expect(p.svg).toContain('patternUnits="userSpaceOnUse"');
      expect(p.svg).toContain(`<pattern id="${p.id}"`);
      expect(p.svg).toContain(`fill="url(#${p.id})"`);
      // 톤은 아트 위에 겹치므로 불투명 배경 rect가 없어야 한다(투명 배경).
      expect(p.svg).not.toContain("#ffffff");
    }
  });

  it("SVG 루트 폭/높이가 TONE_DEFAULT_SIZE와 일치한다", () => {
    for (const p of TONE_PRESETS) {
      expect(p.svg).toContain(`width="${TONE_DEFAULT_SIZE.width}"`);
      expect(p.svg).toContain(`height="${TONE_DEFAULT_SIZE.height}"`);
      expect(p.svg).toContain(`viewBox="0 0 ${TONE_DEFAULT_SIZE.width} ${TONE_DEFAULT_SIZE.height}"`);
    }
  });

  it("pattern id가 프리셋마다 고유해 한 캔버스의 다중 톤이 충돌하지 않는다", () => {
    const patternIds = TONE_PRESETS.map((p) => {
      const m = /<pattern id="([^"]+)"/.exec(p.svg);
      return m ? m[1] : null;
    });
    expect(patternIds.every((id) => id !== null)).toBe(true);
    expect(new Set(patternIds).size).toBe(patternIds.length);
    // 각 SVG는 자기 pattern id를 정확히 1번만 정의한다.
    for (const p of TONE_PRESETS) {
      const occurrences = p.svg.split(`<pattern id="${p.id}"`).length - 1;
      expect(occurrences).toBe(1);
    }
  });

  it("망점 프리셋 6단계를 밀도순으로 담는다", () => {
    const dots = TONE_PRESETS.filter((p) => p.category === "dot");
    expect(dots.map((p) => p.id)).toEqual([
      "tone-dot10",
      "tone-dot20",
      "tone-dot30",
      "tone-dot45",
      "tone-dot60",
      "tone-dot75",
    ]);
    for (const p of dots) {
      expect(p.svg).toContain("<circle");
    }
  });

  it("선/교차선/그라데이션 프리셋이 기대 도형을 담는다", () => {
    const lines = TONE_PRESETS.filter((p) => p.category === "line");
    expect(lines.length).toBe(6); // 가로2 + 세로2 + 사선2
    for (const p of lines) {
      expect(p.svg).toContain("<line");
    }
    const cross = TONE_PRESETS.filter((p) => p.category === "crosshatch");
    expect(cross.length).toBe(2);
    const grad = TONE_PRESETS.filter((p) => p.category === "gradient");
    expect(grad.length).toBe(2);
    for (const p of grad) {
      // 3밴드 = 도트 3개가 한 타일에 쌓인다.
      expect(p.svg.split("<circle").length - 1).toBe(3);
    }
  });
});

describe("toneDataUrl", () => {
  it("data:image/svg+xml;utf8, 접두사로 시작한다", () => {
    const url = toneDataUrl(TONE_PRESETS[0]!.svg);
    expect(url.startsWith("data:image/svg+xml;utf8,")).toBe(true);
  });

  it("인코딩 후 디코딩하면 원본 SVG를 복원한다(round-trip)", () => {
    for (const p of TONE_PRESETS) {
      const url = toneDataUrl(p.svg);
      const tail = url.slice("data:image/svg+xml;utf8,".length);
      const decoded = decodeURIComponent(tail);
      expect(decoded).toBe(p.svg);
      expect(decoded).toContain("<svg");
    }
  });

  it("`#`/공백 같은 문자가 인코딩되어 src에서 깨지지 않는다", () => {
    const url = toneDataUrl('<svg id="t"><rect fill="url(#t)"/></svg>');
    expect(url).not.toContain("#t)"); // 원시 # 가 남지 않음
    expect(url).toContain("%23t"); // # → %23
  });
});

describe("toneCategoryLabel", () => {
  it("네 카테고리를 한글 라벨로 변환한다", () => {
    expect(toneCategoryLabel("dot")).toBe("망점");
    expect(toneCategoryLabel("line")).toBe("선");
    expect(toneCategoryLabel("gradient")).toBe("그라데이션");
    expect(toneCategoryLabel("crosshatch")).toBe("교차선");
  });

  it("모든 카테고리에 비어있지 않은 라벨이 있다", () => {
    for (const c of CATEGORIES) {
      expect(toneCategoryLabel(c).trim().length).toBeGreaterThan(0);
    }
  });
});
