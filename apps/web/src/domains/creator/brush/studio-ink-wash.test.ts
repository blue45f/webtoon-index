import { describe, expect, it } from "vitest";

import {
  DEFAULT_INK_WASH,
  DEFAULT_INK_WASH_EDGE_DARKENING,
  DEFAULT_INK_WASH_PAPER_KIND,
  INK_WASH_EDGE_BLEED_RANGE,
  INK_WASH_EDGE_DARKENING_RANGE,
  INK_WASH_GRANULATION_RANGE,
  INK_WASH_PAPER_RANGE,
  INK_WASH_PRESETS,
  INK_WASH_SPREAD_RANGE,
  INK_WASH_STRENGTH_RANGE,
  applyInkWash,
  inkWashKonvaFilter,
  isIdentityInkWash,
  normalizeInkWash,
  type InkWash,
} from "./studio-ink-wash";
import { PAPER_REFERENCE_TILE, createPaperHeightField } from "./studio-paper-texture";

import type { StudioImageDataLike } from "../studio-filters";

function makeImage(width: number, height: number, pixels: number[][]): StudioImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  pixels.forEach((pixel, index) => data.set(pixel, index * 4));
  return { data, width, height };
}

function makeSolid(width: number, height: number, rgba: [number, number, number, number]): StudioImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) data.set(rgba, pixel * 4);
  return { data, width, height };
}

function pixelAt(image: StudioImageDataLike, x: number, y = 0): number[] {
  const offset = (y * image.width + x) * 4;
  return Array.from(image.data.slice(offset, offset + 4));
}

function copyImage(image: StudioImageDataLike): StudioImageDataLike {
  return { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) };
}

function dataEqual(left: StudioImageDataLike, right: StudioImageDataLike): boolean {
  if (left.data.length !== right.data.length) return false;
  for (let index = 0; index < left.data.length; index++) {
    if (left.data[index] !== right.data[index]) return false;
  }
  return true;
}

function alphaValues(image: StudioImageDataLike): number[] {
  const alpha: number[] = [];
  for (let index = 3; index < image.data.length; index += 4) alpha.push(image.data[index]!);
  return alpha;
}

/** 가운데의 검은 먹점을 흰 종이 위에 놓은 edge bleed 테스트용 이미지. */
function makeInkDot(width = 17): StudioImageDataLike {
  const image = makeSolid(width, 1, [255, 255, 255, 255]);
  const center = Math.floor(width / 2) * 4;
  image.data[center] = 0;
  image.data[center + 1] = 0;
  image.data[center + 2] = 0;
  return image;
}

function makePattern(width = 14, height = 10): StudioImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      data[offset] = (31 + x * 17 + y * 7) % 256;
      data[offset + 1] = (205 - x * 11 + y * 19 + 256) % 256;
      data[offset + 2] = (67 + x * 5 + y * 23) % 256;
      data[offset + 3] = (x + y) % 5 === 0 ? 120 : 255;
    }
  }
  return { data, width, height };
}

describe("DEFAULT_INK_WASH / ranges / identity", () => {
  it("기본값은 strength 0인 항등 수묵 번짐 설정이다", () => {
    expect(DEFAULT_INK_WASH).toEqual({
      strength: 0,
      spread: 3,
      edgeBleed: 48,
      granulation: 38,
      paper: 46,
      inkColor: "#20282c",
      seed: 41,
    });
    expect(isIdentityInkWash(DEFAULT_INK_WASH)).toBe(true);
  });

  it("범위 상수는 UI의 픽셀/퍼센트 스케일을 명확히 노출한다", () => {
    expect(INK_WASH_STRENGTH_RANGE).toEqual({ min: 0, max: 100, step: 1 });
    expect(INK_WASH_SPREAD_RANGE).toEqual({ min: 1, max: 12, step: 1 });
    expect(INK_WASH_EDGE_BLEED_RANGE).toEqual({ min: 0, max: 100, step: 1 });
    expect(INK_WASH_GRANULATION_RANGE).toEqual({ min: 0, max: 100, step: 1 });
    expect(INK_WASH_PAPER_RANGE).toEqual({ min: 0, max: 100, step: 1 });
  });

  it("0/음수/NaN strength는 항등이고 양수만 효과를 켠다", () => {
    expect(isIdentityInkWash({ strength: 0 })).toBe(true);
    expect(isIdentityInkWash({ strength: -1 })).toBe(true);
    expect(isIdentityInkWash({ strength: Number.NaN })).toBe(true);
    expect(isIdentityInkWash({ strength: 0.01 })).toBe(false);
  });
});

describe("normalizeInkWash", () => {
  it("undefined/null과 누락 키를 기본값으로 안전하게 채운다", () => {
    expect(normalizeInkWash()).toEqual(DEFAULT_INK_WASH);
    expect(normalizeInkWash(null)).toEqual(DEFAULT_INK_WASH);
    expect(normalizeInkWash({ strength: 55, inkColor: "#ABCDEF" })).toEqual({
      ...DEFAULT_INK_WASH,
      strength: 55,
      inkColor: "#abcdef",
    });
  });

  it("범위 밖 값은 클램프하고 spread/seed는 정수로 내린다", () => {
    expect(
      normalizeInkWash({
        strength: 200,
        spread: 99.8,
        edgeBleed: -3,
        granulation: 122,
        paper: -4,
        seed: 10001.9,
      }),
    ).toEqual({
      ...DEFAULT_INK_WASH,
      strength: 100,
      spread: 12,
      edgeBleed: 0,
      granulation: 100,
      paper: 0,
      seed: 9999,
    });
    expect(normalizeInkWash({ spread: 4.9, seed: 17.7 })).toMatchObject({ spread: 4, seed: 17 });
  });

  it("무효 숫자와 무효 색은 기본값으로 되돌린다", () => {
    const output = normalizeInkWash({
      strength: "80" as unknown as number,
      spread: Number.NaN,
      edgeBleed: Number.POSITIVE_INFINITY,
      granulation: Number.NEGATIVE_INFINITY,
      paper: "75" as unknown as number,
      inkColor: "rgb(0, 0, 0)",
      seed: Number.NaN,
    });
    expect(output).toEqual(DEFAULT_INK_WASH);
  });
});

describe("applyInkWash — 항등과 재질 합성", () => {
  it("strength 0이면 데이터가 정확히 불변이다", () => {
    const image = makeImage(3, 1, [
      [12, 40, 80, 0],
      [100, 150, 200, 127],
      [230, 20, 80, 255],
    ]);
    const before = copyImage(image);
    applyInkWash(image, DEFAULT_INK_WASH);
    expect(dataEqual(image, before)).toBe(true);
  });

  it("종이·번짐·과립을 모두 껐을 때 불투명한 순백은 순백으로 남는다", () => {
    const image = makeSolid(8, 6, [255, 255, 255, 255]);
    const before = copyImage(image);
    applyInkWash(image, {
      ...DEFAULT_INK_WASH,
      strength: 100,
      edgeBleed: 0,
      granulation: 0,
      paper: 0,
    });
    expect(dataEqual(image, before)).toBe(true);
  });

  it("같은 입력·설정·seed는 같고, seed가 바뀌면 종이/과립 결과도 바뀐다", () => {
    const settings: InkWash = {
      ...DEFAULT_INK_WASH,
      strength: 100,
      spread: 4,
      edgeBleed: 70,
      granulation: 85,
      paper: 90,
      seed: 77,
    };
    const first = makePattern();
    const second = makePattern();
    const differentSeed = makePattern();
    const original = makePattern();

    applyInkWash(first, settings);
    applyInkWash(second, settings);
    applyInkWash(differentSeed, { ...settings, seed: 78 });

    expect(dataEqual(first, original)).toBe(false);
    expect(dataEqual(first, second)).toBe(true);
    expect(dataEqual(first, differentSeed)).toBe(false);
  });

  it("원본 알파를 모든 효과 조합에서 보존하고 완전 투명 RGB는 건드리지 않는다", () => {
    const image = makeImage(4, 1, [
      [7, 13, 29, 0],
      [10, 20, 30, 44],
      [130, 90, 50, 150],
      [250, 240, 210, 255],
    ]);
    const before = copyImage(image);
    const alphaBefore = alphaValues(image);

    applyInkWash(image, {
      ...DEFAULT_INK_WASH,
      strength: 100,
      spread: 5,
      edgeBleed: 100,
      granulation: 100,
      paper: 100,
    });

    expect(alphaValues(image)).toEqual(alphaBefore);
    expect(pixelAt(image, 0)).toEqual(pixelAt(before, 0));
  });
});

describe("applyInkWash — wet edge bleed", () => {
  const baseSettings: InkWash = {
    ...DEFAULT_INK_WASH,
    strength: 100,
    inkColor: "#000000",
    paper: 0,
    granulation: 0,
    seed: 1,
  };

  it("edgeBleed는 검은 안료의 바로 옆 밝은 종이에 실제로 스며든다", () => {
    const dry = makeInkDot(9);
    const wet = makeInkDot(9);

    applyInkWash(dry, { ...baseSettings, spread: 2, edgeBleed: 0 });
    applyInkWash(wet, { ...baseSettings, spread: 2, edgeBleed: 100 });

    // 중앙은 둘 다 먹색이지만, x=3은 wet 쪽에서만 확산 안료가 닿는다.
    expect(pixelAt(dry, 3)[0]).toBe(255);
    expect(pixelAt(wet, 3)[0]).toBeLessThan(255);
    expect(pixelAt(wet, 3)[3]).toBe(255);
  });

  it("spread가 넓으면 더 먼 밝은 종이까지 안료가 닿는다", () => {
    const tight = makeInkDot();
    const wide = makeInkDot();

    applyInkWash(tight, { ...baseSettings, spread: 1, edgeBleed: 100 });
    applyInkWash(wide, { ...baseSettings, spread: 5, edgeBleed: 100 });

    // 중앙(8)에서 4px 떨어진 x=4: 반경 1은 닿지 않고, 반경 5는 닿는다.
    expect(pixelAt(tight, 4)[0]).toBe(255);
    expect(pixelAt(wide, 4)[0]).toBeLessThan(255);
  });
});

describe("applyInkWash — paper and defensive raster handling", () => {
  it("paper 값은 흰 바탕을 따뜻한 섬유 종이로 바꾸며 alpha는 그대로다", () => {
    const bare = makeSolid(12, 8, [255, 255, 255, 220]);
    const papered = copyImage(bare);
    const settings = { ...DEFAULT_INK_WASH, strength: 100, edgeBleed: 0, granulation: 0 };

    applyInkWash(bare, { ...settings, paper: 0 });
    applyInkWash(papered, { ...settings, paper: 100, seed: 9 });

    expect(pixelAt(bare, 0, 0)).toEqual([255, 255, 255, 220]);
    expect(pixelAt(papered, 0, 0)[0]).toBeLessThan(255);
    expect(pixelAt(papered, 0, 0)[2]).toBeLessThan(pixelAt(papered, 0, 0)[0]!);
    expect(alphaValues(papered)).toEqual(alphaValues(bare));
  });

  it("0 크기·불완전 버퍼에도 throw하거나 일부 데이터를 덮어쓰지 않는다", () => {
    const empty: StudioImageDataLike = { data: new Uint8ClampedArray(0), width: 0, height: 0 };
    expect(() => applyInkWash(empty, { ...DEFAULT_INK_WASH, strength: 100 })).not.toThrow();

    const malformed: StudioImageDataLike = {
      data: new Uint8ClampedArray([10, 20, 30, 40]),
      width: 2,
      height: 1,
    };
    const before = Array.from(malformed.data);
    expect(() => applyInkWash(malformed, { ...DEFAULT_INK_WASH, strength: 100 })).not.toThrow();
    expect(Array.from(malformed.data)).toEqual(before);
  });
});

describe("INK_WASH_PRESETS", () => {
  it("첫 프리셋은 항등이고 나머지는 바로 적용할 수 있는 재질 프리셋이다", () => {
    expect(INK_WASH_PRESETS[0]!.id).toBe("none");
    expect(isIdentityInkWash(INK_WASH_PRESETS[0]!.value)).toBe(true);
    for (const preset of INK_WASH_PRESETS.slice(1)) {
      expect(isIdentityInkWash(preset.value)).toBe(false);
      expect(normalizeInkWash(preset.value)).toEqual(preset.value);
    }
  });

  it("프리셋 id는 고유하고 수묵/청묵/세피아/주인 변주를 제공한다", () => {
    const ids = INK_WASH_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(["sumi-e", "indigo-wash", "antique-sepia", "vermilion-seal"]));
  });
});

describe("inkWashKonvaFilter", () => {
  it("Konva attrs를 읽어 순수 효과를 실행한다", () => {
    const image = makeInkDot(9);
    inkWashKonvaFilter.call(
      {
        attrs: {
          inkWashStrength: 100,
          inkWashSpread: 2,
          inkWashEdgeBleed: 100,
          inkWashGranulation: 0,
          inkWashPaper: 0,
          inkWashColor: "#000000",
          inkWashSeed: 4,
        },
      },
      image,
    );
    expect(pixelAt(image, 3)[0]).toBeLessThan(255);
  });

  it("attrs가 없거나 strength 0이면 no-op이고 무효 attrs도 안전하다", () => {
    const withoutAttrs = makeInkDot(7);
    const noOp = copyImage(withoutAttrs);
    const invalid = makeInkDot(7);
    const invalidBefore = copyImage(invalid);

    expect(() => inkWashKonvaFilter.call({}, withoutAttrs)).not.toThrow();
    expect(dataEqual(withoutAttrs, noOp)).toBe(true);

    inkWashKonvaFilter.call(
      {
        attrs: {
          inkWashStrength: "100" as unknown as number,
          inkWashSpread: Number.NaN,
          inkWashColor: "no-color",
        },
      },
      invalid,
    );
    expect(dataEqual(invalid, invalidBefore)).toBe(true);
  });

  it("새 attr(paperKind/edgeDarkening)을 읽어 종이 결과 가장자리 링을 바꾼다", () => {
    const base = { inkWashStrength: 100, inkWashSpread: 3, inkWashEdgeBleed: 60, inkWashGranulation: 90, inkWashPaper: 0, inkWashColor: "#000000", inkWashSeed: 5 };
    // 균일한 회색은 습윤 그래디언트가 0이라 edgeDarkening이 항등이다 — 얼룩진 워시로 만든다.
    const makeBlob = (): StudioImageDataLike => {
      const image = makeSolid(24, 24, [235, 235, 235, 255]);
      for (let y = 7; y < 17; y++) {
        for (let x = 7; x < 17; x++) {
          const offset = (y * 24 + x) * 4;
          image.data[offset] = 40;
          image.data[offset + 1] = 40;
          image.data[offset + 2] = 40;
        }
      }
      return image;
    };
    const smooth = makeBlob();
    const coarse = makeBlob();
    const dried = makeBlob();

    inkWashKonvaFilter.call({ attrs: { ...base, inkWashPaperKind: "hot-press" } }, smooth);
    inkWashKonvaFilter.call({ attrs: { ...base, inkWashPaperKind: "rough" } }, coarse);
    inkWashKonvaFilter.call({ attrs: { ...base, inkWashPaperKind: "rough", inkWashEdgeDarkening: 80 } }, dried);

    expect(dataEqual(smooth, coarse)).toBe(false);
    expect(dataEqual(coarse, dried)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 종이 결 물리 — studio-paper-texture 접합
// ---------------------------------------------------------------------------

/** 픽셀 배열의 R 채널만 뽑는다. */
function redChannel(image: StudioImageDataLike): number[] {
  const red: number[] = [];
  for (let index = 0; index < image.data.length; index += 4) red.push(image.data[index]!);
  return red;
}

function pearson(left: ArrayLike<number>, right: ArrayLike<number>): number {
  const average = (values: ArrayLike<number>): number => {
    let sum = 0;
    for (let index = 0; index < values.length; index++) sum += values[index]!;
    return sum / values.length;
  };
  const meanLeft = average(left);
  const meanRight = average(right);
  let covariance = 0;
  let varianceLeft = 0;
  let varianceRight = 0;
  for (let index = 0; index < left.length; index++) {
    const a = left[index]! - meanLeft;
    const b = right[index]! - meanRight;
    covariance += a * b;
    varianceLeft += a * a;
    varianceRight += b * b;
  }
  return covariance / Math.sqrt(varianceLeft * varianceRight);
}

describe("normalizeInkWash — 선택 필드(paperKind/edgeDarkening)", () => {
  it("입력에 없으면 출력에도 넣지 않는다(기존 7키 저장본 round-trip 보존)", () => {
    const normalized = normalizeInkWash({ strength: 50 });
    expect("paperKind" in normalized).toBe(false);
    expect("edgeDarkening" in normalized).toBe(false);
    expect(DEFAULT_INK_WASH_EDGE_DARKENING).toBe(0);
    expect(DEFAULT_INK_WASH_PAPER_KIND).toBe("cold-press");
  });

  it("입력에 있으면 정규화해서 유지한다", () => {
    expect(normalizeInkWash({ paperKind: "rough", edgeDarkening: 62 })).toMatchObject({
      paperKind: "rough",
      edgeDarkening: 62,
    });
    expect(INK_WASH_EDGE_DARKENING_RANGE).toEqual({ min: 0, max: 100, step: 1 });
  });

  it("무효한 선택 값은 안전한 기본으로 접는다", () => {
    expect(
      normalizeInkWash({ paperKind: "papyrus" as never, edgeDarkening: 999 }),
    ).toMatchObject({ paperKind: "cold-press", edgeDarkening: 100 });
    expect(normalizeInkWash({ edgeDarkening: Number.NaN })).toMatchObject({ edgeDarkening: 0 });
  });

  it("선택 값을 담은 설정도 round-trip 한다", () => {
    const value = normalizeInkWash({ ...DEFAULT_INK_WASH, strength: 70, paperKind: "hot-press", edgeDarkening: 30 });
    expect(normalizeInkWash(value)).toEqual(value);
  });
});

describe("applyInkWash — 입자 침착(granulation)", () => {
  const TILE = PAPER_REFERENCE_TILE;

  it("안료가 종이 높이맵의 골에 몰린다(밝기와 높이의 강한 양의 상관)", () => {
    const image = makeSolid(TILE, TILE, [128, 128, 128, 255]);
    applyInkWash(image, {
      ...DEFAULT_INK_WASH,
      strength: 100,
      edgeBleed: 0,
      granulation: 70,
      paper: 0,
      inkColor: "#000000",
      seed: 41,
      paperKind: "cold-press",
    });
    const paper = createPaperHeightField({ kind: "cold-press", width: TILE, height: TILE, seed: 41 });
    // 골(낮은 height)에 안료가 더 남아 어두워지므로 R은 height와 같이 움직인다.
    expect(pearson(redChannel(image), paper.values)).toBeGreaterThan(0.9);
  });

  it("종이 종류를 바꾸면 침착 패턴이 실제로 달라진다", () => {
    const settings: InkWash = {
      ...DEFAULT_INK_WASH,
      strength: 100,
      edgeBleed: 0,
      granulation: 80,
      paper: 0,
      inkColor: "#000000",
      seed: 41,
    };
    const smooth = makeSolid(TILE, 16, [128, 128, 128, 255]);
    const coarse = makeSolid(TILE, 16, [128, 128, 128, 255]);
    applyInkWash(smooth, { ...settings, paperKind: "hot-press" });
    applyInkWash(coarse, { ...settings, paperKind: "rough" });
    expect(dataEqual(smooth, coarse)).toBe(false);

    // 황목이 더 거친 종이이므로 같은 안료라도 밝기 편차가 커야 한다.
    const range = (image: StudioImageDataLike): number => {
      const red = redChannel(image);
      return Math.max(...red) - Math.min(...red);
    };
    expect(range(coarse)).toBeGreaterThan(range(smooth));
  });

  it("granulation 0이면 종이 골 침착이 사라진다(조작 감지)", () => {
    const flat = makeSolid(64, 8, [128, 128, 128, 255]);
    applyInkWash(flat, {
      ...DEFAULT_INK_WASH,
      strength: 100,
      edgeBleed: 0,
      granulation: 0,
      paper: 0,
      inkColor: "#000000",
    });
    const red = redChannel(flat);
    expect(Math.max(...red) - Math.min(...red)).toBe(0);
  });

  it("종이 타일은 seamless라 넓은 캔버스에서 반복 이음선이 없다", () => {
    const wide = makeSolid(TILE * 2 + 44, 1, [200, 200, 200, 255]);
    applyInkWash(wide, {
      ...DEFAULT_INK_WASH,
      strength: 100,
      edgeBleed: 0,
      granulation: 0,
      paper: 100,
      seed: 41,
      paperKind: "cold-press",
    });
    const red = redChannel(wide);
    // 타일이 정확히 wrap 된다.
    expect(red[TILE]).toBe(red[0]);
    expect(red[TILE * 2]).toBe(red[0]);
    // 이음선 계단이 타일 내부 최대 계단을 넘지 않는다 = 눈에 띄는 줄이 없다.
    let maxInterior = 0;
    for (let x = 0; x < TILE - 1; x++) maxInterior = Math.max(maxInterior, Math.abs(red[x + 1]! - red[x]!));
    expect(Math.abs(red[TILE]! - red[TILE - 1]!)).toBeLessThanOrEqual(maxInterior);
  });
});

describe("applyInkWash — 가장자리 어두워짐(edge darkening)", () => {
  const SIZE = 48;
  const CENTER = SIZE / 2;
  const DISC_RADIUS = 14;

  function makeDisc(): StudioImageDataLike {
    const image = makeSolid(SIZE, SIZE, [255, 255, 255, 255]);
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (Math.hypot(x - CENTER, y - CENTER) > DISC_RADIUS) continue;
        const offset = (y * SIZE + x) * 4;
        image.data[offset] = 0;
        image.data[offset + 1] = 0;
        image.data[offset + 2] = 0;
      }
    }
    return image;
  }

  const settings: InkWash = {
    ...DEFAULT_INK_WASH,
    strength: 100,
    spread: 4,
    edgeBleed: 70,
    granulation: 0,
    paper: 0,
    inkColor: "#000000",
    seed: 3,
  };

  function bandMean(image: StudioImageDataLike, inner: number, outer: number): number {
    let sum = 0;
    let count = 0;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const radius = Math.hypot(x - CENTER, y - CENTER);
        if (radius < inner || radius > outer) continue;
        sum += image.data[(y * SIZE + x) * 4]!;
        count++;
      }
    }
    return sum / count;
  }

  it("키가 없으면 명시적 0과 픽셀 단위로 같다(기존 저장본 무변화)", () => {
    const implicit = makeDisc();
    const explicitZero = makeDisc();
    applyInkWash(implicit, settings);
    applyInkWash(explicitZero, { ...settings, edgeDarkening: 0 });
    expect(dataEqual(implicit, explicitZero)).toBe(true);
  });

  it("켜면 안료가 중심에서 젖은 가장자리로 실려 나간다(wet edge)", () => {
    const dry = makeDisc();
    const wet = makeDisc();
    applyInkWash(dry, settings);
    applyInkWash(wet, { ...settings, edgeDarkening: 90 });

    // 가장자리 링은 더 진해지고(R 감소), 중심부는 안료가 빠져나가 밝아진다.
    expect(bandMean(wet, DISC_RADIUS + 1, DISC_RADIUS + 5)).toBeLessThan(bandMean(dry, DISC_RADIUS + 1, DISC_RADIUS + 5));
    expect(bandMean(wet, 0, 5)).toBeGreaterThan(bandMean(dry, 0, 5));
  });

  it("강도를 올릴수록 링 대비가 커지고 알파는 그대로다", () => {
    const gentle = makeDisc();
    const strong = makeDisc();
    const alphaBefore = alphaValues(makeDisc());
    applyInkWash(gentle, { ...settings, edgeDarkening: 30 });
    applyInkWash(strong, { ...settings, edgeDarkening: 100 });

    const contrast = (image: StudioImageDataLike): number =>
      bandMean(image, 0, 5) - bandMean(image, DISC_RADIUS + 1, DISC_RADIUS + 5);
    expect(contrast(strong)).toBeGreaterThan(contrast(gentle));
    expect(alphaValues(strong)).toEqual(alphaBefore);
  });

  it("edgeBleed 0이어도 독립적으로 동작한다", () => {
    const off = makeDisc();
    const on = makeDisc();
    applyInkWash(off, { ...settings, edgeBleed: 0 });
    applyInkWash(on, { ...settings, edgeBleed: 0, edgeDarkening: 80 });
    expect(dataEqual(off, on)).toBe(false);
  });
});
