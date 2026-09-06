/**
 * 엔진 프로그램 세트는 브러시 id 스위치를 대체하지 않고 "덮어쓸 수 있게" 만든다.
 *
 * 이 파일이 지키는 계약은 두 가지다. 하나는 오버라이드가 없을 때 기존 프리셋의 플랜이 바이트 단위로
 * 같아야 한다는 것 — 세트를 도입한 대가로 출하된 브러시가 조금이라도 달라지면 안 된다. 다른 하나는
 * 오버라이드가 있을 때 그것이 실제로 페인트 시점에 반영돼야 한다는 것 — 선언만 되고 그려지지 않는
 * 레인은 이 저장소가 반복해서 겪은 실패 모드다(지침 6: 정직성).
 */
import { describe, expect, it } from "vitest";

import { planOilBrushDabs } from "../studio-fx-brush";

import {
  normalizeStudioBrushEngineProgramSet,
  STUDIO_BRUSH_ENGINE_PROGRAM_SET_VERSION,
  STUDIO_BRUSH_OIL_PROGRAM_KEYS,
  STUDIO_OIL_PROGRAM_MATRIX_BRUSH_IDS,
  studioBrushEngineProgramSetFromOil,
  studioBrushEngineProgramSetMatchesBrush,
  studioBrushWatercolorProgramSetFrom,
  studioOilProgramSetForBrush,
  studioOilRibbonProgramsFromSet,
  type StudioBrushOilProgramSet,
} from "./studio-brush-engine-program-set";
import {
  planStudioOilRibbonCarrier,
  studioOilRibbonProgramsForBrush,
} from "./studio-oil-ribbon-carrier";

/** 프로그램이 실제로 붙었는지 판정할 수 있을 만큼 긴 곡선 획. */
function oilDabs(seed: number) {
  const points: number[] = [];
  const pressures: number[] = [];
  for (let index = 0; index < 40; index += 1) {
    points.push(30 + index * 14, 60 + Math.sin(index / 6) * 18);
    pressures.push(0.68);
  }
  return planOilBrushDabs({ points, pressures, baseWidth: 30, seed });
}

/**
 * `studioOilRibbonProgramsForBrush` 의 id 매트릭스에 실제로 행이 있는 일곱 id. 앞의 다섯은 각자
 * 다른 조합을 켜고, 뒤의 둘(oil·acrylic)은 2026-08-20(517f96a1) 부터 한 case 로 묶여 세 프로그램을 전부 켠다.
 * 표는 모듈이 데이터로 내보내는 목록을 그대로 쓴다 — 이 파일의 사설 사본은 2026-08-20 확장을 두 주
 * 동안 놓쳤고, 엔진 편집기의 사본도 같은 식으로 뒤처졌다. 매트릭스에 case 를 더하면 그 목록과
 * 캐리어 docstring 의 개수를 같이 늘리고, 아래 정직성 테스트가 목록의 항목 하나하나를 행과 대조한다.
 */
const OIL_MATRIX_BRUSH_IDS = STUDIO_OIL_PROGRAM_MATRIX_BRUSH_IDS;

/** 매트릭스에 행이 없어 default 로 떨어지는 대표 id — 아무 프로그램도 켜지 않는다. */
const OIL_DEFAULT_BRUSH_ID = "brush--oil-lanes" as const;

/** 계약 테스트가 도는 전체 표: 매트릭스 일곱 id + default. */
const OIL_BRUSH_IDS = [...OIL_MATRIX_BRUSH_IDS, OIL_DEFAULT_BRUSH_ID] as const;

describe("엔진 프로그램 세트", () => {
  it("오버라이드가 없으면 출하된 유화 브러시의 플랜이 그대로다", () => {
    for (const brush of OIL_BRUSH_IDS) {
      const dabs = oilDabs(17);
      const legacy = planStudioOilRibbonCarrier(
        dabs,
        studioOilRibbonProgramsForBrush(brush, 17),
      );
      // 명시적으로 null/undefined 를 넘겨도 같은 경로여야 한다 — 호출부가 옵셔널 체이닝으로
      // undefined 를 흘려보내는 게 정상 경로이기 때문이다.
      for (const absent of [undefined, null] as const) {
        const same = planStudioOilRibbonCarrier(
          dabs,
          studioOilRibbonProgramsForBrush(brush, 17, absent),
        );
        expect(same, brush).toEqual(legacy);
      }
    }
  });


  it("id 매트릭스를 세트로 다시 쓴 표가 원본과 같은 프로그램을 켠다", () => {
    for (const brush of OIL_BRUSH_IDS) {
      const dabs = oilDabs(23);
      const fromId = planStudioOilRibbonCarrier(
        dabs,
        studioOilRibbonProgramsForBrush(brush, 23),
      );
      const fromSet = planStudioOilRibbonCarrier(
        dabs,
        studioOilRibbonProgramsForBrush(brush, 23, studioOilProgramSetForBrush(brush)),
      );
      expect(fromSet, brush).toEqual(fromId);
    }
  });

  it("표의 일곱 id 는 전부 매트릭스 행이고 default 대표는 아무 프로그램도 켜지 않는다", () => {
    // 위 두 계약은 표를 그대로 믿는다. 표에 적힌 id 가 실은 default 로 떨어지고 있으면 '검사했다'고
    // 말하면서 빈 경로를 도는 셈이므로, 행이 있는 id 는 옵션 객체를 내고 세트도 빈 세트가 아니어야
    // 하며, default 대표는 둘 다 비어 있어야 표가 정직하다.
    const empty = studioOilProgramSetForBrush(OIL_DEFAULT_BRUSH_ID);
    expect(studioOilRibbonProgramsForBrush(OIL_DEFAULT_BRUSH_ID, 5)).toBeUndefined();
    expect(STUDIO_BRUSH_OIL_PROGRAM_KEYS.some((key) => empty[key])).toBe(false);
    for (const brush of OIL_MATRIX_BRUSH_IDS) {
      expect(studioOilRibbonProgramsForBrush(brush, 5), brush).toBeDefined();
      expect(studioOilProgramSetForBrush(brush), brush).not.toEqual(empty);
    }
    // 캐리어 docstring 이 "seven ids and the default" 라고 말한다 — 그 숫자를 여기 묶어 둔다.
    expect(OIL_MATRIX_BRUSH_IDS).toHaveLength(7);
    expect(new Set<string>(OIL_BRUSH_IDS).size).toBe(OIL_BRUSH_IDS.length);
  });

  it("여덟 가지 조합이 모두 페인트 시점에 구분되는 플랜을 낸다", () => {
    // 세트를 도입할 당시 id 스위치로는 다섯 가지 조합만 표현할 수 있었고(지금은 전부 켬 행이
    // 더해져 여섯), 그중 impasto+depletion 처럼 물리적으로 말이 되는 조합은 아예 존재하지 않았다. 여기서 여덟 가지가 전부 서로 다른 플랜을 낸다는 것이
    // "엔진을 조합해 커스텀 브러시를 만든다"가 선언이 아니라는 증거다.
    const dabs = oilDabs(41);
    const signatures = new Map<string, StudioBrushOilProgramSet>();
    for (let mask = 0; mask < 8; mask += 1) {
      const programs: StudioBrushOilProgramSet = {
        bristlePhysics: (mask & 1) !== 0,
        bristleLoadDynamics: (mask & 2) !== 0,
        impastoRelief: (mask & 4) !== 0,
      };
      const plan = planStudioOilRibbonCarrier(
        dabs,
        studioOilRibbonProgramsForBrush("brush--oil-lanes", 41, programs),
      );
      const signature = JSON.stringify({
        lanes: plan.bristleLanes,
        relief: plan.impastoReliefLanes ?? null,
        body: plan.body,
      });
      expect(signatures.has(signature), JSON.stringify(programs)).toBe(false);
      signatures.set(signature, programs);
    }
    expect(signatures.size).toBe(8);
  });

  it("릴리프 프로그램만 플랜에 릴리프 레인을 붙인다", () => {
    const dabs = oilDabs(59);
    const without = planStudioOilRibbonCarrier(
      dabs,
      studioOilRibbonProgramsForBrush("brush--oil-lanes", 59, {
        bristlePhysics: true,
        bristleLoadDynamics: true,
        impastoRelief: false,
      }),
    );
    const relief = planStudioOilRibbonCarrier(
      dabs,
      studioOilRibbonProgramsForBrush("brush--oil-lanes", 59, {
        bristlePhysics: true,
        bristleLoadDynamics: true,
        impastoRelief: true,
      }),
    );
    expect(without.impastoReliefLanes).toBeUndefined();
    expect(relief.impastoReliefLanes?.length ?? 0).toBeGreaterThan(0);
    // 릴리프는 덧붙이기만 한다 — 본체와 강모 레인은 그대로여야 한다(캐리어의 기존 계약).
    expect(relief.body).toEqual(without.body);
    expect(relief.bristleLanes).toEqual(without.bristleLanes);
  });

  it("아무 프로그램도 켜지 않으면 옵션 객체 자체를 만들지 않는다", () => {
    // 캐리어의 바이트 동일성 계약은 옵션 객체의 '부재'에 대해 쓰여 있다. 전부 false 인 세트를
    // `{ bristlePhysics: { enabled: false } }` 로 넘기면 계약이 깨질 수 있으므로 아예 만들지 않는다.
    expect(studioOilRibbonProgramsFromSet({
      bristlePhysics: false,
      bristleLoadDynamics: false,
      impastoRelief: false,
    }, 7)).toBeUndefined();
    expect(studioOilRibbonProgramsForBrush("brush--oil-lanes", 7)).toBeUndefined();
  });

  it("신뢰할 수 없는 입력은 fail-closed 로 베이스라인에 맡긴다", () => {
    for (const bad of [null, undefined, 3, "oil", [], {}, { version: 2 }, { version: "1" }]) {
      expect(normalizeStudioBrushEngineProgramSet(bad), JSON.stringify(bad)).toBeNull();
    }
    // 버전만 맞고 oil 키가 없으면 유효한 빈 세트다(다른 엔진 계열이 나중에 붙을 자리).
    const empty = normalizeStudioBrushEngineProgramSet({
      version: STUDIO_BRUSH_ENGINE_PROGRAM_SET_VERSION,
    });
    expect(empty).toEqual({ version: STUDIO_BRUSH_ENGINE_PROGRAM_SET_VERSION });

    // 누락되거나 불린이 아닌 값은 false 로 읽는다 — 저장된 획이 다시 열릴 때 없던 프로그램이
    // 켜지는 쪽보다, 켜져 있던 프로그램이 꺼지는 쪽이 안전하다.
    const coerced = normalizeStudioBrushEngineProgramSet({
      version: STUDIO_BRUSH_ENGINE_PROGRAM_SET_VERSION,
      oil: { bristlePhysics: 1, bristleLoadDynamics: true, impastoRelief: "yes" },
    });
    expect(coerced?.oil).toEqual({
      bristlePhysics: false,
      bristleLoadDynamics: true,
      impastoRelief: false,
    });
  });

  it("수채 웻 텍스처 프로그램 id 는 형식이 옳을 때만 보존된다", () => {
    const good = normalizeStudioBrushEngineProgramSet({
      version: STUDIO_BRUSH_ENGINE_PROGRAM_SET_VERSION,
      watercolor: {
        wetEdgeBloomProgramId: "chroma-halo",
        livingInkBakeProgramId: "sumi-flow-bake",
      },
    });
    expect(good?.watercolor).toEqual({
      wetEdgeBloomProgramId: "chroma-halo",
      livingInkBakeProgramId: "sumi-flow-bake",
    });
    // 모르는 id 도 형식만 맞으면 통과한다 — 존재 판정은 소비 시점 리졸버의 단일 권위다.
    const unknownId = normalizeStudioBrushEngineProgramSet({
      version: STUDIO_BRUSH_ENGINE_PROGRAM_SET_VERSION,
      watercolor: { wetEdgeBloomProgramId: "not-a-program-yet" },
    });
    expect(unknownId?.watercolor?.wetEdgeBloomProgramId).toBe("not-a-program-yet");
    // 형식이 틀린 id 는 떨어뜨리고, 둘 다 없으면 수채 키 자체를 만들지 않는다.
    for (const bad of [42, "", "UPPER", "space id", `${"a".repeat(65)}`]) {
      const dropped = normalizeStudioBrushEngineProgramSet({
        version: STUDIO_BRUSH_ENGINE_PROGRAM_SET_VERSION,
        watercolor: { wetEdgeBloomProgramId: bad },
      });
      expect(dropped?.watercolor, JSON.stringify(bad)).toBeUndefined();
    }
  });

  it("수채 오버라이드가 실린 세트는 '프리셋과 같음'이 아니라 커스텀 조합이다", () => {
    expect(
      studioBrushEngineProgramSetMatchesBrush(
        "watercolor--edge-bloom",
        studioBrushWatercolorProgramSetFrom({ wetEdgeBloomProgramId: "edge-bloom" }),
      ),
    ).toBe(false);
    expect(studioBrushEngineProgramSetMatchesBrush("watercolor", null)).toBe(true);
  });

  it("프리셋과 같은 세트인지 판정해 편집기가 '기본값과 같음'을 말할 수 있다", () => {
    for (const brush of OIL_BRUSH_IDS) {
      const baseline = studioOilProgramSetForBrush(brush);
      expect(
        studioBrushEngineProgramSetMatchesBrush(brush, studioBrushEngineProgramSetFromOil(baseline)),
        brush,
      ).toBe(true);
      const flipped = {
        ...baseline,
        impastoRelief: !baseline.impastoRelief,
      };
      expect(
        studioBrushEngineProgramSetMatchesBrush(brush, studioBrushEngineProgramSetFromOil(flipped)),
        brush,
      ).toBe(false);
    }
    expect(studioBrushEngineProgramSetMatchesBrush("oil--filbert-ribbon", null)).toBe(true);
  });

  it("프로그램 키 목록이 세트의 실제 키와 일치한다", () => {
    const baseline = studioOilProgramSetForBrush("oil--impasto-ribbon");
    expect([...STUDIO_BRUSH_OIL_PROGRAM_KEYS].sort()).toEqual(Object.keys(baseline).sort());
  });
});

/**
 * 커스텀 조합은 SVG 내보내기까지 살아남아야 한다.
 *
 * 이 저장소가 반복해서 겪은 실패 모드가 정확히 이것이다 — 캔버스에서만 실재하고 내보내기에서는
 * 프리셋 기본값으로 되돌아가는 레인. 두 표면이 같은 리졸버에 같은 키를 넘기는지 문자열로 확인한다.
 */
describe("엔진 프로그램 세트 · SVG 내보내기 패리티", () => {
  it("임파스토를 켠 커스텀 조합이 내보내기에서도 릴리프 레인을 낸다", async () => {
    const { exportPageToSvg } = await import("../export/studio-svg-export");
    const base = {
      id: "custom-oil",
      type: "draw" as const,
      kind: "freehand" as const,
      brush: "brush--oil-lanes",
      points: [8, 18, 120, 45, 240, 8, 380, 60, 520, 20],
      pressures: [0.35, 0.72, 0.5, 0.9, 0.62],
      stroke: "#8b3f31",
      strokeWidth: 24,
    };
    const page = (element: unknown) => ({
      id: "p1",
      width: 600,
      height: 120,
      background: "#ffffff",
      elements: [element],
    });

    const plain = exportPageToSvg(page(base) as never).svg;
    const impasto = exportPageToSvg(page({
      ...base,
      brushEnginePrograms: studioBrushEngineProgramSetFromOil({
        bristlePhysics: true,
        bristleLoadDynamics: false,
        impastoRelief: true,
      }),
    }) as never).svg;

    // 프리셋 brush--oil-lanes 는 아무 프로그램도 켜지 않는다 — 그래서 릴리프가 없다.
    expect(plain).toContain('data-brush-engine="oil-ribbon-carrier-v1"');
    expect(plain).not.toContain("data-paint-impasto-relief");
    // 세트를 실으면 같은 브러시 id 로 릴리프가 나온다. 이 브러시에 대응하는 프리셋 id 는 없다.
    expect(impasto).toContain("data-paint-impasto-relief");
    expect(impasto).not.toBe(plain);
  });

  it("수채 블룸 오버라이드를 실은 획이 내보내기에서도 증강된 dab을 낸다", async () => {
    const { exportPageToSvg } = await import("../export/studio-svg-export");
    const base = {
      id: "custom-watercolor",
      type: "draw" as const,
      kind: "freehand" as const,
      mode: "pen" as const,
      brush: "watercolor",
      points: [8, 18, 120, 45, 240, 8, 380, 60, 520, 20],
      pressures: [0.35, 0.72, 0.5, 0.9, 0.62],
      stroke: "#3f6f8b",
      strokeWidth: 26,
      seed: 4100,
    };
    const page = (element: unknown) => ({
      id: "p1",
      width: 600,
      height: 120,
      background: "#ffffff",
      elements: [element],
    });

    const plain = exportPageToSvg(page(base) as never).svg;
    const bloomed = exportPageToSvg(page({
      ...base,
      brushEnginePrograms: studioBrushWatercolorProgramSetFrom({
        wetEdgeBloomProgramId: "chroma-halo",
      }),
    }) as never).svg;

    expect(bloomed).not.toBe(plain);
    // 블룸 bead dab 이 추가되므로 원(circle) 수가 늘어난다.
    const circles = (svg: string) => (svg.match(/<circle /gu) ?? []).length;
    expect(circles(bloomed)).toBeGreaterThan(circles(plain));
  });
});
