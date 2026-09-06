import { describe, expect, it } from "vitest";

import {
  STUDIO_BRUSH_ALIAS_PROFILES,
  STUDIO_BRUSH_ALIAS_PROFILE_VERSION,
  applyStudioBrushAliasWatercolorMaterial,
  isStudioBrushAliasId,
  mapStudioBrushAliasPressure,
  mapStudioBrushAliasPressureSamples,
  resolveStudioBrushAliasPencilPasses,
  resolveStudioBrushAliasProfile,
  resolveStudioBrushAliasWatercolorPlanSettings,
  studioBrushAliasEffectiveDiameter,
  type StudioBrushAliasId,
} from "./studio-brush-alias-profile";

const ALIAS_IDS = [
  "pen",
  "fineliner",
  "ballpoint",
  "gel-pen",
  "glass-pen",
  "ruling-pen",
  "technical-pen",
  "marker",
  "felt-tip",
  "marker-bold",
  "alcohol-marker",
  "gpen",
  "school-pen",
  "maru-pen",
  "mapping-pen",
  "kaburapen",
  "liner",
  "calligraphy",
  "fountain-pen",
  "parallel-pen",
  "brush-pen",
  "kneaded-eraser",
  "highlighter",
  "chisel-highlighter",
  "pastel-highlighter",
  "glitter",
  "sparkle-star",
  "brush",
  "flat-brush",
  "watercolor",
  "ink-wash",
  "inkwash-pen",
  "inkwash-water-brush",
  "inkwash-bleed-wash",
  "inkwash-white-ink",
  "gouache",
  "oil",
  "acrylic",
  "airbrush",
  "splatter",
  "pencil",
  "pencil-2b",
  "pencil-6b",
  "soft-pencil",
  "pencil--side-shade",
  "colored-pencil",
  "pastel",
  "oil-pastel",
  "screentone",
  "crosshatch",
] as const satisfies readonly StudioBrushAliasId[];

describe("studio brush alias profiles", () => {
  it("publishes an exact versioned profile for every audited alias and fails closed for unknown ids", () => {
    expect(Object.keys(STUDIO_BRUSH_ALIAS_PROFILES).sort()).toEqual([...ALIAS_IDS].sort());
    for (const id of ALIAS_IDS) {
      expect(isStudioBrushAliasId(id)).toBe(true);
      expect(resolveStudioBrushAliasProfile(id)).toMatchObject({
        version: STUDIO_BRUSH_ALIAS_PROFILE_VERSION,
        id,
      });
    }

    for (const value of ["", "future-brush", null, 7, {}, []]) {
      expect(isStudioBrushAliasId(value)).toBe(false);
      expect(resolveStudioBrushAliasProfile(value)).toBeNull();
    }
  });

  it("keeps every pen/marker alias visually distinct at equal selected size and source pressure", () => {
    const ids = [
      "pen",
      "fineliner",
      "ballpoint",
      "marker",
      "felt-tip",
      "marker-bold",
    ] as const;
    const signatures = ids.map((id) => [
      studioBrushAliasEffectiveDiameter(id, 10),
      mapStudioBrushAliasPressure(id, 0),
      mapStudioBrushAliasPressure(id, 0.5),
      mapStudioBrushAliasPressure(id, 1),
    ].map((value) => value.toFixed(6)).join(":"));

    expect(new Set(signatures).size).toBe(ids.length);
    expect(studioBrushAliasEffectiveDiameter("fineliner", 10)).toBe(4.8);
    expect(studioBrushAliasEffectiveDiameter("marker-bold", 10)).toBe(15);
    expect(mapStudioBrushAliasPressure("ballpoint", 1)).toBeCloseTo(0.9);
    expect(mapStudioBrushAliasPressure("marker-bold", 0)).toBe(0.92);
  });

  it("makes liner narrower and less pressure-elastic than G-pen", () => {
    expect(studioBrushAliasEffectiveDiameter("gpen", 12)).toBe(12);
    expect(studioBrushAliasEffectiveDiameter("liner", 12)).toBeCloseTo(9.36);
    expect(mapStudioBrushAliasPressure("gpen", 0.1)).toBeCloseTo(0.1);
    expect(mapStudioBrushAliasPressure("gpen", 0.9)).toBeCloseTo(0.9);
    expect(mapStudioBrushAliasPressure("liner", 0.1)).toBeGreaterThan(0.7);
    expect(mapStudioBrushAliasPressure("liner", 0.9)).toBeLessThan(0.91);
  });

  it("maps complete pressure arrays without mutating input and supplies omitted-sample fallback", () => {
    const source = [0, 0.5];
    const mapped = mapStudioBrushAliasPressureSamples("fineliner", source, 4, 1);

    expect(source).toEqual([0, 0.5]);
    expect(mapped).toHaveLength(4);
    expect(mapped[0]).toBe(0.8);
    expect(mapped[1]).toBeGreaterThan(0.8);
    expect(mapped[2]).toBe(1);
    expect(mapped[3]).toBe(1);
    expect(mapStudioBrushAliasPressureSamples("pen", source, -1)).toEqual([]);
    expect(mapStudioBrushAliasPressureSamples("pen", source, 1_000_001)).toEqual([]);
  });

  it("clamps malformed diameter and pressure values to finite renderer-safe output", () => {
    expect(studioBrushAliasEffectiveDiameter("pen", Number.NaN)).toBe(1);
    expect(studioBrushAliasEffectiveDiameter("marker-bold", -10)).toBe(0.015);
    expect(studioBrushAliasEffectiveDiameter("marker-bold", Number.POSITIVE_INFINITY)).toBe(1.5);
    expect(studioBrushAliasEffectiveDiameter("marker-bold", 100_000)).toBe(8_192);
    expect(mapStudioBrushAliasPressure("pen", Number.NaN, 0.25)).toBe(0.25);
    expect(mapStudioBrushAliasPressure("pen", -20)).toBe(0);
    expect(mapStudioBrushAliasPressure("pen", 20)).toBe(1);
  });

  it("gives ink wash a denser plan, compact dark core and broad pale diffuse bleed", () => {
    const watercolor = resolveStudioBrushAliasWatercolorPlanSettings("watercolor", 20);
    expect(watercolor?.baseWidth).toBe(20);
    // 의도적 변경(2026-08-16 시각 대조): 젖은 dab 은 부드러운 그라데이션이라 딱딱한 원보다
    // 성기게 보인다. 4배 확대에서 코어가 원 사슬처럼 구슬져서 간격을 0.7배로 좁혔고,
    // 실루엣 잔차가 수묵 3.03px -> 1.80px 로 떨어졌다(brush-tremor-sweep).
    expect(watercolor?.spacing).toBeCloseTo(3.08);
    const inkWash = resolveStudioBrushAliasWatercolorPlanSettings("ink-wash", 20);
    // Sumi is slightly narrower than toolbar size, denser stations, stronger core vs pale wash.
    expect(inkWash?.baseWidth).toBeCloseTo(18.4);
    // 의도적 변경(2026-08-16 시각 대조): 젖은 dab 은 부드러운 그라데이션이라 딱딱한 원보다
    // 성기게 보인다. 같은 간격에서도 코어가 원 사슬처럼 구슬지는 게 4배 확대에서 뚜렷했고,
    // 간격을 0.7배로 좁히자 실루엣 잔차가 수묵 3.03px -> 1.80px 로 떨어졌다.
    expect(inkWash?.spacing).toBeCloseTo(2.3184);
    expect(resolveStudioBrushAliasWatercolorPlanSettings("pen", 20)).toBeNull();

    const source = [
      { x: 1, y: 2, radius: 10, opacity: 0.6, role: "core" as const },
      { x: 3, y: 4, radius: 12, opacity: 0.2, role: "diffuse" as const },
    ];
    const wash = applyStudioBrushAliasWatercolorMaterial("ink-wash", source);

    expect(source[0]).toEqual({ x: 1, y: 2, radius: 10, opacity: 0.6, role: "core" });
    expect(wash).toHaveLength(2);
    expect(wash[0]).toMatchObject({ x: 1, y: 2, role: "core" });
    expect(wash[0]?.radius).toBeCloseTo(7.2);
    expect(wash[0]?.opacity).toBeCloseTo(1);
    expect(wash[1]).toMatchObject({ x: 3, y: 4, role: "diffuse" });
    expect(wash[1]?.radius).toBeCloseTo(20.64);
    expect(wash[1]?.opacity).toBeCloseTo(0.104);
    expect(applyStudioBrushAliasWatercolorMaterial("pen", source)).toBe(source);

    // Pressure hand-feel is not identity: light samples stay thinner than full pressure.
    const light = mapStudioBrushAliasPressure("ink-wash", 0.1);
    const heavy = mapStudioBrushAliasPressure("ink-wash", 0.95);
    expect(heavy).toBeGreaterThan(light * 1.5);
  });

  it("plans the side-shade pencil broader, paler and rougher than every point pencil", () => {
    // 레인 카탈로그가 선언만 하고 렌더러가 분기하지 않던 변형 — 기본 연필과 바이트 동일한 평평한
    // 띠였다. 측면 음영은 넓은 치마 + 옅고 거친 코어여야 종이 결이 비친다.
    const side = resolveStudioBrushAliasPencilPasses("pencil--side-shade");
    const sideCore = side.find(({ role }) => role === "core")!;
    const sideSkirt = side.filter(({ role }) => role === "soft-edge");
    expect(side).not.toEqual(resolveStudioBrushAliasPencilPasses("pencil"));
    expect(sideSkirt.length).toBeGreaterThan(2);
    expect(sideSkirt[0]!.widthScale).toBeCloseTo(2.2, 6);
    for (const id of ["pencil", "pencil-2b", "pencil-6b", "soft-pencil"] as const) {
      const core = resolveStudioBrushAliasPencilPasses(id).find(({ role }) => role === "core")!;
      expect(sideCore.opacityScale, id).toBeLessThan(core.opacityScale);
      expect(sideCore.jitterRadius, id).toBeGreaterThan(core.jitterRadius);
      expect(sideCore.widthScale, id).toBeGreaterThan(core.widthScale);
    }
  });

  it("keeps standard pencil one-pass while soft pencil plans a pale skirt and rough core", () => {
    expect(resolveStudioBrushAliasPencilPasses("pencil")).toEqual([
      { role: "core", widthScale: 1, opacityScale: 1, jitterRadius: 0.75 },
    ]);
    // soft-edge 는 이제 한 장이 아니라 껍질 여러 장으로 펼쳐진다. 예전 구현은 코어 뒤에 폭만
    // 넓힌 단단한 선 하나였고, 확대하면 부드러운 가장자리가 아니라 균일한 회색 테두리로 보였다.
    const soft = resolveStudioBrushAliasPencilPasses("soft-pencil");
    const skirt = soft.filter(({ role }) => role === "soft-edge");
    const core = soft.filter(({ role }) => role === "core");
    expect(core).toEqual([
      { role: "core", widthScale: 1, opacityScale: 0.72, jitterRadius: 1.2 },
    ]);
    expect(skirt.length).toBeGreaterThan(2);
    // 폭은 선언 폭에서 코어 폭까지 단조 감소해야 기울기가 된다.
    expect(skirt[0]!.widthScale).toBeCloseTo(1.9, 6);
    expect(skirt.at(-1)!.widthScale).toBeCloseTo(1, 6);
    for (let index = 1; index < skirt.length; index += 1) {
      expect(skirt[index]!.widthScale).toBeLessThan(skirt[index - 1]!.widthScale);
    }
    // 껍질들이 접히면 원래 선언한 불투명도에 정확히 도달한다 — 농도가 조용히 달라지지 않는다.
    const folded = skirt.reduce((carried, pass) => 1 - (1 - carried) * (1 - pass.opacityScale), 0);
    expect(folded).toBeCloseTo(0.18, 6);
    expect(new Set(skirt.map(({ jitterRadius }) => jitterRadius))).toEqual(new Set([0.3]));
    expect(studioBrushAliasEffectiveDiameter("soft-pencil", 5)).toBe(6.4);
    expect(resolveStudioBrushAliasPencilPasses("marker")).toEqual([]);
  });
});
