import { describe, expect, it } from "vitest";

import {
  planStudioStampBrushDabs,
  resolveStudioStampBrushKind,
  resolveStudioStampBrushStyle,
  STUDIO_STAMP_BRUSH_DEFAULTS,
  type StudioStampBrushDab,
  type StudioStampBrushStyle,
} from "./brush/studio-brush-stamp-engine";
import {
  isStudioCc0MypaintPresetBrushId,
  listStudioCc0MypaintPresetImports,
  resolveStudioCc0MypaintPresetImport,
  resolveStudioCc0MypaintStampBrushKind,
  resolveStudioCc0MypaintStampTuning,
  STUDIO_CC0_MYPAINT_PRESET_BRUSH_ID_PREFIX,
  STUDIO_CC0_MYPAINT_PRESET_IMPORTS,
  STUDIO_CC0_MYPAINT_PRESET_PROVENANCE,
  studioLibmypaintDabsPerPixel,
  studioLibmypaintLinearizedDabAlpha,
} from "./studio-cc0-mypaint-preset-import-v1";

/** 12개 프리셋을 두루 지나는 결정적 S자 스트로크(속도·필압 변화 포함). */
function serpentineStroke(samples: number): { points: number[]; pressures: number[] } {
  const points: number[] = [];
  const pressures: number[] = [];
  for (let index = 0; index < samples; index += 1) {
    const t = index / Math.max(1, samples - 1);
    points.push(
      12 + t * 200 + Math.sin(t * Math.PI * 3) * 8,
      40 + Math.sin(t * Math.PI * 2) * 26,
    );
    pressures.push(0.15 + 0.75 * Math.abs(Math.sin(t * Math.PI * 1.5)));
  }
  return { points, pressures };
}

function resolvePresetStyle(brushId: string): StudioStampBrushStyle {
  const kind = resolveStudioStampBrushKind(brushId);
  expect(kind, `${brushId}: must resolve a stamp kind`).not.toBeNull();
  return resolveStudioStampBrushStyle(
    kind!,
    { color: "#31435a", size: 18, opacity: 0.8 },
    null,
    brushId,
  );
}

/**
 * 좌표 격자 커버리지 맵 — dab 계획만으로 질감 배치를 비교한다(Canvas 불요, 순수 함수).
 * hardness 는 경도별 falloff 로 반영해 팁 경도 차이도 지도에 나타난다.
 */
function coverageMap(style: StudioStampBrushStyle, dabs: readonly StudioStampBrushDab[]): Float64Array {
  const grid = 48;
  const map = new Float64Array(grid * grid);
  const minX = -20;
  const maxX = 240;
  const minY = -20;
  const maxY = 100;
  const scaleX = grid / (maxX - minX);
  const scaleY = grid / (maxY - minY);
  const falloffPower = 0.35 + (1 - style.hardness) * 1.8;
  for (const dab of dabs) {
    const cellX = Math.floor((dab.x - minX) * scaleX);
    const cellY = Math.floor((dab.y - minY) * scaleY);
    const cellRadius = Math.max(1, Math.ceil(dab.radius * scaleX));
    for (let dy = -cellRadius; dy <= cellRadius; dy += 1) {
      for (let dx = -cellRadius; dx <= cellRadius; dx += 1) {
        const gx = cellX + dx;
        const gy = cellY + dy;
        if (gx < 0 || gy < 0 || gx >= grid || gy >= grid) continue;
        const distance = Math.hypot(dx, dy) / cellRadius;
        if (distance > 1) continue;
        map[gy * grid + gx] += dab.alpha * Math.pow(1 - distance, falloffPower);
      }
    }
  }
  return map;
}

/**
 * 페어 공유 스케일 정규화 거리 — 두 지도를 같은 divisor(둘의 최대값)로 나눈 뒤, 두 지도의
 * 합집합 서포트(어느 한쪽이라도 잉크가 닿은 셀)에서만 평균 절대차를 잰다. 가는 획이 빈 셀
 * 바다에 희석되지 않으면서 배치·밀도·경도 형태 차이와 침착 레벨 차이(선형화 flow 축)를
 * 모두 질감 거리로 잡는다.
 */
function pairCoverageDistance(a: Float64Array, b: Float64Array): number {
  let shared = 0;
  for (const value of a) shared = Math.max(shared, value);
  for (const value of b) shared = Math.max(shared, value);
  if (shared <= 0) return 0;
  const supportEpsilon = shared * 1e-4;
  let sum = 0;
  let support = 0;
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index]!;
    const right = b[index] ?? 0;
    if (left <= supportEpsilon && right <= supportEpsilon) continue;
    sum += Math.abs(left - right) / shared;
    support += 1;
  }
  return support > 0 ? sum / support : 0;
}

describe("studio-cc0-mypaint-preset-import-v1", () => {
  it("ships 17 registered presets with exact CC0 provenance", () => {
    const imports = listStudioCc0MypaintPresetImports();
    expect(imports).toHaveLength(17);
    expect(STUDIO_CC0_MYPAINT_PRESET_PROVENANCE.license).toBe("CC0-1.0");
    expect(STUDIO_CC0_MYPAINT_PRESET_PROVENANCE.repository).toContain("mypaint/mypaint-brushes");
    const ids = new Set<string>();
    for (const entry of imports) {
      expect(entry.brushId).toBe(`${STUDIO_CC0_MYPAINT_PRESET_BRUSH_ID_PREFIX}${entry.presetId}`);
      expect(entry.upstreamFile).toMatch(/^brushes\/(classic|deevad|tanda|ramon)\/.+\.myb$/u);
      expect(entry.upstreamFile).toContain(`${entry.pack}/`);
      // User-facing names spell the licence out in plain language: "CC0" is a licence identifier
      // that means nothing to an artist, while "오픈소스" says the part they care about. The
      // provenance record below still pins the actual CC0-1.0 licence.
      expect(entry.nameKo).toContain("MyPaint 오픈소스");
      expect(ids.has(entry.brushId)).toBe(false);
      ids.add(entry.brushId);
      // Verbatim 테이블에는 최소한 opaque/radius/hardness 축이 남아 있어야 한다.
      expect(entry.verbatim["opaque"]).toBeDefined();
      expect(entry.verbatim["radius_logarithmic"]).toBeDefined();
      expect(entry.verbatim["hardness"]).toBeDefined();
    }
  });

  it("keeps the mapped tuning consistent with its own verbatim dab densities", () => {
    for (const entry of STUDIO_CC0_MYPAINT_PRESET_IMPORTS) {
      const actual = entry.verbatim["dabs_per_actual_radius"]?.baseValue ?? 0;
      const basic = entry.verbatim["dabs_per_basic_radius"]?.baseValue ?? 0;
      const rawPerDiameter = (actual + basic) * 2;
      expect(entry.mapped.dabsPerPixel).toBeCloseTo(Math.max(1, rawPerDiameter), 6);
      const expectedSpacing = Math.min(4, Math.max(0.03, 1 / Math.max(1e-6, rawPerDiameter)));
      expect(entry.mapped.spacingRatio).toBeCloseTo(expectedSpacing, 2);
      const linearize = entry.verbatim["opaque_linearize"]?.baseValue ?? 0;
      expect(entry.mapped.opaqueLinearize).toBe(linearize);
      expect(entry.mapped.flow).toBeGreaterThan(0);
      expect(entry.mapped.flow).toBeLessThanOrEqual(1);
      expect(entry.mapped.hardness).toBe(entry.verbatim["hardness"]!.baseValue);
    }
  });

  it("linearization matches libmypaint reference values (inline recomputation)", () => {
    // libmypaint mypaint-brush.c: alpha_dab = 1 − (1 − opaque)^(1/dabs_per_pixel),
    // dabs_per_pixel = 1 + linearize·(max(1, 2·(DPAR + DPBR)) − 1).
    expect(studioLibmypaintDabsPerPixel(3.32, 0, 0.9)).toBeCloseTo(6.076, 12);
    expect(studioLibmypaintDabsPerPixel(2, 3.24, 0.29)).toBeCloseTo(3.7492, 12);
    expect(studioLibmypaintDabsPerPixel(6, 4.39, 0.9)).toBeCloseTo(18.802, 12);
    // splatter-02: 2·0.05 = 0.1 → dabs don't overlap → floor 1 → correction off.
    expect(studioLibmypaintDabsPerPixel(0, 0.05, 0.9)).toBe(1);

    expect(studioLibmypaintLinearizedDabAlpha(0.4, 10)).toBeCloseTo(0.049799783494324, 12);
    expect(studioLibmypaintLinearizedDabAlpha(0.8, 24)).toBeCloseTo(0.064860827351796, 12);
    expect(studioLibmypaintLinearizedDabAlpha(0.5, 6.076)).toBeCloseTo(0.107812996151362, 12);
    expect(studioLibmypaintLinearizedDabAlpha(0.9686, 3.7492)).toBeCloseTo(0.602720904682010, 12);
    expect(studioLibmypaintLinearizedDabAlpha(0.7752, 18.802)).toBeCloseTo(0.076313177928430, 12);
    expect(studioLibmypaintLinearizedDabAlpha(0.887, 6.949)).toBeCloseTo(0.269310801775975, 12);
  });

  it("linearization is monotonic with exact endpoints and dpp≤1 identity", () => {
    // Endpoints: target 0 → 0, target 1 → 1 (per-dab alpha saturates with the stroke target).
    for (const dpp of [1, 2, 6.076, 24]) {
      expect(studioLibmypaintLinearizedDabAlpha(0, dpp)).toBe(0);
      expect(studioLibmypaintLinearizedDabAlpha(1, dpp)).toBe(1);
    }
    // dabs_per_pixel ≤ 1 → identity (libmypaint floors: "correction not wanted without overlap").
    for (const opaque of [0.1, 0.4, 0.9]) {
      expect(studioLibmypaintLinearizedDabAlpha(opaque, 1)).toBe(opaque);
      expect(studioLibmypaintLinearizedDabAlpha(opaque, 0.25)).toBe(opaque);
    }
    // Monotonic in opaque at fixed dpp; monotonic decreasing in dpp at fixed opaque.
    let previous = -1;
    for (let step = 0; step <= 20; step += 1) {
      const value = studioLibmypaintLinearizedDabAlpha(step / 20, 8);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
    let previousByDpp = 2;
    for (const dpp of [1, 2, 4, 8, 16, 32]) {
      const value = studioLibmypaintLinearizedDabAlpha(0.6, dpp);
      expect(value).toBeLessThanOrEqual(previousByDpp);
      previousByDpp = value;
    }
  });

  it("resolves stamp kinds for registered ids only (fail-closed for unknown suffixes)", () => {
    for (const entry of STUDIO_CC0_MYPAINT_PRESET_IMPORTS) {
      expect(isStudioCc0MypaintPresetBrushId(entry.brushId)).toBe(true);
      expect(resolveStudioCc0MypaintStampBrushKind(entry.brushId)).toBe(entry.kind);
      expect(resolveStudioStampBrushKind(entry.brushId)).toBe(entry.kind);
    }
    // 미등록 접미사·전혀 다른 id — 이 모듈은 렌더러를 추측하지 않는다(null = fail-closed).
    for (const unknown of ["mypaint-cc0--nope", "mypaint-cc0--", "mypaint-cc0", "pen"]) {
      expect(isStudioCc0MypaintPresetBrushId(unknown)).toBe(false);
      expect(resolveStudioCc0MypaintStampBrushKind(unknown)).toBeNull();
      expect(resolveStudioCc0MypaintStampTuning(unknown)).toBeNull();
    }
    expect(resolveStudioStampBrushKind("mypaint-cc0--nope")).toBeNull();
    // 기존 스탬프 id 매핑은 그대로다.
    expect(resolveStudioStampBrushKind("mypaint-smudge-oil")).toBe("mypaint");
    expect(resolveStudioStampBrushKind("mypaint-watercolor-expressive")).toBe("mypaint");
    expect(resolveStudioStampBrushKind("wash-brush")).toBe("watercolor");
    expect(resolveStudioStampBrushKind("charcoal--mypaint-stamp")).toBe("charcoal");
  });

  it("materializes each preset into a stamp style carrying its verbatim-derived tuning", () => {
    for (const entry of STUDIO_CC0_MYPAINT_PRESET_IMPORTS) {
      const style = resolvePresetStyle(entry.brushId);
      expect(style.kind).toBe(entry.kind);
      expect(style.flow).toBeCloseTo(Math.max(0.03, entry.mapped.flow), 12);
      expect(style.hardness).toBeCloseTo(entry.mapped.hardness, 12);
      expect(style.minSizeRatio).toBeCloseTo(entry.mapped.minSizeRatio, 12);
      expect(style.spacingRatio).toBeCloseTo(
        Math.max(0.03, Math.min(4, entry.mapped.spacingRatio)),
        12,
      );
      const dynamics = style.mypaintCc0Dynamics;
      expect(dynamics, `${entry.brushId}: dynamics must ride the style`).toBeDefined();
      expect(dynamics!.scatter).toBe(entry.mapped.scatter);
      expect(dynamics!.radiusJitter).toBe(entry.mapped.radiusJitter);
      if (entry.mapped.opaqueLinearize > 0) {
        expect(dynamics!.linearizedFlow).toBeCloseTo(
          studioLibmypaintLinearizedDabAlpha(
            style.flow,
            1 + entry.mapped.opaqueLinearize * (Math.max(1, entry.mapped.dabsPerPixel) - 1),
          ),
          12,
        );
      } else {
        expect(dynamics!.linearizedFlow).toBeNull();
      }
    }
  });

  it("re-linearizes when the artist tunes flow (target saturation reinterpretation)", () => {
    const entry = resolveStudioCc0MypaintPresetImport("mypaint-cc0--watercolor-fringe")!;
    const tuned = resolveStudioStampBrushStyle(
      entry.kind,
      { color: "#31435a", size: 18, opacity: 0.8 },
      { flow: 0.4 },
      entry.brushId,
    );
    expect(tuned.flow).toBeCloseTo(0.4, 12);
    expect(tuned.mypaintCc0Dynamics!.linearizedFlow).toBeCloseTo(
      studioLibmypaintLinearizedDabAlpha(0.4, 18.802),
      12,
    );
    // 선형화된 dab 알파는 목표 채도보다 항상 옅다(중첩 수렴 원리).
    expect(tuned.mypaintCc0Dynamics!.linearizedFlow!).toBeLessThan(0.4);
  });

  it("plans deterministically and applies the linearized alpha to every dab", () => {
    const { points, pressures } = serpentineStroke(160);
    for (const entry of STUDIO_CC0_MYPAINT_PRESET_IMPORTS) {
      const style = resolvePresetStyle(entry.brushId);
      const first = planStudioStampBrushDabs(style, points, pressures);
      const second = planStudioStampBrushDabs(style, points, pressures);
      expect(second).toEqual(first);
      // sparse 스플래터(간격 4지름)도 시작 도트 + 워커 dab 이 반드시 존재한다.
      expect(first.length).toBeGreaterThanOrEqual(2);
      const dynamics = style.mypaintCc0Dynamics!;
      const expectedFlow = dynamics.linearizedFlow ?? style.flow;
      const referenceAlpha = expectedFlow * style.opacity;
      for (const dab of first) {
        expect(Number.isFinite(dab.x)).toBe(true);
        expect(Number.isFinite(dab.y)).toBe(true);
        expect(dab.radius).toBeGreaterThan(0);
        expect(dab.alpha).toBeGreaterThan(0);
        expect(dab.alpha).toBeLessThanOrEqual(style.opacity);
      }
      // 의도적 변경: 이 루프는 원래 "모든 dab 이 같은 알파"를 고정하고 있었는데, 그게 바로
      // 결함이었다. 18개 프리셋이 opaque/opaque_multiply 에 필압 곡선을 적고 있는데 dab 알파에는
      // 필압 항이 아예 없어서, 0.12→0.90 램프를 그려도 잉크 농도가 그대로이거나(2b-pencil 1.010)
      // 오히려 옅어졌다(dry-brush 0.926). 이제 응답 표를 가진 레인은 dab 마다 달라야 한다.
      const alphas = [...new Set(first.map((dab) => dab.alpha))];
      const respondsToPressure =
        dynamics.flowPressureResponse !== undefined && entry.kind !== "ink";
      if (!respondsToPressure) {
        // 표가 없거나(필압 무관 프리셋) ink 레인(리본이 단일 불투명도로 합치는 캐리어)은
        // 예전 그대로 — 한 획이 한 알파다.
        for (const dab of first) expect(dab.alpha).toBeCloseTo(referenceAlpha, 12);
        continue;
      }
      expect(alphas.length, `${entry.brushId} varies with pressure`).toBeGreaterThan(1);
      // 표는 기준 필압 0.5 에서 1 로 정규화돼 있고 이 획은 0.15..0.90 을 지나므로, 손으로 적은
      // flow 가 실제 침착 범위 안에 들어와야 한다 — 응답이 프리셋 전체를 다시 쓰지 않았다는 뜻.
      expect(Math.min(...alphas)).toBeLessThan(referenceAlpha);
      expect(Math.max(...alphas)).toBeGreaterThan(referenceAlpha * 0.999);
    }
  });

  it("keeps non-cc0 stamp brushes byte-identical (no dynamics field, unchanged plans)", () => {
    const { points, pressures } = serpentineStroke(120);
    const legacyIds: readonly { id: string; kind: "mypaint" | "watercolor" | "charcoal" }[] = [
      { id: "mypaint-smudge-oil", kind: "mypaint" },
      { id: "mypaint-watercolor-expressive", kind: "mypaint" },
      { id: "wash-brush", kind: "watercolor" },
      { id: "charcoal--mypaint-stamp", kind: "charcoal" },
    ];
    for (const legacy of legacyIds) {
      const resolved = resolveStudioStampBrushStyle(
        legacy.kind,
        { color: "#31435a", size: 18, opacity: 0.8 },
        null,
        legacy.id,
      );
      expect(resolved.mypaintCc0Dynamics).toBeUndefined();
      // 배선 이전과 같은 산식을 손으로 재구성한 스타일과 계획이 완전히 일치해야 한다.
      const manual: StudioStampBrushStyle = {
        kind: resolved.kind,
        color: resolved.color,
        size: resolved.size,
        opacity: resolved.opacity,
        flow: resolved.flow,
        hardness: resolved.hardness,
        minSizeRatio: resolved.minSizeRatio,
        spacingRatio: resolved.spacingRatio,
        ...(resolved.paperGrain ? { paperGrain: resolved.paperGrain } : {}),
      };
      expect(planStudioStampBrushDabs(resolved, points, pressures)).toEqual(
        planStudioStampBrushDabs(manual, points, pressures),
      );
      // dab 알파도 기존 산식 그대로: flow × opacity (종이 핀 레인은 침착 스케일 포함).
      const plan = planStudioStampBrushDabs(resolved, points, pressures);
      if (!resolved.paperGrain) {
        for (const dab of plan) {
          expect(dab.alpha).toBeCloseTo(resolved.flow * resolved.opacity, 12);
        }
      }
    }
    // 스타일 기본값 사전은 변경 금지(회귀 앵커).
    expect(STUDIO_STAMP_BRUSH_DEFAULTS.mypaint).toEqual({
      flow: 0.75,
      hardness: 0.6,
      minSizeRatio: 0.25,
    });
  });

  it("scatter and radius jitter are deterministic, index-seeded and preset-shaped", () => {
    const { points, pressures } = serpentineStroke(80);
    const splatter = resolvePresetStyle("mypaint-cc0--splatter");
    const plan = planStudioStampBrushDabs(splatter, points, pressures);
    expect(plan.length).toBeGreaterThan(1);
    // dynamics 를 벗긴 쌍둥이 스타일과 비교 — 산란·반경 지터가 실제로 배치를 바꿔야 한다.
    const { mypaintCc0Dynamics: _stripped, ...bare } = splatter;
    const bareStyle = bare as StudioStampBrushStyle;
    const barePlan = planStudioStampBrushDabs(bareStyle, points, pressures);
    expect(barePlan.length).toBe(plan.length);
    const moved = plan.filter((dab, index) => {
      const reference = barePlan[index]!;
      return dab.x !== reference.x || dab.y !== reference.y;
    });
    expect(moved.length, "scatter must displace dabs").toBeGreaterThan(0);
    const resized = plan.filter((dab, index) => dab.radius !== barePlan[index]!.radius);
    expect(resized.length, "radius jitter must vary dab radii").toBeGreaterThan(0);
    // 같은 인덱스 시드 → 재계획해도 동일 배치(결정성).
    expect(planStudioStampBrushDabs(splatter, points, pressures)).toEqual(plan);
    // 카부라(산란·지터 0)는 경로 위에 정확히 남는다.
    const kabura = resolvePresetStyle("mypaint-cc0--kabura");
    const kaburaPlan = planStudioStampBrushDabs(kabura, [0, 0, 90, 0], [0.5, 0.5]);
    expect(kaburaPlan.length).toBeGreaterThan(1);
    for (const dab of kaburaPlan) {
      expect(dab.y).toBe(0);
    }
  });

  it("every preset produces a distinct texture layout (pairwise coverage distance floor)", () => {
    const { points, pressures } = serpentineStroke(160);
    const maps = STUDIO_CC0_MYPAINT_PRESET_IMPORTS.map((entry) => {
      const style = resolvePresetStyle(entry.brushId);
      return {
        id: entry.brushId,
        map: coverageMap(style, planStudioStampBrushDabs(style, points, pressures)),
      };
    });
    let minimum = Number.POSITIVE_INFINITY;
    let minimumPair = "";
    for (let a = 0; a < maps.length; a += 1) {
      for (let b = a + 1; b < maps.length; b += 1) {
        const distance = pairCoverageDistance(maps[a]!.map, maps[b]!.map);
        if (distance < minimum) {
          minimum = distance;
          minimumPair = `${maps[a]!.id} vs ${maps[b]!.id}`;
        }
      }
    }
    // 66쌍 최소 거리(2026-08-13 기준 ≈0.095, watercolor-expressive vs spray) 아래 ~50% 마진 바닥.
    expect(
      minimum,
      `closest preset pair ${minimumPair} (distance ${minimum.toFixed(5)}) must stay distinct`,
    ).toBeGreaterThan(0.05);
  });

  it("plans a 2000-sample stroke within the per-preset time budget", () => {
    const { points, pressures } = serpentineStroke(2000);
    for (const entry of STUDIO_CC0_MYPAINT_PRESET_IMPORTS) {
      const style = resolvePresetStyle(entry.brushId);
      // 워밍업 1회(JIT) 후 측정 — 결정성 계약과 무관한 테스트 전용 시간 측정이다.
      planStudioStampBrushDabs(style, points, pressures);
      const startedAt = performance.now();
      const plan = planStudioStampBrushDabs(style, points, pressures);
      const elapsed = performance.now() - startedAt;
      expect(plan.length).toBeGreaterThan(0);
      expect(
        elapsed,
        `${entry.brushId}: 2000-sample plan took ${elapsed.toFixed(1)}ms`,
      ).toBeLessThan(150);
    }
  });
});
