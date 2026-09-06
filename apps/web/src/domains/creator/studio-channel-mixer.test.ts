import { describe, expect, it } from "vitest";

import {
  CHANNEL_MIXER_CONST_RANGE,
  CHANNEL_MIXER_GAIN_RANGE,
  CHANNEL_MIXER_PRESETS,
  DEFAULT_CHANNEL_MIXER,
  applyChannelMixer,
  channelMixerKonvaFilter,
  channelMixerToFlat,
  flatToChannelMixer,
  isIdentityChannelMixer,
  normalizeChannelMixer,
  type ChannelMixer,
  type MixerChannel,
} from "./studio-channel-mixer";

import type { StudioImageDataLike } from "./studio-filters";

// ---- 테스트용 가짜 ImageData 빌더 ----

/** [r,g,b,a] 픽셀 배열로 StudioImageDataLike 생성. */
function makeImage(width: number, height: number, pixels: number[][]): StudioImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  pixels.forEach((px, i) => data.set(px, i * 4));
  return { data, width, height };
}

function pixelAt(img: StudioImageDataLike, index: number): number[] {
  return Array.from(img.data.slice(index * 4, index * 4 + 4));
}

describe("DEFAULT_CHANNEL_MIXER / isIdentityChannelMixer", () => {
  it("기본값은 항등 행렬 + monochrome:false", () => {
    expect(DEFAULT_CHANNEL_MIXER).toEqual({
      red: { r: 1, g: 0, b: 0, constant: 0 },
      green: { r: 0, g: 1, b: 0, constant: 0 },
      blue: { r: 0, g: 0, b: 1, constant: 0 },
      monochrome: false,
    });
    expect(isIdentityChannelMixer(DEFAULT_CHANNEL_MIXER)).toBe(true);
  });

  it("어느 한 값이라도 다르면 항등이 아니다", () => {
    expect(isIdentityChannelMixer({ ...DEFAULT_CHANNEL_MIXER, red: { r: 1, g: 0.1, b: 0, constant: 0 } })).toBe(false);
    expect(isIdentityChannelMixer({ ...DEFAULT_CHANNEL_MIXER, blue: { r: 0, g: 0, b: 1, constant: 0.5 } })).toBe(false);
  });

  it("monochrome:true면 행렬이 항등이어도 항등이 아니다", () => {
    expect(isIdentityChannelMixer({ ...DEFAULT_CHANNEL_MIXER, monochrome: true })).toBe(false);
  });
});

describe("CHANNEL_MIXER 범위 상수", () => {
  it("gain 범위는 -2..2, step 0.05", () => {
    expect(CHANNEL_MIXER_GAIN_RANGE).toEqual({ min: -2, max: 2, step: 0.05 });
  });

  it("constant 범위는 -1..1, step 0.01", () => {
    expect(CHANNEL_MIXER_CONST_RANGE).toEqual({ min: -1, max: 1, step: 0.01 });
  });
});

describe("normalizeChannelMixer", () => {
  it("undefined/null → 기본값(항등)", () => {
    expect(normalizeChannelMixer()).toEqual(DEFAULT_CHANNEL_MIXER);
    expect(normalizeChannelMixer(null)).toEqual(DEFAULT_CHANNEL_MIXER);
  });

  it("누락 채널은 항등 기본값으로 채운다", () => {
    // red만 일부 지정 → green/blue는 항등, red의 누락 값도 항등 기본(g·b·constant=0).
    expect(normalizeChannelMixer({ red: { r: 0.5 } as MixerChannel })).toEqual({
      red: { r: 0.5, g: 0, b: 0, constant: 0 },
      green: { r: 0, g: 1, b: 0, constant: 0 },
      blue: { r: 0, g: 0, b: 1, constant: 0 },
      monochrome: false,
    });
  });

  it("gain은 -2..2, constant는 -1..1로 클램프", () => {
    const out = normalizeChannelMixer({
      red: { r: 99, g: -99, b: 2, constant: 9 },
      green: { r: -3, g: 1, b: 0, constant: -5 },
      blue: { r: 0, g: 0, b: 5, constant: 0.5 },
    });
    expect(out.red).toEqual({ r: 2, g: -2, b: 2, constant: 1 });
    expect(out.green).toEqual({ r: -2, g: 1, b: 0, constant: -1 });
    expect(out.blue).toEqual({ r: 0, g: 0, b: 2, constant: 0.5 });
  });

  it("숫자가 아닌 값은 해당 채널의 항등 기본값으로 되돌린다", () => {
    const out = normalizeChannelMixer({
      red: { r: Number.NaN, g: "x", b: undefined, constant: null } as unknown as MixerChannel,
      green: "nope" as unknown as MixerChannel,
      blue: { r: Number.POSITIVE_INFINITY, g: {}, b: [], constant: Number.NaN } as unknown as MixerChannel,
    });
    // 전부 무효 → 완전 항등으로 복원.
    expect(out).toEqual(DEFAULT_CHANNEL_MIXER);
  });

  it("monochrome은 Boolean으로 강제(truthy 비불리언은 false)", () => {
    expect(normalizeChannelMixer({ monochrome: true }).monochrome).toBe(true);
    expect(normalizeChannelMixer({ monochrome: false }).monochrome).toBe(false);
    expect(normalizeChannelMixer({ monochrome: 1 as unknown as boolean }).monochrome).toBe(false);
    expect(normalizeChannelMixer({ monochrome: undefined }).monochrome).toBe(false);
  });
});

describe("applyChannelMixer", () => {
  it("항등이면 no-op (데이터 불변)", () => {
    const img = makeImage(2, 1, [
      [10, 20, 30, 40],
      [200, 100, 50, 255],
    ]);
    applyChannelMixer(img, DEFAULT_CHANNEL_MIXER);
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 40]);
    expect(pixelAt(img, 1)).toEqual([200, 100, 50, 255]);
  });

  it("red-from-green 스왑은 초록값을 빨강으로 옮긴다", () => {
    // red 행을 {0,1,0,0}으로 → oR = 0*R + 1*G + 0*B = G. green/blue는 항등.
    const cm: ChannelMixer = { ...DEFAULT_CHANNEL_MIXER, red: { r: 0, g: 1, b: 0, constant: 0 } };
    const img = makeImage(1, 1, [[10, 200, 30, 128]]);
    applyChannelMixer(img, cm);
    expect(pixelAt(img, 0)).toEqual([200, 200, 30, 128]); // R=원래 G(200), G/B/알파 그대로
  });

  it("monochrome=true면 R===G===B (회색)", () => {
    // red{0.33,0.33,0.33,0}, gray = 0.33*(90+150+30) = 0.33*270 = 89.1 → 89.
    const cm: ChannelMixer = {
      ...DEFAULT_CHANNEL_MIXER,
      red: { r: 0.33, g: 0.33, b: 0.33, constant: 0 },
      monochrome: true,
    };
    const img = makeImage(1, 1, [[90, 150, 30, 200]]);
    applyChannelMixer(img, cm);
    const px = pixelAt(img, 0);
    expect(px[0]).toBe(px[1]);
    expect(px[1]).toBe(px[2]);
    expect(px[0]).toBe(89);
    expect(px[3]).toBe(200); // 알파 보존
  });

  it("monochrome=true는 green/blue 채널 설정을 무시한다", () => {
    // green/blue를 엉뚱하게 줘도 red 행만 쓰므로 결과는 위와 동일.
    const cmA: ChannelMixer = {
      red: { r: 0.5, g: 0.3, b: 0.2, constant: 0 },
      green: { r: 9, g: 9, b: 9, constant: 9 },
      blue: { r: -9, g: -9, b: -9, constant: -9 },
      monochrome: true,
    };
    const cmB: ChannelMixer = {
      red: { r: 0.5, g: 0.3, b: 0.2, constant: 0 },
      green: { r: 0, g: 1, b: 0, constant: 0 },
      blue: { r: 0, g: 0, b: 1, constant: 0 },
      monochrome: true,
    };
    const imgA = makeImage(1, 1, [[120, 80, 40, 255]]);
    const imgB = makeImage(1, 1, [[120, 80, 40, 255]]);
    applyChannelMixer(imgA, cmA);
    applyChannelMixer(imgB, cmB);
    expect(pixelAt(imgA, 0)).toEqual(pixelAt(imgB, 0));
  });

  it("constant 오프셋은 채널을 위/아래로 민다(255 스케일)", () => {
    const base = makeImage(1, 1, [[100, 100, 100, 255]]);
    applyChannelMixer(base, DEFAULT_CHANNEL_MIXER); // 항등 no-op, 비교용 원본

    const up = makeImage(1, 1, [[100, 100, 100, 255]]);
    applyChannelMixer(up, { ...DEFAULT_CHANNEL_MIXER, red: { r: 1, g: 0, b: 0, constant: 0.1 } });
    // oR = 100 + 0.1*255 = 125.5 → 126 근처. 확실히 상승.
    expect(pixelAt(up, 0)[0]!).toBeGreaterThan(120);
    expect(pixelAt(up, 0)[1]).toBe(100); // G는 그대로
    expect(pixelAt(up, 0)[3]).toBe(255);

    const down = makeImage(1, 1, [[100, 100, 100, 255]]);
    applyChannelMixer(down, { ...DEFAULT_CHANNEL_MIXER, blue: { r: 0, g: 0, b: 1, constant: -0.2 } });
    // oB = 100 - 0.2*255 = 49 → 확실히 하락.
    expect(pixelAt(down, 0)[2]!).toBeLessThan(60);
    expect(pixelAt(down, 0)[2]!).toBeGreaterThan(40);
  });

  it("양 극단에서 0..255로 클램프된다", () => {
    // 큰 양수 gain+상수 → 255로, 큰 음수 → 0으로.
    const hi = makeImage(1, 1, [[200, 200, 200, 255]]);
    applyChannelMixer(hi, {
      red: { r: 2, g: 0, b: 0, constant: 1 }, // 200*2 + 255 = 655 → 255
      green: { r: 0, g: 1, b: 0, constant: 0 },
      blue: { r: 0, g: 0, b: 1, constant: 0 },
      monochrome: false,
    });
    expect(pixelAt(hi, 0)[0]).toBe(255);

    const lo = makeImage(1, 1, [[200, 200, 200, 255]]);
    applyChannelMixer(lo, {
      red: { r: 1, g: 0, b: 0, constant: 0 },
      green: { r: 0, g: 1, b: 0, constant: 0 },
      blue: { r: -2, g: 0, b: 0, constant: -1 }, // 200*-2 - 255 = -655 → 0
      monochrome: false,
    });
    expect(pixelAt(lo, 0)[2]).toBe(0);
  });

  it("알파는 항상 보존된다(여러 픽셀)", () => {
    const cm: ChannelMixer = {
      red: { r: 0.4, g: 0.4, b: 0.2, constant: 0.05 },
      green: { r: 0, g: 1.1, b: 0, constant: 0 },
      blue: { r: 0, g: 0, b: 0.9, constant: -0.05 },
      monochrome: false,
    };
    const img = makeImage(3, 1, [
      [10, 20, 30, 11],
      [120, 130, 140, 123],
      [240, 10, 200, 250],
    ]);
    applyChannelMixer(img, cm);
    expect(pixelAt(img, 0)[3]).toBe(11);
    expect(pixelAt(img, 1)[3]).toBe(123);
    expect(pixelAt(img, 2)[3]).toBe(250);
  });
});

describe("channelMixerToFlat / flatToChannelMixer", () => {
  it("flat 배열은 길이 13, 행 단위 r·g·b·constant ×3 + mono", () => {
    const flat = channelMixerToFlat(DEFAULT_CHANNEL_MIXER);
    expect(flat).toHaveLength(13);
    expect(flat).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0]);
  });

  it("monochrome:true는 마지막 칸이 1", () => {
    expect(channelMixerToFlat({ ...DEFAULT_CHANNEL_MIXER, monochrome: true })[12]).toBe(1);
  });

  it("flatToChannelMixer는 평탄 배열을 복원한다", () => {
    const cm = flatToChannelMixer([0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1]);
    expect(cm).toEqual({
      red: { r: 0, g: 1, b: 0, constant: 0 },
      green: { r: 0, g: 0, b: 1, constant: 0 },
      blue: { r: 1, g: 0, b: 0, constant: 0 },
      monochrome: true,
    });
  });

  it("round-trip이 안정적이다(toFlat∘fromFlat == 원본)", () => {
    const cm: ChannelMixer = normalizeChannelMixer({
      red: { r: 1.15, g: -0.25, b: 0.1, constant: 0.03 },
      green: { r: 0.05, g: 0.9, b: 0.05, constant: -0.02 },
      blue: { r: -0.1, g: 0.2, b: 0.85, constant: 0.5 },
      monochrome: true,
    });
    const back = flatToChannelMixer(channelMixerToFlat(cm));
    expect(back).toEqual(cm);
    // 한 번 더 돌려도 동일(고정점).
    expect(channelMixerToFlat(back)).toEqual(channelMixerToFlat(cm));
  });

  it("flatToChannelMixer는 범위 밖/짧은 배열을 normalize한다", () => {
    // 길이 부족 + 범위 밖 값.
    const cm = flatToChannelMixer([99, -99]);
    expect(cm.red.r).toBe(2); // 99 클램프
    expect(cm.red.g).toBe(-2); // -99 클램프
    expect(cm.red.b).toBe(0); // 누락 → 항등 기본
    expect(cm.green).toEqual({ r: 0, g: 1, b: 0, constant: 0 }); // 전부 누락 → 항등
    expect(cm.monochrome).toBe(false);
  });
});

describe("CHANNEL_MIXER_PRESETS", () => {
  it("첫 항목은 identity/기본 항등", () => {
    const first = CHANNEL_MIXER_PRESETS[0]!;
    expect(first.id).toBe("identity");
    expect(first.label).toBe("기본");
    expect(isIdentityChannelMixer(first.mixer)).toBe(true);
  });

  it("프리셋이 여러 개다", () => {
    expect(CHANNEL_MIXER_PRESETS.length).toBeGreaterThanOrEqual(6);
  });

  it("id는 모두 고유하다", () => {
    const ids = CHANNEL_MIXER_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("label/tip은 비어있지 않다", () => {
    for (const p of CHANNEL_MIXER_PRESETS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.tip.length).toBeGreaterThan(0);
    }
  });

  it("모든 mixer 값이 범위 안 + normalize 안정", () => {
    for (const p of CHANNEL_MIXER_PRESETS) {
      expect(p.mixer).toEqual(normalizeChannelMixer(p.mixer));
      for (const key of ["red", "green", "blue"] as const) {
        const ch = p.mixer[key];
        for (const g of [ch.r, ch.g, ch.b]) {
          expect(g).toBeGreaterThanOrEqual(CHANNEL_MIXER_GAIN_RANGE.min);
          expect(g).toBeLessThanOrEqual(CHANNEL_MIXER_GAIN_RANGE.max);
        }
        expect(ch.constant).toBeGreaterThanOrEqual(CHANNEL_MIXER_CONST_RANGE.min);
        expect(ch.constant).toBeLessThanOrEqual(CHANNEL_MIXER_CONST_RANGE.max);
      }
    }
  });

  it("흑백 프리셋은 monochrome:true이고 비항등이다", () => {
    const monoIds = ["mono-balanced", "mono-portrait", "mono-landscape", "mono-infrared"];
    for (const id of monoIds) {
      const preset = CHANNEL_MIXER_PRESETS.find((p) => p.id === id);
      expect(preset, `프리셋 ${id} 존재`).toBeTruthy();
      expect(preset!.mixer.monochrome).toBe(true);
      expect(isIdentityChannelMixer(preset!.mixer)).toBe(false);
    }
  });

  it("흑백 균형 프리셋은 실제로 회색을 만든다", () => {
    const balanced = CHANNEL_MIXER_PRESETS.find((p) => p.id === "mono-balanced")!;
    const img = makeImage(1, 1, [[200, 100, 50, 255]]);
    applyChannelMixer(img, balanced.mixer);
    const px = pixelAt(img, 0);
    expect(px[0]).toBe(px[1]);
    expect(px[1]).toBe(px[2]);
  });
});

describe("channelMixerKonvaFilter", () => {
  it("flat attrs(channelMixer)를 읽어 픽셀을 변형한다", () => {
    const img = makeImage(1, 1, [[10, 200, 30, 77]]);
    // red-from-green 스왑 평탄 배열.
    const flat = [0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0];
    channelMixerKonvaFilter.call({ attrs: { channelMixer: flat } }, img);
    expect(pixelAt(img, 0)).toEqual([200, 200, 30, 77]);

    // 직접 applyChannelMixer 결과와 동일해야 한다.
    const ref = makeImage(1, 1, [[10, 200, 30, 77]]);
    applyChannelMixer(ref, flatToChannelMixer(flat));
    expect(pixelAt(img, 0)).toEqual(pixelAt(ref, 0));
  });

  it("attrs가 비면 no-op(throw 없음)", () => {
    const img = makeImage(1, 1, [[10, 20, 30, 40]]);
    expect(() => channelMixerKonvaFilter.call({ attrs: {} }, img)).not.toThrow();
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 40]);
  });

  it("this.attrs 자체가 없어도 no-op", () => {
    const img = makeImage(1, 1, [[10, 20, 30, 40]]);
    expect(() => channelMixerKonvaFilter.call({}, img)).not.toThrow();
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 40]);
  });

  it("channelMixer가 배열이 아니면 no-op", () => {
    const img = makeImage(1, 1, [[10, 20, 30, 255]]);
    expect(() => channelMixerKonvaFilter.call({ attrs: { channelMixer: "x" } }, img)).not.toThrow();
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 255]);
  });

  it("항등으로 정규화되는 flat은 no-op", () => {
    const img = makeImage(1, 1, [[55, 110, 165, 220]]);
    const flat = channelMixerToFlat(DEFAULT_CHANNEL_MIXER); // 항등
    channelMixerKonvaFilter.call({ attrs: { channelMixer: flat } }, img);
    expect(pixelAt(img, 0)).toEqual([55, 110, 165, 220]);
  });
});

// 미사용 import 방지용 타입 참조.
const _typecheck: ChannelMixer = DEFAULT_CHANNEL_MIXER;
void _typecheck;

describe("channel mixer hostile direct-call safety", () => {
  it("invalid direct parameters normalize to identity without mutating caller data", () => {
    const mixer = Object.freeze({
      red: Object.freeze({ r: Number.NaN, g: 0, b: 0, constant: Number.POSITIVE_INFINITY }),
      green: Object.freeze({ r: 0, g: Number.NaN, b: 0, constant: 0 }),
      blue: Object.freeze({ r: 0, g: 0, b: Number.NaN, constant: 0 }),
      monochrome: false,
    }) as unknown as ChannelMixer;
    const img = makeImage(1, 1, [[10, 20, 30, 77]]);
    expect(() => applyChannelMixer(img, mixer)).not.toThrow();
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 77]);
    expect(mixer.red.r).toBeNaN();
  });
});
