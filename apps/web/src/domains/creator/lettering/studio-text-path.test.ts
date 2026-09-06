import { describe, expect, it } from "vitest";

import {
  buildTextPathData,
  DEFAULT_TEXT_PATH,
  estimateTextPathAdvanceWidth,
  isFlatTextPath,
  normalizeTextPath,
  TEXT_PATH_CURVE_RANGE,
  TEXT_PATH_PRESETS,
  TEXT_PATH_SHAPES,
  textPathAdvanceWidth,
  textPathLength,
  textPathShapeLabel,
  type TextPathConfig,
  type TextPathShape,
} from "./studio-text-path";

// 알려진 모양 id 전체(셀렉터/정규화가 받아들여야 하는 값들).
const ALL_SHAPES: TextPathShape[] = ["none", "arcUp", "arcDown", "wave", "circleUp", "circleDown"];

// path data에서 "M x y" 직후 mid 제어점 y(첫 Q/A 인자 뒤)를 뽑기 위한 숫자 추출 헬퍼.
function numbers(data: string): number[] {
  return (data.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
}

/**
 * 테스트 전용 **독립** path 길이 측정기 — 엔진의 길이 계산(textPathLength)을 그대로 다시
 * 부르면 자기 자신을 검증하는 꼴이라, 방출된 문자열만 보고 처음부터 다시 잰다.
 * 이 모듈이 내는 커맨드(M/L/Q/T/A(원호, rx=ry, 회전 0))만 지원한다.
 */
function measurePathData(data: string): number {
  const tokens = data.trim().split(/\s+/);
  const next = () => Number(tokens.shift());
  let x = 0;
  let y = 0;
  let prevCtrl: { x: number; y: number } | null = null;
  let total = 0;
  const sampleQuad = (cx: number, cy: number, ex: number, ey: number) => {
    const STEPS = 512;
    let px = x;
    let py = y;
    for (let i = 1; i <= STEPS; i += 1) {
      const t = i / STEPS;
      const u = 1 - t;
      const qx = u * u * x + 2 * u * t * cx + t * t * ex;
      const qy = u * u * y + 2 * u * t * cy + t * t * ey;
      total += Math.hypot(qx - px, qy - py);
      px = qx;
      py = qy;
    }
  };
  while (tokens.length > 0) {
    const cmd = tokens.shift();
    if (cmd === "M") {
      x = next();
      y = next();
      prevCtrl = null;
    } else if (cmd === "L") {
      const ex = next();
      const ey = next();
      total += Math.hypot(ex - x, ey - y);
      x = ex;
      y = ey;
      prevCtrl = null;
    } else if (cmd === "Q") {
      const cx = next();
      const cy = next();
      const ex = next();
      const ey = next();
      sampleQuad(cx, cy, ex, ey);
      prevCtrl = { x: cx, y: cy };
      x = ex;
      y = ey;
    } else if (cmd === "T") {
      const cx: number = prevCtrl ? 2 * x - prevCtrl.x : x;
      const cy: number = prevCtrl ? 2 * y - prevCtrl.y : y;
      const ex = next();
      const ey = next();
      sampleQuad(cx, cy, ex, ey);
      prevCtrl = { x: cx, y: cy };
      x = ex;
      y = ey;
    } else if (cmd === "A") {
      const rx = next();
      next(); // ry — 이 모듈은 항상 rx와 같은 값을 낸다.
      next(); // x-axis-rotation(0)
      next(); // large-arc-flag(0 = 짧은 호)
      next(); // sweep-flag — 길이에는 영향이 없다.
      const ex = next();
      const ey = next();
      const chord = Math.hypot(ex - x, ey - y);
      total += 2 * rx * Math.asin(Math.min(1, chord / (2 * rx)));
      x = ex;
      y = ey;
      prevCtrl = null;
    } else {
      throw new Error(`unsupported path command: ${cmd ?? "<eof>"} in ${data}`);
    }
  }
  return total;
}

describe("TEXT_PATH_SHAPES", () => {
  it("lists all six shapes with the exact Korean labels", () => {
    expect(TEXT_PATH_SHAPES.map((s) => s.id)).toEqual(ALL_SHAPES);
    expect(TEXT_PATH_SHAPES).toEqual([
      { id: "none", label: "직선" },
      { id: "arcUp", label: "아치 ▲" },
      { id: "arcDown", label: "아치 ▼" },
      { id: "wave", label: "물결" },
      { id: "circleUp", label: "원 위" },
      { id: "circleDown", label: "원 아래" },
    ]);
  });

  it("has unique ids", () => {
    const ids = TEXT_PATH_SHAPES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("DEFAULT_TEXT_PATH / ranges", () => {
  it("defaults to a flat line at the mid curve", () => {
    expect(DEFAULT_TEXT_PATH).toEqual({ shape: "none", curve: 50 });
  });

  it("exposes the 0..100 step-1 curve range", () => {
    expect(TEXT_PATH_CURVE_RANGE).toEqual({ min: 0, max: 100, step: 1 });
  });
});

describe("textPathShapeLabel", () => {
  it("maps each shape to its label", () => {
    expect(textPathShapeLabel("none")).toBe("직선");
    expect(textPathShapeLabel("arcUp")).toBe("아치 ▲");
    expect(textPathShapeLabel("arcDown")).toBe("아치 ▼");
    expect(textPathShapeLabel("wave")).toBe("물결");
    expect(textPathShapeLabel("circleUp")).toBe("원 위");
    expect(textPathShapeLabel("circleDown")).toBe("원 아래");
  });

  it("falls back to 직선 for an unknown shape", () => {
    expect(textPathShapeLabel("spiral" as TextPathShape)).toBe("직선");
  });
});

describe("normalizeTextPath", () => {
  it("returns a copy of the default for nullish/invalid input", () => {
    expect(normalizeTextPath()).toEqual(DEFAULT_TEXT_PATH);
    expect(normalizeTextPath(null)).toEqual(DEFAULT_TEXT_PATH);
    expect(normalizeTextPath(undefined)).toEqual(DEFAULT_TEXT_PATH);
    // 새 객체여야 한다(공유 기본값 변형 방지).
    expect(normalizeTextPath()).not.toBe(DEFAULT_TEXT_PATH);
  });

  it("coerces an unknown shape to none", () => {
    expect(normalizeTextPath({ shape: "zigzag" as TextPathShape, curve: 40 }).shape).toBe("none");
    expect(normalizeTextPath({ shape: undefined, curve: 40 }).shape).toBe("none");
  });

  it("keeps every known shape", () => {
    for (const shape of ALL_SHAPES) {
      expect(normalizeTextPath({ shape, curve: 50 }).shape).toBe(shape);
    }
  });

  it("clamps curve into 0..100", () => {
    expect(normalizeTextPath({ shape: "arcUp", curve: -30 }).curve).toBe(0);
    expect(normalizeTextPath({ shape: "arcUp", curve: 999 }).curve).toBe(100);
    expect(normalizeTextPath({ shape: "arcUp", curve: 63 }).curve).toBe(63);
  });

  it("falls back to the default curve for a non-finite / non-number curve", () => {
    // 무한대·NaN·숫자가 아닌 값은 클램프가 아니라 기본값(50)으로 — 발산 방지.
    expect(normalizeTextPath({ shape: "wave", curve: Number.NaN }).curve).toBe(50);
    expect(normalizeTextPath({ shape: "wave", curve: Infinity }).curve).toBe(50);
    expect(normalizeTextPath({ shape: "wave", curve: -Infinity }).curve).toBe(50);
    expect(normalizeTextPath({ shape: "wave", curve: "80" as unknown as number }).curve).toBe(50);
  });
});

describe("isFlatTextPath", () => {
  it("is true only for the none shape", () => {
    expect(isFlatTextPath({ shape: "none", curve: 50 })).toBe(true);
    expect(isFlatTextPath({ shape: "none", curve: 0 })).toBe(true);
    for (const shape of ALL_SHAPES.filter((s) => s !== "none")) {
      expect(isFlatTextPath({ shape, curve: 50 })).toBe(false);
    }
  });
});

describe("buildTextPathData", () => {
  const W = 400;
  const FS = 48;

  it("none → a horizontal line with M 0 and L commands", () => {
    const data = buildTextPathData({ shape: "none", curve: 50 }, W, FS);
    expect(data).toContain("M 0");
    expect(data).toContain("L");
    expect(data).not.toContain("Q");
    expect(data).not.toContain("A");
    // 두 점의 y가 같아야 수평선이다.
    expect(data).toBe(`M 0 ${FS} L ${W} ${FS}`);
  });

  it("arcUp → a Q curve whose mid control-Y bows above the baseline", () => {
    const data = buildTextPathData({ shape: "arcUp", curve: 70 }, W, FS);
    expect(data).toContain("Q");
    const nums = numbers(data);
    // 숫자 시퀀스: [0]=M의 x(0) [1]=baseY [2]=midX [3]=midY [4]=endX [5]=endY.
    const baseY = nums[1]!; // M 뒤 y
    const midY = nums[3]!; // Q 첫 제어점 y
    expect(midY).toBeLessThan(baseY); // 위로 볼록 → 제어점이 baseline 위(작은 y).
  });

  it("arcDown → a Q curve whose mid control-Y bows below the baseline", () => {
    const data = buildTextPathData({ shape: "arcDown", curve: 70 }, W, FS);
    expect(data).toContain("Q");
    const nums = numbers(data);
    const baseY = nums[1]!;
    const midY = nums[3]!;
    expect(midY).toBeGreaterThan(baseY); // 아래로 볼록 → 제어점이 baseline 아래(큰 y).
  });

  it("wave → contains both Q and T commands", () => {
    const data = buildTextPathData({ shape: "wave", curve: 60 }, W, FS);
    expect(data).toContain("Q");
    expect(data).toContain("T");
  });

  it("circleUp / circleDown → contain an A (arc) command", () => {
    expect(buildTextPathData({ shape: "circleUp", curve: 60 }, W, FS)).toContain("A");
    expect(buildTextPathData({ shape: "circleDown", curve: 60 }, W, FS)).toContain("A");
  });

  it("uses opposite arc sweep flags for circleUp vs circleDown", () => {
    const up = buildTextPathData({ shape: "circleUp", curve: 60 }, W, FS);
    const down = buildTextPathData({ shape: "circleDown", curve: 60 }, W, FS);
    // A rx ry rot large sweep x y — sweep는 끝 좌표 앞 두 번째 플래그.
    const sweepOf = (data: string) => {
      const m = data.match(/A [^ ]+ [^ ]+ 0 0 ([01]) /);
      return m?.[1];
    };
    expect(sweepOf(up)).toBe("1");
    expect(sweepOf(down)).toBe("0");
  });

  it("bigger curve → bigger deviation from the baseline (arcUp)", () => {
    const baseYof = (curve: number) => numbers(buildTextPathData({ shape: "arcUp", curve }, W, FS));
    const low = baseYof(20);
    const high = baseYof(90);
    const baseY = low[1]!; // baseY는 curve와 무관하게 동일.
    const lowDev = baseY - low[3]!; // 위로 휜 깊이(baseY - midY).
    const highDev = baseY - high[3]!;
    expect(highDev).toBeGreaterThan(lowDev);
  });

  it("bigger curve → bigger amplitude for wave", () => {
    const ampOf = (curve: number) => {
      const nums = numbers(buildTextPathData({ shape: "wave", curve }, W, FS));
      return nums[1]! - nums[3]!; // baseY - 첫 제어점 y.
    };
    expect(ampOf(90)).toBeGreaterThan(ampOf(20));
  });

  it("bigger curve → rounder circle (smaller radius)", () => {
    const radiusOf = (curve: number) => {
      const m = buildTextPathData({ shape: "circleUp", curve }, W, FS).match(/A ([^ ]+) /);
      return Number(m?.[1]);
    };
    // curve가 클수록 새그가 커져 반지름이 작아진다(더 둥글다).
    expect(radiusOf(90)).toBeLessThan(radiusOf(30));
  });

  it("produces no NaN/Infinity for every shape", () => {
    for (const shape of ALL_SHAPES) {
      for (const curve of [0, 50, 100]) {
        const data = buildTextPathData({ shape, curve }, W, FS);
        expect(data).not.toMatch(/NaN|Infinity/);
        for (const n of numbers(data)) expect(Number.isFinite(n)).toBe(true);
      }
    }
  });

  it("is safe (no NaN/Infinity) when width and fontSize are 0", () => {
    for (const shape of ALL_SHAPES) {
      for (const curve of [0, 50, 100]) {
        const data = buildTextPathData({ shape, curve }, 0, 0);
        expect(data).not.toMatch(/NaN|Infinity/);
        expect(data.length).toBeGreaterThan(0);
        for (const n of numbers(data)) expect(Number.isFinite(n)).toBe(true);
      }
    }
  });

  it("is safe with negative / non-finite width and fontSize", () => {
    const data = buildTextPathData(
      { shape: "circleUp", curve: 80 },
      Number.NaN,
      Number.NEGATIVE_INFINITY,
    );
    expect(data).not.toMatch(/NaN|Infinity/);
    for (const n of numbers(data)) expect(Number.isFinite(n)).toBe(true);
  });

  it("normalizes an unknown shape to the none line", () => {
    const data = buildTextPathData({ shape: "spiral" as TextPathShape, curve: 50 }, W, FS);
    expect(data).toContain("M 0");
    expect(data).toContain("L");
    expect(data).not.toContain("Q");
  });

  it("clamps a circle's degenerate zero curve into a straight fallback", () => {
    // curve 0이면 새그가 0 — 반지름 발산 대신 직선으로 안전 폴백.
    const data = buildTextPathData({ shape: "circleUp", curve: 0 }, W, FS);
    expect(data).not.toContain("A");
    expect(data).toContain("L");
    for (const n of numbers(data)) expect(Number.isFinite(n)).toBe(true);
  });

  it("never emits a degenerate (collinear) curve — every zero-curve shape is a plain line", () => {
    // 퇴화한 2차 베지어는 Konva의 닫힌형 길이 공식에서 자릿수 상쇄를 일으켜 pathLength가
    // 실제보다 짧게(혹은 NaN으로) 나오고, 그만큼 글자가 잘린다. 아예 만들지 않는다.
    for (const shape of ALL_SHAPES) {
      const data = buildTextPathData({ shape, curve: 0 }, W, FS);
      expect(data).not.toContain("Q");
      expect(data).not.toContain("T");
      expect(data).not.toContain("A");
      expect(data).toContain("L");
    }
  });
});

// ---------------------------------------------------------------------------
// D6 회귀 — 곡선 프리셋이 글자를 버리던 결함.
// Konva TextPath / SVG <textPath>는 경로 길이를 넘는 글자를 조용히 버린다. 경로가 요소 박스
// 폭으로만 만들어져 있어서, 기본 텍스트 요소(220×40)에 한글 12자를 넣으면 실측 결과
// 아치 6/12, 물결 6/12, 원 위·아래 7/12만 그려졌다(Chromium + Pretendard Bold).
// ---------------------------------------------------------------------------
describe("buildTextPathData — 경로 길이 = 글자 예산 (D6)", () => {
  const CURVED = ALL_SHAPES.filter((s) => s !== "none");

  it("가장 짧은 곡선 프리셋도 기본 요소(220×40)의 한글 12자를 담는다", () => {
    const advance = estimateTextPathAdvanceWidth({ text: "가나다라마바사아자차카타", fontSize: 40 });
    // 브라우저 실측(Pretendard Bold 40px)은 415.2px — 추정치는 그보다 짧으면 안 된다.
    expect(advance).toBeGreaterThanOrEqual(415.2);
    for (const preset of TEXT_PATH_PRESETS) {
      const data = buildTextPathData(preset.value, 220, 40, advance);
      // 고치기 전 경로 길이는 220~260px에 불과했다(= 12자 중 6~7자만 들어감).
      expect(measurePathData(data)).toBeGreaterThanOrEqual(advance);
    }
  });

  it("모든 모양 × 곡률 × 텍스트에서 경로가 글자 폭보다 짧아지지 않는다", () => {
    const texts = ["가나다라마바사아자차카타", "쾅!!", "KABOOM!!! WHAM", "漢字とカタカナ", "🔥💥✨"];
    for (const shape of ALL_SHAPES) {
      for (const curve of [0, 1, 20, 50, 70, 100]) {
        for (const text of texts) {
          for (const fontSize of [10, 40, 120]) {
            for (const letterSpacing of [0, 6]) {
              const advance = estimateTextPathAdvanceWidth({ text, fontSize, letterSpacing });
              const data = buildTextPathData({ shape, curve }, 220, fontSize, advance);
              expect(measurePathData(data)).toBeGreaterThanOrEqual(advance);
              expect(data).not.toMatch(/NaN|Infinity/);
            }
          }
        }
      }
    }
  });

  it("박스 폭으로 이미 충분한 짧은 텍스트는 path 문자열이 한 글자도 바뀌지 않는다", () => {
    for (const shape of CURVED) {
      const advance = estimateTextPathAdvanceWidth({ text: "쾅", fontSize: 32 });
      expect(buildTextPathData({ shape, curve: 70 }, 400, 32, advance)).toBe(
        buildTextPathData({ shape, curve: 70 }, 400, 32),
      );
    }
  });

  it("경로를 늘려도 곡률 비율(모양)은 유지된다 — 같은 모양이 커질 뿐", () => {
    // arcUp: 활 깊이 / 현 폭 비율이 그대로여야 "더 넓어진 같은 아치"다.
    const bowRatio = (data: string) => {
      const n = numbers(data); // [0, baseY, midX, midY, endX, endY]
      return (n[1]! - n[3]!) / n[4]!;
    };
    const short = buildTextPathData({ shape: "arcUp", curve: 70 }, 220, 40);
    const long = buildTextPathData({ shape: "arcUp", curve: 70 }, 220, 40, 900);
    expect(numbers(long)[4]!).toBeGreaterThan(numbers(short)[4]!);
    expect(bowRatio(long)).toBeCloseTo(bowRatio(short), 3);
  });

  it("minPathLength가 없거나 0/음수/비유한이면 예전과 똑같이 박스 폭만 쓴다", () => {
    for (const shape of ALL_SHAPES) {
      const plain = buildTextPathData({ shape, curve: 60 }, 400, 48);
      for (const bogus of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(buildTextPathData({ shape, curve: 60 }, 400, 48, bogus)).toBe(plain);
      }
    }
  });

  it("textPathLength는 방출된 path의 실제 길이와 일치한다", () => {
    for (const shape of ALL_SHAPES) {
      for (const curve of [0, 35, 100]) {
        const own = textPathLength({ shape, curve }, 220, 40, 500);
        const measured = measurePathData(buildTextPathData({ shape, curve }, 220, 40, 500));
        expect(own).toBeCloseTo(measured, 0);
      }
    }
  });
});

describe("텍스트 진행 폭 추정", () => {
  it("한글은 전각(1em 이상)으로 센다 — 라틴 기준 추정이면 한글이 잘린다", () => {
    // 한글 12자 @40px는 최소 480px. 라틴 12자보다 확실히 넓어야 한다.
    const korean = estimateTextPathAdvanceWidth({ text: "가나다라마바사아자차카타", fontSize: 40 });
    const latin = estimateTextPathAdvanceWidth({ text: "abcdefghijkl", fontSize: 40 });
    expect(korean).toBeGreaterThanOrEqual(12 * 40);
    expect(korean).toBeGreaterThan(latin);
  });

  it("한자·가나·전각 기호도 전각으로 센다", () => {
    for (const text of ["漢字", "カタカナ", "ひらがな", "ＡＢ"]) {
      expect(estimateTextPathAdvanceWidth({ text, fontSize: 20 })).toBeGreaterThanOrEqual(
        [...text].length * 20,
      );
    }
  });

  it("자간을 글자 수만큼 더한다(Konva TextPath가 소비하는 규칙)", () => {
    const base = estimateTextPathAdvanceWidth({ text: "가나다", fontSize: 20 });
    expect(estimateTextPathAdvanceWidth({ text: "가나다", fontSize: 20, letterSpacing: 5 })).toBe(
      base + 3 * 5,
    );
  });

  it("빈 문자열·비유한 입력에도 유한한 값을 낸다", () => {
    expect(estimateTextPathAdvanceWidth({ text: "", fontSize: 40 })).toBe(0);
    expect(textPathAdvanceWidth({ text: "", fontSize: 40 })).toBe(0);
    const weird = estimateTextPathAdvanceWidth({
      text: "가",
      fontSize: Number.NaN,
      letterSpacing: Number.NaN,
    });
    expect(Number.isFinite(weird)).toBe(true);
    expect(weird).toBeGreaterThan(0);
  });

  it("캔버스가 없는 환경(node/SSR)에서는 추정치로 폴백한다", () => {
    // vitest 기본 환경에는 document가 없다 — 실측 대신 추정치가 그대로 나와야 한다.
    const input = { text: "두구두구두구", fontSize: 48, letterSpacing: 2 };
    expect(textPathAdvanceWidth(input)).toBe(estimateTextPathAdvanceWidth(input));
  });
});

describe("TEXT_PATH_PRESETS", () => {
  it("has the straight (none) preset first", () => {
    expect(TEXT_PATH_PRESETS[0]!.value.shape).toBe("none");
    expect(TEXT_PATH_PRESETS[0]!.label).toBe("직선");
  });

  it("has unique ids", () => {
    const ids = TEXT_PATH_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only uses valid shapes and in-range curves", () => {
    const shapeIds = new Set<TextPathShape>(ALL_SHAPES);
    for (const preset of TEXT_PATH_PRESETS) {
      expect(shapeIds.has(preset.value.shape)).toBe(true);
      expect(preset.value.curve).toBeGreaterThanOrEqual(TEXT_PATH_CURVE_RANGE.min);
      expect(preset.value.curve).toBeLessThanOrEqual(TEXT_PATH_CURVE_RANGE.max);
    }
  });

  it("survives normalization unchanged (already canonical)", () => {
    for (const preset of TEXT_PATH_PRESETS) {
      expect(normalizeTextPath(preset.value)).toEqual(preset.value);
    }
  });

  it("has non-empty labels and tips", () => {
    for (const preset of TEXT_PATH_PRESETS) {
      expect(preset.label.trim().length).toBeGreaterThan(0);
      expect(preset.tip.trim().length).toBeGreaterThan(0);
    }
  });

  it("covers the documented preset set", () => {
    const byShapeCurve = TEXT_PATH_PRESETS.map((p) => `${p.value.shape}:${p.value.curve}`);
    const expected: (readonly [TextPathShape, number])[] = [
      ["none", 50],
      ["arcUp", 70],
      ["arcUp", 100],
      ["arcDown", 70],
      ["wave", 60],
      ["circleUp", 60],
    ];
    expect(byShapeCurve).toEqual(expected.map(([s, c]) => `${s}:${c}`));
  });
});

// 타입 가드용 — TextPathConfig가 정확히 두 필드를 갖는지 컴파일 시 확인.
const _typeCheck: TextPathConfig = { shape: "wave", curve: 10 };
void _typeCheck;
