import { describe, it, expect } from "vitest";

import {
  DEFAULT_SEPARATION_OPTIONS,
  GAMUT_TOLERANCE,
  PROFILE_DISCLOSURE,
  STUDIO_PRESS_CONDITIONS,
  STUDIO_RICH_BLACKS,
  buildRichBlack,
  chooseBlack,
  clampUnit,
  cmykToSrgb,
  deltaE76,
  deltaE94,
  enforceTotalInkLimit,
  formatCmykPercent,
  labToSrgb,
  reportGamut,
  resolvePressCondition,
  rgbToSrgbHex,
  separateSrgbToCmyk,
  srgbHexToRgb,
  srgbToLab,
  totalInkCoverage,
  type StudioSeparationOptions,
} from "./studio-canvaskit-cmyk-core";

const deviceNative: StudioSeparationOptions = {
  model: "device",
  press: STUDIO_PRESS_CONDITIONS["device-native"],
  inkLimitStrategy: "scale-cmy",
};
const deviceCoated: StudioSeparationOptions = {
  model: "device",
  press: STUDIO_PRESS_CONDITIONS["coated-web"],
  inkLimitStrategy: "scale-cmy",
};
const neugebauerNative: StudioSeparationOptions = {
  model: "coated-neugebauer",
  press: STUDIO_PRESS_CONDITIONS["device-native"],
  inkLimitStrategy: "scale-cmy",
  intent: "media-relative",
};
const neugebauerCoated: StudioSeparationOptions = {
  model: "coated-neugebauer",
  press: STUDIO_PRESS_CONDITIONS["coated-web"],
  inkLimitStrategy: "scale-cmy",
  intent: "media-relative",
};

const hex = (value: string) => {
  const rgb = srgbHexToRgb(value);
  if (!rgb) throw new Error(`bad hex fixture: ${value}`);
  return rgb;
};

describe("색공간 기본기", () => {
  it("hex 파싱은 3자리 축약과 대소문자를 모두 받고, 잘못된 값은 null이다", () => {
    expect(srgbHexToRgb("#fff")).toEqual({ r: 1, g: 1, b: 1 });
    expect(srgbHexToRgb("00FF80")).toEqual({ r: 0, g: 1, b: 128 / 255 });
    expect(srgbHexToRgb("#12345")).toBeNull();
    expect(srgbHexToRgb("#gggggg")).toBeNull();
    expect(srgbHexToRgb("")).toBeNull();
  });

  it("hex 왕복은 8비트 격자에서 무손실이다", () => {
    for (let v = 0; v <= 255; v += 3) {
      const value = `#${v.toString(16).padStart(2, "0").repeat(3)}`;
      expect(rgbToSrgbHex(hex(value))).toBe(value);
    }
  });

  it("Lab 왕복이 sRGB 격자에서 부동소수 오차 안에 든다", () => {
    let worst = 0;
    for (let r = 0; r <= 255; r += 51) {
      for (let g = 0; g <= 255; g += 51) {
        for (let b = 0; b <= 255; b += 51) {
          const rgb = { r: r / 255, g: g / 255, b: b / 255 };
          const back = labToSrgb(srgbToLab(rgb));
          worst = Math.max(worst, Math.abs(back.r - rgb.r), Math.abs(back.g - rgb.g), Math.abs(back.b - rgb.b));
        }
      }
    }
    expect(worst).toBeLessThan(1e-9);
  });

  it("D50 백색은 Lab (100, 0, 0) 근처다", () => {
    const white = srgbToLab({ r: 1, g: 1, b: 1 });
    expect(white.l).toBeCloseTo(100, 4);
    expect(Math.hypot(white.a, white.b)).toBeLessThan(0.01);
  });

  it("ΔE76과 ΔE94는 같은 색에서 0이고, 채도 영역에서 ΔE94가 더 관대하다", () => {
    const a = srgbToLab(hex("#ff0000"));
    expect(deltaE76(a, a)).toBe(0);
    expect(deltaE94(a, a)).toBe(0);
    const b = srgbToLab(hex("#e00000"));
    expect(deltaE94(a, b)).toBeLessThan(deltaE76(a, b));
  });

  it("clampUnit은 NaN·무한대를 0으로 무너뜨린다", () => {
    expect(clampUnit(Number.NaN)).toBe(0);
    expect(clampUnit(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampUnit(-1)).toBe(0);
    expect(clampUnit(2)).toBe(1);
    expect(clampUnit(0.25)).toBe(0.25);
  });
});

describe("device 모델 — sRGB↔CMYK 왕복 무손실", () => {
  it("잉크 제한이 없으면 sRGB 큐브 전체에서 왕복 오차가 1e-12 미만이다", () => {
    let worst = 0;
    for (let r = 0; r <= 255; r += 17) {
      for (let g = 0; g <= 255; g += 17) {
        for (let b = 0; b <= 255; b += 17) {
          const rgb = { r: r / 255, g: g / 255, b: b / 255 };
          const separation = separateSrgbToCmyk(rgb, deviceNative);
          expect(separation.inkLimit.applied).toBe(false);
          const back = cmykToSrgb(separation.cmyk, deviceNative);
          worst = Math.max(worst, Math.abs(back.r - rgb.r), Math.abs(back.g - rgb.g), Math.abs(back.b - rgb.b));
        }
      }
    }
    // 실측 최악값 5.6e-17 — 부동소수 한계다. 임계를 1e-12로 두어 회귀만 잡는다.
    expect(worst).toBeLessThan(1e-12);
  });

  it("알려진 스와치를 정확한 잉크 값으로 분해한다", () => {
    expect(separateSrgbToCmyk(hex("#ffffff"), deviceCoated).cmyk).toEqual({ c: 0, m: 0, y: 0, k: 0 });
    expect(formatCmykPercent(separateSrgbToCmyk(hex("#ff0000"), deviceCoated).cmyk)).toBe(
      "C 0 · M 100 · Y 100 · K 0 (200%)",
    );
    expect(formatCmykPercent(separateSrgbToCmyk(hex("#ffff00"), deviceCoated).cmyk)).toBe(
      "C 0 · M 0 · Y 100 · K 0 (100%)",
    );
    expect(formatCmykPercent(separateSrgbToCmyk(hex("#00ffff"), deviceCoated).cmyk)).toBe(
      "C 100 · M 0 · Y 0 · K 0 (100%)",
    );
  });

  it("무채색은 CMY 없이 K만으로 떨어지는 게 아니라 GCR 정책을 따른다", () => {
    // coated-web: gcr 0.85, blackStart 0.1 → 50% 회색에서 K는 k0 전부가 아니라 램프 값이다.
    const grey = separateSrgbToCmyk(hex("#808080"), deviceCoated);
    expect(grey.cmyk.k).toBeGreaterThan(0.3);
    expect(grey.cmyk.k).toBeLessThan(0.5);
    expect(grey.cmyk.c).toBeCloseTo(grey.cmyk.m, 10);
    expect(grey.cmyk.c).toBeCloseTo(grey.cmyk.y, 10);
    // 무채색은 device 모델에서 왕복이 정확해야 한다.
    expect(grey.deltaE).toBeLessThan(1e-9);
  });

  it("GCR 0이면 K를 전혀 쓰지 않고, GCR 최대면 회색 성분을 K로 옮긴다", () => {
    const noBlack = resolvePressCondition("coated-web", { gcr: 0, blackStart: 0, totalInkLimit: 4 });
    const skeleton = resolvePressCondition("coated-web", { gcr: 1, blackStart: 0, blackLimit: 1, totalInkLimit: 4 });
    const target = hex("#404060");
    const withoutBlack = separateSrgbToCmyk(target, { ...deviceCoated, press: noBlack });
    const withBlack = separateSrgbToCmyk(target, { ...deviceCoated, press: skeleton });
    expect(withoutBlack.cmyk.k).toBe(0);
    expect(withBlack.cmyk.k).toBeGreaterThan(0.5);
    // 두 분해 모두 같은 색을 낸다 — GCR은 색이 아니라 잉크 배분을 바꾼다.
    expect(withoutBlack.deltaE).toBeLessThan(1e-9);
    expect(withBlack.deltaE).toBeLessThan(1e-9);
    expect(totalInkCoverage(withBlack.cmyk)).toBeLessThan(totalInkCoverage(withoutBlack.cmyk));
  });

  it("chooseBlack은 항상 k ≤ k0을 지킨다(왕복 무손실의 전제)", () => {
    for (const press of Object.values(STUDIO_PRESS_CONDITIONS)) {
      for (let i = 0; i <= 100; i++) {
        const k0 = i / 100;
        const k = chooseBlack(k0, press);
        expect(k).toBeLessThanOrEqual(k0 + 1e-12);
        expect(k).toBeLessThanOrEqual(press.blackLimit + 1e-12);
        expect(k).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("하이라이트에는 검정 점을 찍지 않는다(blackStart)", () => {
    const highlight = separateSrgbToCmyk(hex("#f7f7f7"), deviceCoated);
    expect(highlight.cmyk.k).toBe(0);
  });
});

describe("총 잉크량 제한", () => {
  it("한도 아래면 아무것도 바꾸지 않는다", () => {
    const input = { c: 0.2, m: 0.3, y: 0.1, k: 0.1 };
    const result = enforceTotalInkLimit(input, 3, "scale-cmy");
    expect(result.applied).toBe(false);
    expect(result.cmyk).toEqual(input);
    expect(result.before).toBeCloseTo(0.7, 12);
    expect(result.after).toBeCloseTo(0.7, 12);
  });

  it("scale-cmy는 K를 지키고 CMY만 비례 축소한다", () => {
    const result = enforceTotalInkLimit({ c: 1, m: 1, y: 1, k: 0.9 }, 3, "scale-cmy");
    expect(result.applied).toBe(true);
    expect(result.cmyk.k).toBe(0.9);
    expect(result.cmyk.c).toBeCloseTo(0.7, 12);
    expect(result.cmyk.m).toBeCloseTo(0.7, 12);
    expect(result.cmyk.y).toBeCloseTo(0.7, 12);
    expect(result.after).toBeCloseTo(3, 12);
  });

  it("scale-cmy는 CMY 비율(색상)을 보존한다", () => {
    const result = enforceTotalInkLimit({ c: 0.9, m: 0.6, y: 0.3, k: 1 }, 2.4, "scale-cmy");
    expect(result.cmyk.c / result.cmyk.m).toBeCloseTo(0.9 / 0.6, 10);
    expect(result.cmyk.m / result.cmyk.y).toBeCloseTo(0.6 / 0.3, 10);
    expect(result.after).toBeCloseTo(2.4, 12);
  });

  it("gcr-shift는 공통 성분을 K로 옮겨 총량을 줄인다", () => {
    const result = enforceTotalInkLimit({ c: 0.8, m: 0.6, y: 0.5, k: 0.1 }, 1.6, "gcr-shift");
    expect(result.applied).toBe(true);
    // t = 0.2를 옮기면 CMY는 각각 -0.2, K는 +0.2 → 총량 2.0 - 0.4 = 1.6.
    expect(result.cmyk.c).toBeCloseTo(0.6, 12);
    expect(result.cmyk.m).toBeCloseTo(0.4, 12);
    expect(result.cmyk.y).toBeCloseTo(0.3, 12);
    expect(result.cmyk.k).toBeCloseTo(0.3, 12);
    expect(result.after).toBeCloseTo(1.6, 12);
  });

  it("gcr-shift만으로 부족하면 CMY 축소로 마무리한다(폴백)", () => {
    const result = enforceTotalInkLimit({ c: 0.9, m: 0.9, y: 0.05, k: 0 }, 1, "gcr-shift");
    expect(result.applied).toBe(true);
    expect(result.after).toBeCloseTo(1, 12);
    expect(result.cmyk.k).toBeGreaterThan(0);
  });

  it("gcr-shift는 K 상한(blackLimit)을 넘지 않는다", () => {
    const result = enforceTotalInkLimit({ c: 0.9, m: 0.9, y: 0.9, k: 0.85 }, 2, "gcr-shift", 0.85);
    expect(result.cmyk.k).toBeLessThanOrEqual(0.85 + 1e-12);
    expect(result.after).toBeCloseTo(2, 12);
  });

  it("K 하나만으로 한도를 넘는 병리 입력도 한도 안으로 들어온다", () => {
    const result = enforceTotalInkLimit({ c: 1, m: 1, y: 1, k: 1 }, 0.5, "scale-cmy");
    expect(result.after).toBeLessThanOrEqual(0.5 + 1e-12);
    expect(result.cmyk).toEqual({ c: 0, m: 0, y: 0, k: 0.5 });
  });

  it("어떤 인쇄 조건에서도 분해 결과가 총 잉크량 상한을 넘지 않는다", () => {
    for (const press of Object.values(STUDIO_PRESS_CONDITIONS)) {
      for (const strategy of ["scale-cmy", "gcr-shift"] as const) {
        for (let r = 0; r <= 255; r += 51) {
          for (let g = 0; g <= 255; g += 51) {
            for (let b = 0; b <= 255; b += 51) {
              const separation = separateSrgbToCmyk(
                { r: r / 255, g: g / 255, b: b / 255 },
                { model: "device", press, inkLimitStrategy: strategy },
              );
              expect(totalInkCoverage(separation.cmyk)).toBeLessThanOrEqual(press.totalInkLimit + 1e-9);
            }
          }
        }
      }
    }
  });

  it("300% 한도에서는 순수 검정을 낼 수 없고 그 사실이 색역 밖으로 보고된다", () => {
    const black = separateSrgbToCmyk(hex("#000000"), deviceCoated);
    expect(black.inkLimit.applied).toBe(true);
    expect(black.inkLimit.before).toBeGreaterThan(3);
    expect(black.inkLimit.after).toBeCloseTo(3, 9);
    expect(black.outOfGamut).toBe(true);
    expect(black.reason).toContain("총 잉크량");
  });
});

describe("리치 블랙", () => {
  it("단색 블랙은 K만 쓰고 넓은 면적 안내를 붙인다", () => {
    const result = buildRichBlack("flat", STUDIO_PRESS_CONDITIONS["coated-web"]);
    expect(result.cmyk).toEqual({ c: 0, m: 0, y: 0, k: 1 });
    expect(result.inkLimit.applied).toBe(false);
    expect(result.warnings.some((warning) => warning.includes("리치 블랙"))).toBe(true);
  });

  it("중성 리치 블랙(60/40/40/100)은 300% 한도 안에 들어간다", () => {
    const result = buildRichBlack("neutral", STUDIO_PRESS_CONDITIONS["coated-web"]);
    expect(totalInkCoverage(STUDIO_RICH_BLACKS.neutral.build)).toBeCloseTo(2.4, 12);
    expect(result.inkLimit.applied).toBe(false);
    expect(result.cmyk).toEqual({ c: 0.6, m: 0.4, y: 0.4, k: 1 });
  });

  it("중성 리치 블랙 240%는 신문용지 상한(240%)에 정확히 걸쳐 통과한다(경계값)", () => {
    const result = buildRichBlack("neutral", STUDIO_PRESS_CONDITIONS.newsprint);
    expect(totalInkCoverage(result.cmyk)).toBeCloseTo(2.4, 12);
    expect(result.inkLimit.applied).toBe(false);
  });

  it("상한이 더 낮은 조건에서는 CMY가 줄고 K는 유지된다", () => {
    const tight = resolvePressCondition("newsprint", { totalInkLimit: 2 });
    const result = buildRichBlack("neutral", tight);
    expect(result.inkLimit.applied).toBe(true);
    expect(result.cmyk.k).toBe(1);
    expect(totalInkCoverage(result.cmyk)).toBeCloseTo(2, 12);
    // CMY 비율(60:40:40)은 유지된다.
    expect(result.cmyk.c / result.cmyk.m).toBeCloseTo(1.5, 10);
    expect(result.warnings.some((warning) => warning.includes("총 잉크량"))).toBe(true);
  });

  it("레지스트레이션 블랙은 항상 경고를 붙이고 한도 안으로 눌린다", () => {
    const result = buildRichBlack("registration", STUDIO_PRESS_CONDITIONS["coated-web"]);
    expect(result.warnings[0]).toContain("재단");
    expect(result.cmyk.k).toBe(1);
    expect(totalInkCoverage(result.cmyk)).toBeCloseTo(3, 12);
  });

  it("쿨/웜 리치 블랙은 서로 다른 색조를 낸다", () => {
    const press = STUDIO_PRESS_CONDITIONS["coated-sheetfed"];
    const cool = cmykToSrgb(buildRichBlack("cool", press).cmyk, neugebauerCoated);
    const warm = cmykToSrgb(buildRichBlack("warm", press).cmyk, neugebauerCoated);
    expect(srgbToLab(cool).b).toBeLessThan(srgbToLab(warm).b);
  });
});

describe("coated-neugebauer 측색 모델", () => {
  it("미디어 상대 인텐트에서 흰색은 색역 안이다", () => {
    const white = separateSrgbToCmyk(hex("#ffffff"), neugebauerCoated);
    // 뉴턴법의 잔차만큼(1e-4 미만) 잉크가 남을 수 있다 — 인쇄에서는 0%로 반올림되는 크기다.
    expect(white.cmyk.c).toBeCloseTo(0, 3);
    expect(white.cmyk.m).toBeCloseTo(0, 3);
    expect(white.cmyk.y).toBeCloseTo(0, 3);
    expect(white.cmyk.k).toBe(0);
    // 실측 ΔE94 = 0.024 — 종이 흰색을 화면 흰색에 맞췄기 때문이다.
    expect(white.deltaE).toBeLessThan(0.1);
    expect(white.outOfGamut).toBe(false);
  });

  it("절대 인텐트에서는 종이 흰색이 그대로 드러나 색역 밖이 된다", () => {
    const white = separateSrgbToCmyk(hex("#ffffff"), { ...neugebauerCoated, intent: "absolute" });
    // 실측 ΔE94 ≈ 5.4 — 종이는 완전 확산 백색(L*100)이 아니라 L*95다.
    expect(white.deltaE).toBeGreaterThan(3);
    expect(white.outOfGamut).toBe(true);
  });

  it("인쇄 가능한 색은 ΔE94 1.0 안으로 재현한다", () => {
    // 이 목록은 CMYK 색역 안쪽으로 고른 것이다(무채색·저채도 중간톤).
    const printable = ["#808080", "#e0c0a0", "#f0f0f0", "#c0c0c0", "#a08060", "#606060"];
    for (const value of printable) {
      const separation = separateSrgbToCmyk(hex(value), neugebauerNative);
      expect(separation.deltaE, `${value} ΔE94`).toBeLessThan(1);
      expect(separation.outOfGamut).toBe(false);
    }
  });

  it("sRGB 원색은 색역 밖으로 정직하게 보고된다", () => {
    // 실측 ΔE94: green 26.7, cyan 23.3, magenta 20.7 — CMYK 잉크로는 낼 수 없는 채도다.
    for (const value of ["#00ff00", "#00ffff", "#ff00ff"]) {
      const separation = separateSrgbToCmyk(hex(value), neugebauerNative);
      expect(separation.outOfGamut, value).toBe(true);
      expect(separation.deltaE).toBeGreaterThan(GAMUT_TOLERANCE);
      expect(separation.reason).toContain("채도");
    }
  });

  it("역변환은 결정적이다(같은 입력 → 같은 잉크 값)", () => {
    for (const value of ["#123456", "#ff8000", "#204020", "#7f3f00"]) {
      const first = separateSrgbToCmyk(hex(value), neugebauerCoated);
      const second = separateSrgbToCmyk(hex(value), neugebauerCoated);
      expect(first.cmyk).toEqual(second.cmyk);
      expect(first.deltaE).toBe(second.deltaE);
    }
  });

  it("잉크 값은 언제나 0..1 정육면체 안에 머문다", () => {
    for (let r = 0; r <= 255; r += 51) {
      for (let g = 0; g <= 255; g += 51) {
        for (let b = 0; b <= 255; b += 51) {
          const { cmyk } = separateSrgbToCmyk({ r: r / 255, g: g / 255, b: b / 255 }, neugebauerCoated);
          for (const channel of [cmyk.c, cmyk.m, cmyk.y, cmyk.k]) {
            expect(channel).toBeGreaterThanOrEqual(0);
            expect(channel).toBeLessThanOrEqual(1);
            expect(Number.isFinite(channel)).toBe(true);
          }
        }
      }
    }
  });

  it("망점 증가가 커질수록 같은 잉크 값이 더 어둡게 찍힌다", () => {
    const ink = { c: 0.5, m: 0.5, y: 0.5, k: 0 };
    const low = cmykToSrgb(ink, { ...neugebauerCoated, press: resolvePressCondition("coated-web", { dotGain: 0 }) });
    const high = cmykToSrgb(ink, { ...neugebauerCoated, press: resolvePressCondition("coated-web", { dotGain: 0.35 }) });
    expect(srgbToLab(high).l).toBeLessThan(srgbToLab(low).l);
  });
});

describe("색역 리포트", () => {
  it("팔레트 전체를 검사하고 최악 항목을 짚는다", () => {
    const report = reportGamut(
      [
        { id: "배경", hex: "#f0f0f0" },
        { id: "피부", hex: "#e0c0a0" },
        { id: "형광 초록", hex: "#00ff00" },
        { id: "잘못된 값", hex: "not-a-color" },
      ],
      neugebauerCoated,
    );
    expect(report.entries).toHaveLength(3);
    expect(report.outOfGamutCount).toBe(1);
    expect(report.worst?.id).toBe("형광 초록");
    expect(report.summary).toContain("색역을 벗어납니다");
    expect(report.disclosure).toBe(PROFILE_DISCLOSURE);
  });

  it("입력 순서를 유지한다(UI가 원본 팔레트와 나란히 놓을 수 있어야 한다)", () => {
    const report = reportGamut(
      [
        { id: "a", hex: "#00ff00" },
        { id: "b", hex: "#808080" },
        { id: "c", hex: "#ff00ff" },
      ],
      neugebauerCoated,
    );
    expect(report.entries.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
  });

  it("전부 인쇄 가능하면 요약이 그렇게 말한다", () => {
    const report = reportGamut([{ id: "회색", hex: "#808080" }], neugebauerNative);
    expect(report.outOfGamutCount).toBe(0);
    expect(report.summary).toContain("모두");
  });

  it("빈 입력도 무너지지 않는다", () => {
    const report = reportGamut([], DEFAULT_SEPARATION_OPTIONS);
    expect(report.entries).toHaveLength(0);
    expect(report.worst).toBeNull();
    expect(report.summary).toBe("검사할 색이 없어요.");
  });
});

describe("인쇄 조건 프리셋", () => {
  it("오버라이드는 범위로 클램프된다", () => {
    const press = resolvePressCondition("coated-web", { totalInkLimit: 99, gcr: -3, blackLimit: 5, dotGain: 9 });
    expect(press.totalInkLimit).toBe(4);
    expect(press.gcr).toBe(0);
    expect(press.blackLimit).toBe(1);
    expect(press.dotGain).toBe(1);
  });

  it("종이가 거칠수록 총 잉크량 상한이 낮다", () => {
    expect(STUDIO_PRESS_CONDITIONS["coated-sheetfed"].totalInkLimit).toBeGreaterThan(
      STUDIO_PRESS_CONDITIONS.uncoated.totalInkLimit,
    );
    expect(STUDIO_PRESS_CONDITIONS.uncoated.totalInkLimit).toBeGreaterThan(
      STUDIO_PRESS_CONDITIONS.newsprint.totalInkLimit,
    );
  });
});
