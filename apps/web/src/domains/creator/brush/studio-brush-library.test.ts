import { describe, it, expect } from "vitest";

import {
  DEFAULT_STUDIO_BRUSH_DYNAMICS_SETTINGS,
  normalizeStudioBrushDynamicsSettings,
  studioBrushDynamicsPresetSettings,
} from "./studio-brush-dynamics";
import {
  BRUSH_EXPORT_KIND,
  BRUSH_LIBRARY_CAPACITY,
  BRUSH_LIBRARY_KEY,
  BRUSH_LIBRARY_STORAGE_VERSION,
  BRUSH_OPACITY_RANGE,
  BRUSH_SOURCE_PRESET_ID_MAX_LENGTH,
  BRUSH_SOURCE_PRESET_NAME_MAX_LENGTH,
  BRUSH_EXPORT_VERSION,
  BRUSH_STAMP_TUNING_RANGE,
  BRUSH_STROKE_WIDTH_RANGE,
  brushFileName,
  brushMatchesSnapshot,
  createBrush,
  deleteBrush,
  deleteBrushWithRecord,
  duplicateBrush,
  duplicateBrushName,
  importBrushFromJson,
  listBrushes,
  markBrushUsed,
  markBrushUsedWithResult,
  MAX_BRUSHES,
  readBrushLibrary,
  renameBrush,
  restoreDeletedBrush,
  sanitizeBrushSnapshot,
  saveBrush,
  saveBrushBatchWithResult,
  saveBrushWithResult,
  selectQuickBrushes,
  sortBrushesForLibrary,
  toggleBrushPinned,
  updateBrushSnapshotWithResult,
  writeBrushJson,
  type StudioBrushSnapshot,
  type StudioSavedBrush,
} from "./studio-brush-library";
import { STUDIO_BRUSH_PACK_EXPANSION_WAVE_IDS } from "./studio-brush-pack-expansion";
import { materializeAllStudioBrushPackSelections } from "./studio-brush-pack-runtime";

// 인메모리 가짜 저장소 (studio-palette-library.test.ts와 동일 패턴)
function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => map.set(k, v),
    _map: map,
  };
}

const validSnapshot: StudioBrushSnapshot = {
  brushId: "gpen",
  strokeWidth: 12,
  brushOpacity: 0.8,
  color: "#ff0000",
  stabilizer: 4,
  stabilizerMode: "precision",
  postCorrection: 7,
  preserveCorners: true,
  pressureCurve: 1.8,
      pressureMinSize: 0,
  useVelocityPressure: true,
  velocitySensitivity: 0.5,
  tiltEnabled: true,
  tipAngle: -35,
  tipRoundness: 0.3,
  stampTuning: null,
  enginePrograms: null,
  brushDynamics: normalizeStudioBrushDynamicsSettings({
    ...studioBrushDynamicsPresetSettings("dry-media"),
    seed: 492,
  }),
};

const brush = (id: string, createdAt = 1): StudioSavedBrush => ({
  id,
  name: `브러시 ${id}`,
  createdAt,
  updatedAt: createdAt,
  pinned: false,
  lastUsedAt: null,
  ...validSnapshot,
});

describe("sanitizeBrushSnapshot", () => {

  it("defaults pressureMinSize to 0 and clamps out-of-range floors", () => {
    const missing = sanitizeBrushSnapshot({ brushId: "pen", strokeWidth: 6, brushOpacity: 1, color: "#000000" });
    expect(missing.snapshot.pressureMinSize).toBe(0);
    const high = sanitizeBrushSnapshot({ ...missing.snapshot, pressureMinSize: 3 });
    expect(high.snapshot.pressureMinSize).toBe(1);
    const low = sanitizeBrushSnapshot({ ...missing.snapshot, pressureMinSize: -1 });
    expect(low.snapshot.pressureMinSize).toBe(0);
  });
  it("유효한 스냅샷은 그대로 통과시키고 adjustedFields는 비어있다", () => {
    const { snapshot, adjustedFields } = sanitizeBrushSnapshot(validSnapshot);
    expect(snapshot).toEqual(validSnapshot);
    expect(adjustedFields).toEqual([]);
  });

  it("2차 색상·고정 그레인·멀티 팁 계약을 JSON 저장 왕복 후 보존한다", () => {
    const brushDynamics = normalizeStudioBrushDynamicsSettings({
      ...studioBrushDynamicsPresetSettings("dry-media"),
      colorDynamics: {
        backgroundColor: "#f4c95d",
        foregroundBackgroundMix: 0.18,
        hueJitter: 14,
        saturationJitter: 0.1,
        valueJitter: 0.08,
      },
      grain: { space: "stroke-fixed", amount: 0.42, scale: 6, contrast: 0.7, seed: 73 },
      tipLayers: [
        { tip: { shape: "bristle" }, scale: 0.72, opacity: 0.6, offsetY: -0.4 },
        { tip: { shape: "grain" }, scale: 0.45, opacity: 0.4, offsetY: 0.5 },
      ],
    });
    const input = JSON.parse(JSON.stringify({ ...validSnapshot, brushDynamics }));
    const result = sanitizeBrushSnapshot(input);

    expect(result.adjustedFields).toEqual([]);
    expect(result.snapshot.brushDynamics).toEqual(brushDynamics);
    expect(result.snapshot.brushDynamics.colorDynamics.backgroundColor).toBe("#f4c95d");
    expect(result.snapshot.brushDynamics.grain.space).toBe("stroke-fixed");
    expect(result.snapshot.brushDynamics.tipLayers).toHaveLength(2);
  });

  it("출처 프리셋 메타데이터를 trim하고 코드포인트 기준 상한으로 제한한다", () => {
    const { snapshot, adjustedFields } = sanitizeBrushSnapshot({
      ...validSnapshot,
      sourcePresetId: `  ${"a".repeat(BRUSH_SOURCE_PRESET_ID_MAX_LENGTH + 8)}  `,
      sourcePresetName: `  ${"붓".repeat(BRUSH_SOURCE_PRESET_NAME_MAX_LENGTH + 8)}  `,
    });

    expect(snapshot.sourcePresetId).toHaveLength(BRUSH_SOURCE_PRESET_ID_MAX_LENGTH);
    expect(Array.from(snapshot.sourcePresetName ?? "")).toHaveLength(
      BRUSH_SOURCE_PRESET_NAME_MAX_LENGTH
    );
    expect(adjustedFields).toEqual(["sourcePresetId", "sourcePresetName"]);
  });

  it("누락된 v1 출처 메타데이터는 undefined 키를 새로 만들지 않는다", () => {
    const { snapshot, adjustedFields } = sanitizeBrushSnapshot(validSnapshot);
    expect(snapshot).not.toHaveProperty("sourcePresetId");
    expect(snapshot).not.toHaveProperty("sourcePresetName");
    expect(adjustedFields).toEqual([]);
  });

  it("객체가 아니면 전부 기본값으로 채우고 각 필드를 adjustedFields에 기록한다", () => {
    const { snapshot, adjustedFields } = sanitizeBrushSnapshot(null);
    expect(snapshot.brushId).toBe("pen");
    expect(snapshot.color).toBe("#7c5cfc");
    // 2026-08-14: 기본 선 보정이 속도 적응 3으로 바뀌었다(느린 장선 손떨림 통과율 100%→48%).
    expect(snapshot.stabilizer).toBe(3);
    expect(snapshot.postCorrection).toBe(0);
    // 2026-08-16: 기본값 true. 스타일러스는 hardware-precedence 로 자기 필압을 그대로 쓰므로
    // 영향이 없고, 마우스·트랙패드·힘 감지 없는 터치만 속도→필압을 받는다. 그전에는 이 입력들이
    // 획 전체를 죽은 상수 굵기·농도로 그렸다.
    expect(snapshot.useVelocityPressure).toBe(true);
    expect(adjustedFields).toContain("brushId");
    expect(adjustedFields).toContain("color");
    expect(adjustedFields).toContain("useVelocityPressure");
    expect(adjustedFields).toContain("stabilizerMode");
    expect(adjustedFields).toContain("postCorrection");
    expect(adjustedFields).toContain("preserveCorners");
    expect(adjustedFields).toContain("tiltEnabled");
    expect(adjustedFields).toContain("tipAngle");
    expect(adjustedFields).toContain("tipRoundness");
    expect(adjustedFields).toContain("brushDynamics");
    expect(adjustedFields).not.toContain("stampTuning");
  });

  it("알 수 없는 brushId는 pen으로 대체한다", () => {
    const { snapshot, adjustedFields } = sanitizeBrushSnapshot({ ...validSnapshot, brushId: "not-a-real-brush" });
    expect(snapshot.brushId).toBe("pen");
    expect(adjustedFields).toEqual(["brushId"]);
  });

  it(`strokeWidth를 [${BRUSH_STROKE_WIDTH_RANGE[0]}, ${BRUSH_STROKE_WIDTH_RANGE[1]}] 범위로 clamp한다`, () => {
    const tooBig = sanitizeBrushSnapshot({ ...validSnapshot, strokeWidth: 999 });
    expect(tooBig.snapshot.strokeWidth).toBe(BRUSH_STROKE_WIDTH_RANGE[1]);
    expect(tooBig.adjustedFields).toEqual(["strokeWidth"]);

    const tooSmall = sanitizeBrushSnapshot({ ...validSnapshot, strokeWidth: -5 });
    expect(tooSmall.snapshot.strokeWidth).toBe(BRUSH_STROKE_WIDTH_RANGE[0]);
  });

  it(`brushOpacity를 [${BRUSH_OPACITY_RANGE[0]}, ${BRUSH_OPACITY_RANGE[1]}] 범위로 clamp한다`, () => {
    const { snapshot, adjustedFields } = sanitizeBrushSnapshot({ ...validSnapshot, brushOpacity: 5 });
    expect(snapshot.brushOpacity).toBe(BRUSH_OPACITY_RANGE[1]);
    expect(adjustedFields).toEqual(["brushOpacity"]);

    const faint = sanitizeBrushSnapshot({ ...validSnapshot, brushOpacity: 0.01 });
    expect(faint.snapshot.brushOpacity).toBe(0.05);
    expect(faint.adjustedFields).toEqual(["brushOpacity"]);
  });

  it("NaN/Infinity/문자열 숫자 필드는 기본값으로 대체한다", () => {
    const { snapshot, adjustedFields } = sanitizeBrushSnapshot({
      ...validSnapshot,
      strokeWidth: Number.NaN,
      stabilizer: Number.POSITIVE_INFINITY,
      pressureCurve: "1.0" as unknown as number,
      pressureMinSize: 0,
    });
    expect(snapshot.strokeWidth).toBe(6);
    expect(snapshot.stabilizer).toBe(3);
    expect(snapshot.pressureCurve).toBe(1.0);
    expect(adjustedFields).toEqual(["strokeWidth", "stabilizer", "pressureCurve"]);
  });

  it("유효하지 않은 색은 기본 색으로 대체한다", () => {
    const { snapshot, adjustedFields } = sanitizeBrushSnapshot({ ...validSnapshot, color: "not-a-color" });
    expect(snapshot.color).toBe("#7c5cfc");
    expect(adjustedFields).toEqual(["color"]);
  });

  it("3자리 축약 헥스 색을 정규화한다", () => {
    const { snapshot, adjustedFields } = sanitizeBrushSnapshot({ ...validSnapshot, color: "#f00" });
    expect(snapshot.color).toBe("#ff0000");
    expect(adjustedFields).toEqual([]);
  });

  it("useVelocityPressure가 boolean이 아니면 포인터 일치 기본값(true)으로 대체한다", () => {
    const { snapshot, adjustedFields } = sanitizeBrushSnapshot({ ...validSnapshot, useVelocityPressure: "yes" });
    expect(snapshot.useVelocityPressure).toBe(true);
    expect(adjustedFields).toEqual(["useVelocityPressure"]);
  });

  it("선 보정 모드·후보정·각점 보존을 정규화한다", () => {
    const { snapshot, adjustedFields } = sanitizeBrushSnapshot({
      ...validSnapshot,
      stabilizerMode: "unknown",
      postCorrection: 999,
      preserveCorners: "yes",
    });
    expect(snapshot.stabilizerMode).toBe("adaptive");
    expect(snapshot.postCorrection).toBe(10);
    expect(snapshot.preserveCorners).toBe(true);
    expect(adjustedFields).toEqual(["postCorrection", "stabilizerMode", "preserveCorners"]);
  });

  it("펜촉 틸트 설정을 타입과 안전 범위로 정규화한다", () => {
    const { snapshot, adjustedFields } = sanitizeBrushSnapshot({
      ...validSnapshot,
      tiltEnabled: "yes",
      tipAngle: 999,
      tipRoundness: 0,
    });
    expect(snapshot.tiltEnabled).toBe(true);
    expect(snapshot.tipAngle).toBe(180);
    expect(snapshot.tipRoundness).toBe(0.08);
    expect(adjustedFields).toEqual(["tipAngle", "tipRoundness", "tiltEnabled"]);
  });

  it("브러시 동역학을 렌더러 안전 범위와 완전한 JSON 구조로 정규화한다", () => {
    const { snapshot, adjustedFields } = sanitizeBrushSnapshot({
      ...validSnapshot,
      brushDynamics: {
        seed: -3,
        maxSpeed: Number.POSITIVE_INFINITY,
        spacingRatio: 999,
        taper: { enabled: true, startLength: 2, minSizeRatio: -4 },
        tip: { shape: "grain", softness: 4, alphaMapSize: 1 },
        width: {
          base: -100,
          mappings: [{ source: "pressure", amount: 9 }],
        },
      },
    });

    expect(snapshot.brushDynamics).toEqual(normalizeStudioBrushDynamicsSettings({
      seed: -3,
      maxSpeed: Number.POSITIVE_INFINITY,
      spacingRatio: 999,
      taper: { enabled: true, startLength: 2, minSizeRatio: -4 },
      tip: { shape: "grain", softness: 4, alphaMapSize: 1 },
      width: {
        base: -100,
        mappings: [{ source: "pressure", amount: 9 }],
      },
    }));
    expect(snapshot.brushDynamics.seed).toBe(0);
    expect(snapshot.brushDynamics.spacingRatio).toBe(16);
    expect(snapshot.brushDynamics.width.base).toBe(0.05);
    expect(snapshot.brushDynamics.width.mappings[0]?.amount).toBe(1);
    expect(snapshot.brushDynamics.taper.startLength).toBe(0.5);
    expect(snapshot.brushDynamics.taper.minSizeRatio).toBe(0);
    expect(snapshot.brushDynamics.tip).toMatchObject({ shape: "grain", softness: 1, alphaMapSize: 8 });
    expect(adjustedFields).toEqual(["brushDynamics"]);
    expect(() => JSON.stringify(snapshot.brushDynamics)).not.toThrow();
  });

  it("스탬프 브러시 튜닝을 0~1 범위로 정규화한다", () => {
    const { snapshot, adjustedFields } = sanitizeBrushSnapshot({
      ...validSnapshot,
      brushId: "airbrush-fine",
      stampTuning: { flow: -1, hardness: 0.42, minSize: 99 },
    });
    expect(snapshot.stampTuning).toEqual({
      flow: BRUSH_STAMP_TUNING_RANGE[0],
      hardness: 0.42,
      minSize: BRUSH_STAMP_TUNING_RANGE[1],
    });
    expect(adjustedFields).toEqual(["stampTuning"]);
  });

  it("스탬프 브러시의 누락·비수치 튜닝은 종류별 기본값으로 마이그레이션한다", () => {
    const missing = sanitizeBrushSnapshot({
      ...validSnapshot,
      brushId: "wash-brush",
      stampTuning: undefined,
    });
    expect(missing.snapshot.stampTuning).toEqual({ flow: 0.26, hardness: 0.28, minSize: 0.55 });
    expect(missing.adjustedFields).toEqual(["stampTuning"]);

    const partial = sanitizeBrushSnapshot({
      ...validSnapshot,
      brushId: "pencil-grain",
      stampTuning: { flow: 0.5, hardness: Number.NaN, minSize: "0.2" },
    });
    expect(partial.snapshot.stampTuning).toEqual({ flow: 0.5, hardness: 0.85, minSize: 0.35 });
    expect(partial.adjustedFields).toEqual(["stampTuning"]);
  });

  it("비스탬프 브러시의 오래된 튜닝 찌꺼기는 null로 제거한다", () => {
    const { snapshot, adjustedFields } = sanitizeBrushSnapshot({
      ...validSnapshot,
      stampTuning: { flow: 0.4, hardness: 0.5, minSize: 0.6 },
    });
    expect(snapshot.stampTuning).toBeNull();
    expect(adjustedFields).toEqual(["stampTuning"]);
  });

  it("테이퍼·PNG 팁 설정이 라이브러리 JSON 왕복 후에도 동일하다", () => {
    const dynamics = normalizeStudioBrushDynamicsSettings({
      ...studioBrushDynamicsPresetSettings("dry-media"),
      seed: 777,
      taper: {
        enabled: true,
        startLength: 0.11,
        endLength: 0.19,
        minSizeRatio: 0.22,
        minOpacityRatio: 0.4,
        curve: 1.2,
      },
      tip: { shape: "flake", softness: 0.28 },
    });
    const { snapshot } = sanitizeBrushSnapshot({
      ...validSnapshot,
      brushDynamics: JSON.parse(JSON.stringify(dynamics)),
    });
    expect(snapshot.brushDynamics).toEqual(dynamics);
    expect(snapshot.brushDynamics.taper.enabled).toBe(true);
    expect(snapshot.brushDynamics.tip.shape).toBe("flake");
  });

  it("키 순서가 달라도 이미 정규화된 동역학은 보정된 것으로 표시하지 않는다", () => {
    const reordered = {
      presetId: validSnapshot.brushDynamics.presetId,
      tipLayers: validSnapshot.brushDynamics.tipLayers,
      grain: validSnapshot.brushDynamics.grain,
      colorDynamics: validSnapshot.brushDynamics.colorDynamics,
      tip: validSnapshot.brushDynamics.tip,
      taper: validSnapshot.brushDynamics.taper,
      roundness: validSnapshot.brushDynamics.roundness,
      angle: validSnapshot.brushDynamics.angle,
      scatter: validSnapshot.brushDynamics.scatter,
      spacing: validSnapshot.brushDynamics.spacing,
      flow: validSnapshot.brushDynamics.flow,
      opacity: validSnapshot.brushDynamics.opacity,
      width: validSnapshot.brushDynamics.width,
      scatterRatio: validSnapshot.brushDynamics.scatterRatio,
      spacingRatio: validSnapshot.brushDynamics.spacingRatio,
      maxSpeed: validSnapshot.brushDynamics.maxSpeed,
      fallbackPressure: validSnapshot.brushDynamics.fallbackPressure,
      seed: validSnapshot.brushDynamics.seed,
      depositPipeline: validSnapshot.brushDynamics.depositPipeline,
      version: validSnapshot.brushDynamics.version,
    };
    const { snapshot, adjustedFields } = sanitizeBrushSnapshot({ ...validSnapshot, brushDynamics: reordered });
    expect(snapshot.brushDynamics).toEqual(validSnapshot.brushDynamics);
    expect(adjustedFields).toEqual([]);
  });

  it("2차 재질 키가 없는 기존 v1 브러시는 보정 경고 없이 identity 기본값으로 승격한다", () => {
    const legacyDynamics = Object.fromEntries(
      Object.entries(validSnapshot.brushDynamics).filter(([key]) => (
        key !== "colorDynamics" && key !== "grain" && key !== "tipLayers"
      ))
    );
    const { snapshot, adjustedFields } = sanitizeBrushSnapshot({
      ...validSnapshot,
      brushDynamics: JSON.parse(JSON.stringify(legacyDynamics)),
    });

    expect(adjustedFields).toEqual([]);
    expect(snapshot.brushDynamics.colorDynamics).toEqual(validSnapshot.brushDynamics.colorDynamics);
    expect(snapshot.brushDynamics.grain).toEqual({
      space: "canvas-fixed",
      amount: 0,
      scale: 8,
      contrast: 0.35,
      seed: 1,
    });
    expect(snapshot.brushDynamics.tipLayers).toEqual([]);
  });

  it("무관한 필드에 순환 참조가 있어도 던지거나 멈추지 않는다(필드별 단순 읽기만 하므로 재귀 순회 없음)", () => {
    const circular: Record<string, unknown> = { ...validSnapshot };
    circular.selfRef = circular;
    expect(() => sanitizeBrushSnapshot(circular)).not.toThrow();
    const { snapshot, adjustedFields } = sanitizeBrushSnapshot(circular);
    expect(snapshot).toEqual(validSnapshot);
    expect(adjustedFields).toEqual([]);
  });
});

describe("createBrush", () => {
  it("이름과 스냅샷으로 저장 레코드를 만든다", () => {
    const b = createBrush("내 펜", validSnapshot);
    expect(b.name).toBe("내 펜");
    expect(b.brushId).toBe("gpen");
    expect(b.strokeWidth).toBe(12);
    expect(typeof b.id).toBe("string");
    expect(b.createdAt).toBe(b.updatedAt);
    expect(b.pinned).toBe(false);
    expect(b.lastUsedAt).toBe(b.createdAt);
  });

  it("빈 이름은 DEFAULT_BRUSH_NAME으로 대체한다", () => {
    const b = createBrush("   ", validSnapshot);
    expect(b.name).toBe("이름 없는 브러시");
  });

  it("범위를 벗어난 스냅샷도 clamp해 절대 던지지 않는다", () => {
    const b = createBrush("망가진 값", { ...validSnapshot, strokeWidth: -100, brushOpacity: 100 });
    expect(b.strokeWidth).toBe(BRUSH_STROKE_WIDTH_RANGE[0]);
    expect(b.brushOpacity).toBe(BRUSH_OPACITY_RANGE[1]);
  });
});

describe("listBrushes", () => {
  it("저장소 없으면 빈 배열", () => {
    expect(listBrushes(null)).toEqual([]);
    expect(listBrushes(undefined)).toEqual([]);
  });

  it("빈/깨진 JSON은 빈 배열", () => {
    expect(listBrushes(fakeStorage())).toEqual([]);
    expect(listBrushes(fakeStorage({ [BRUSH_LIBRARY_KEY]: "{not json" }))).toEqual([]);
    expect(listBrushes(fakeStorage({ [BRUSH_LIBRARY_KEY]: '{"a":1}' }))).toEqual([]); // 배열 아님
  });

  it("형식이 맞는 브러시만 통과시킨다", () => {
    const s = fakeStorage({
      [BRUSH_LIBRARY_KEY]: JSON.stringify([brush("a"), { id: "x" }, brush("b")]),
    });
    expect(listBrushes(s).map((b) => b.id)).toEqual(["a", "b"]);
  });

  it("이전 저장 브러시에 펜촉 필드가 없어도 안전 기본값으로 마이그레이션한다", () => {
    const legacy = brush("legacy") as Partial<StudioSavedBrush>;
    delete legacy.tiltEnabled;
    delete legacy.tipAngle;
    delete legacy.tipRoundness;
    const s = fakeStorage({ [BRUSH_LIBRARY_KEY]: JSON.stringify([legacy]) });
    expect(listBrushes(s)[0]).toMatchObject({
      id: "legacy",
      tiltEnabled: true,
      tipAngle: -30,
      tipRoundness: 0.24,
    });
  });

  it("이전 저장 브러시에 동역학 필드가 없어도 기본 동역학으로 마이그레이션한다", () => {
    const legacy = brush("legacy-dynamics") as Partial<StudioSavedBrush>;
    delete legacy.brushDynamics;
    const s = fakeStorage({ [BRUSH_LIBRARY_KEY]: JSON.stringify([legacy]) });
    expect(listBrushes(s)[0]?.brushDynamics).toEqual(DEFAULT_STUDIO_BRUSH_DYNAMICS_SETTINGS);
  });

  it("이전 저장 스탬프 브러시에 튜닝 필드가 없어도 종류별 기본값으로 마이그레이션한다", () => {
    const legacy = { ...brush("legacy-stamp"), brushId: "ink-brush" } as Partial<StudioSavedBrush>;
    delete legacy.stampTuning;
    const s = fakeStorage({ [BRUSH_LIBRARY_KEY]: JSON.stringify([legacy]) });
    expect(listBrushes(s)[0]?.stampTuning).toEqual({ flow: 1, hardness: 1, minSize: 0.08 });
  });

  it("v2 저장 브러시에 새 선 보정 필드가 없어도 안전 기본값으로 마이그레이션한다", () => {
    const legacy = brush("legacy-v2") as Partial<StudioSavedBrush>;
    delete legacy.stabilizerMode;
    delete legacy.postCorrection;
    delete legacy.preserveCorners;
    const s = fakeStorage({ [BRUSH_LIBRARY_KEY]: JSON.stringify([legacy]) });
    expect(listBrushes(s)[0]).toMatchObject({
      id: "legacy-v2",
      stabilizerMode: "adaptive",
      postCorrection: 0,
      preserveCorners: true,
    });
  });

  it("v1~v3 저장 브러시에 선반 메타데이터가 없어도 고정 해제·미사용으로 마이그레이션한다", () => {
    const legacy = brush("legacy-meta") as Partial<StudioSavedBrush>;
    delete legacy.pinned;
    delete legacy.lastUsedAt;
    const s = fakeStorage({ [BRUSH_LIBRARY_KEY]: JSON.stringify([legacy]) });
    expect(listBrushes(s)[0]).toMatchObject({ pinned: false, lastUsedAt: null });
  });

  it("v1 저장 브러시에는 출처 키를 추가하지 않고 새 출처 메타데이터는 보존한다", () => {
    const legacy = brush("legacy-source") as Partial<StudioSavedBrush>;
    delete legacy.sourcePresetId;
    delete legacy.sourcePresetName;
    const sourced = {
      ...brush("sourced"),
      sourcePresetId: "essentials:rough-pencil",
      sourcePresetName: "거친 연필",
    };
    const s = fakeStorage({
      [BRUSH_LIBRARY_KEY]: JSON.stringify([legacy, sourced]),
    });

    expect(listBrushes(s)[0]).not.toHaveProperty("sourcePresetId");
    expect(listBrushes(s)[1]).toMatchObject({
      sourcePresetId: "essentials:rough-pencil",
      sourcePresetName: "거친 연필",
    });
  });

  it("유효하지 않은 선반 메타데이터는 안전한 기본값으로 정규화한다", () => {
    const raw = { ...brush("bad-meta"), pinned: "yes", lastUsedAt: Number.POSITIVE_INFINITY };
    const s = fakeStorage({ [BRUSH_LIBRARY_KEY]: JSON.stringify([raw]) });
    expect(listBrushes(s)[0]).toMatchObject({ pinned: false, lastUsedAt: null });
  });
});

describe("readBrushLibrary", () => {
  it("버전 envelope와 레거시 배열 저장 형식을 모두 읽는다", () => {
    const envelope = fakeStorage({
      [BRUSH_LIBRARY_KEY]: JSON.stringify({
        version: BRUSH_LIBRARY_STORAGE_VERSION,
        brushes: [brush("envelope")],
      }),
    });
    const legacy = fakeStorage({
      [BRUSH_LIBRARY_KEY]: JSON.stringify([brush("legacy")]),
    });

    expect(readBrushLibrary(envelope)).toMatchObject({
      status: "ok",
      brushes: [{ id: "envelope" }],
    });
    expect(readBrushLibrary(legacy)).toMatchObject({
      status: "ok",
      brushes: [{ id: "legacy" }],
    });
  });

  it.each([
    {
      name: "깨진 JSON",
      raw: "{not json",
      expectedReadStatus: "corrupt",
      expectedBrushIds: [],
    },
    {
      name: "brushes가 배열이 아닌 envelope",
      raw: JSON.stringify({ version: BRUSH_LIBRARY_STORAGE_VERSION, brushes: { id: "not-an-array" } }),
      expectedReadStatus: "corrupt",
      expectedBrushIds: [],
    },
    {
      name: "미지원 미래 버전",
      raw: JSON.stringify({ version: BRUSH_LIBRARY_STORAGE_VERSION + 1, brushes: [] }),
      expectedReadStatus: "unsupported-version",
      expectedBrushIds: [],
    },
    {
      name: "일부 레코드가 손상된 배열",
      raw: JSON.stringify([brush("valid"), { id: "invalid" }]),
      expectedReadStatus: "corrupt",
      expectedBrushIds: ["valid"],
    },
  ])("$name을 읽은 mutation은 기존 데이터를 덮어쓰지 않는다", ({ raw, expectedReadStatus, expectedBrushIds }) => {
    let setItemCalls = 0;
    const storage = {
      getItem: () => raw,
      setItem: () => {
        setItemCalls += 1;
      },
    };

    const read = readBrushLibrary(storage);
    expect(read.status).toBe(expectedReadStatus);
    expect(read.brushes.map((item) => item.id)).toEqual(expectedBrushIds);

    const result = saveBrushWithResult(storage, brush("new"));
    expect(result.status).toBe("library-unreadable");
    expect(result.brushes.map((item) => item.id)).toEqual(expectedBrushIds);
    expect(setItemCalls).toBe(0);
  });

  it("getItem이 던지면 mutation은 setItem을 호출하지 않고 library-unreadable을 반환한다", () => {
    let setItemCalls = 0;
    const storage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        setItemCalls += 1;
      },
    };

    expect(readBrushLibrary(storage)).toEqual({ brushes: [], status: "read-error" });
    expect(saveBrushWithResult(storage, brush("new"))).toEqual({
      brushes: [],
      status: "library-unreadable",
    });
    expect(setItemCalls).toBe(0);
  });
});

describe("saveBrush", () => {
  it("맨 앞에 추가한다", () => {
    const s = fakeStorage();
    saveBrush(s, brush("a"));
    const next = saveBrush(s, brush("b"));
    expect(next.map((b) => b.id)).toEqual(["b", "a"]);
  });

  it("같은 id는 교체하며 맨 앞으로", () => {
    const s = fakeStorage();
    saveBrush(s, brush("a", 1));
    saveBrush(s, brush("b", 1));
    const next = saveBrush(s, brush("a", 2));
    expect(next.map((b) => b.id)).toEqual(["a", "b"]);
    expect(next[0].createdAt).toBe(2);
  });

  it("4,096개를 넘는 라이브러리도 자동 삭제나 개수 거부 없이 저장한다", () => {
    const s = fakeStorage();
    const imported = Array.from({ length: 4_096 }, (_, index) => brush(`b${index}`, index));
    const batch = saveBrushBatchWithResult(s, imported);
    const next = saveBrushWithResult(s, brush("b4096", 4_096));

    expect(BRUSH_LIBRARY_CAPACITY).toBe("unbounded");
    expect(MAX_BRUSHES).toBe(Number.POSITIVE_INFINITY);
    expect(batch).toMatchObject({ status: "saved", savedCount: 4_096, skippedCount: 0 });
    expect(next.status).toBe("saved");
    expect(next.brushes).toHaveLength(4_097);
    expect(next.brushes[0]?.id).toBe("b4096");
    expect(next.brushes[1]?.id).toBe("b0");
    expect(next.brushes.at(-1)?.id).toBe("b4095");
    expect(listBrushes(s)).toHaveLength(4_097);
  });

  it("수천 개가 저장돼도 같은 id 갱신은 한 항목으로 결정적으로 교체한다", () => {
    const s = fakeStorage();
    saveBrushBatchWithResult(
      s,
      Array.from({ length: 3_000 }, (_, index) => brush(`b${index}`, index))
    );
    const updated = { ...brush("b0", 999), name: "갱신됨" };
    const result = saveBrushWithResult(s, updated);
    expect(result.status).toBe("saved");
    expect(result.brushes).toHaveLength(3_000);
    expect(result.brushes[0]).toMatchObject({ id: "b0", name: "갱신됨" });
    expect(result.brushes.filter((candidate) => candidate.id === "b0")).toHaveLength(1);
  });

  it("저장소 쓰기가 실패하면 성공으로 가장하지 않고 원본 목록을 유지한다", () => {
    const s = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    };
    const result = saveBrushWithResult(s, brush("a"));
    expect(result).toEqual({ brushes: [], status: "storage-error" });
  });

  it("저장소에 영속된다", () => {
    const s = fakeStorage();
    saveBrush(s, brush("a"));
    expect(listBrushes(s).map((b) => b.id)).toEqual(["a"]);
  });

  it("스탬프 튜닝을 저장소 쓰기·다시 읽기에서 손실 없이 유지한다", () => {
    const s = fakeStorage();
    const stampBrush: StudioSavedBrush = {
      ...brush("stamp"),
      brushId: "pencil-grain",
      stampTuning: { flow: 0.41, hardness: 0.73, minSize: 0.26 },
    };
    saveBrush(s, stampBrush);
    expect(listBrushes(s)[0]?.stampTuning).toEqual(stampBrush.stampTuning);
  });

  it("직접 저장 경로도 런타임 계약이 없는 사용자 브러시를 안전한 펜으로 정규화한다", () => {
    const s = fakeStorage();
    const result = saveBrushWithResult(s, {
      ...brush("unsupported-runtime"),
      brushId: "marketplace-engine-not-installed",
    });

    expect(result.status).toBe("saved");
    expect(result.brushes[0]?.brushId).toBe("pen");
    expect(listBrushes(s)[0]?.brushId).toBe("pen");
  });
});

describe("updateBrushSnapshotWithResult", () => {
  it("id·이름·고정·생성 시각은 보존하고 그리기 설정만 갱신한다", () => {
    const s = fakeStorage();
    const original = { ...brush("a", 1), name: "내 G펜", pinned: true };
    saveBrush(s, original);
    const changed: StudioBrushSnapshot = { ...validSnapshot, strokeWidth: 30, color: "#00ff00" };

    const result = updateBrushSnapshotWithResult(s, "a", changed);

    expect(result.status).toBe("updated");
    expect(result.brushes).toHaveLength(1);
    expect(result.brushes[0]).toMatchObject({
      id: "a",
      name: "내 G펜",
      pinned: true,
      createdAt: 1,
      strokeWidth: 30,
      color: "#00ff00",
    });
    expect(result.brushes[0].updatedAt).toBeGreaterThanOrEqual(1);
  });

  it("모르는 id는 missing을 반환하고 목록을 바꾸지 않는다", () => {
    const s = fakeStorage();
    saveBrush(s, brush("a"));
    const result = updateBrushSnapshotWithResult(s, "not-real", validSnapshot);
    expect(result.status).toBe("missing");
    expect(result.brushes.map((b) => b.id)).toEqual(["a"]);
  });

  it("범위를 벗어난 스냅샷 값도 clamp해 절대 던지지 않는다", () => {
    const s = fakeStorage();
    saveBrush(s, brush("a"));
    const result = updateBrushSnapshotWithResult(s, "a", {
      ...validSnapshot,
      strokeWidth: 9_999,
    } as StudioBrushSnapshot);
    expect(result.status).toBe("updated");
    expect(result.brushes[0].strokeWidth).toBeLessThanOrEqual(BRUSH_STROKE_WIDTH_RANGE[1]);
  });

  it("저장소 쓰기가 실패하면 원본 목록을 유지한다", () => {
    const s = fakeStorage();
    saveBrush(s, brush("a"));
    const failing = {
      getItem: s.getItem,
      setItem: () => {
        throw new Error("quota");
      },
    };
    const result = updateBrushSnapshotWithResult(failing, "a", validSnapshot);
    expect(result.status).toBe("storage-error");
  });
});

describe("renameBrush", () => {
  it("배열 순서를 유지하며 updatedAt을 갱신한다", () => {
    const s = fakeStorage();
    saveBrush(s, brush("a", 1));
    saveBrush(s, brush("b", 2));
    const before = listBrushes(s).find((b) => b.id === "b")!.updatedAt;
    const next = renameBrush(s, "b", "새 이름");
    expect(next.map((b) => b.id)).toEqual(["b", "a"]); // 순서 유지(맨 앞으로 옮기지 않음)
    const renamed = next.find((b) => b.id === "b")!;
    expect(renamed.name).toBe("새 이름");
    expect(renamed.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it("빈 이름은 무시한다(원본 목록 그대로)", () => {
    const s = fakeStorage();
    saveBrush(s, brush("a"));
    const next = renameBrush(s, "a", "   ");
    expect(next.find((b) => b.id === "a")!.name).toBe("브러시 a");
  });

  it("없는 id는 무시한다", () => {
    const s = fakeStorage();
    saveBrush(s, brush("a"));
    const next = renameBrush(s, "zzz", "새 이름");
    expect(next.map((b) => b.id)).toEqual(["a"]);
  });
});

describe("deleteBrush", () => {
  it("id로 삭제", () => {
    const s = fakeStorage();
    saveBrush(s, brush("a"));
    saveBrush(s, brush("b"));
    const next = deleteBrush(s, "a");
    expect(next.map((b) => b.id)).toEqual(["b"]);
    expect(listBrushes(s).map((b) => b.id)).toEqual(["b"]);
  });

  it("없는 id는 그대로", () => {
    const s = fakeStorage();
    saveBrush(s, brush("a"));
    expect(deleteBrush(s, "zzz").map((b) => b.id)).toEqual(["a"]);
  });
});

describe("빠른 선반·복제·삭제 취소", () => {
  it("고정 브러시를 먼저, 나머지는 최근 사용순으로 최대 8개 반환하며 입력을 바꾸지 않는다", () => {
    const source = Array.from({ length: 10 }, (_, index) => ({
      ...brush(`b${index}`, index),
      pinned: index === 1 || index === 4,
      lastUsedAt: index === 9 ? null : index * 10,
    }));
    const before = source.map((item) => item.id);
    const quick = selectQuickBrushes(source);
    expect(quick).toHaveLength(8);
    expect(quick.slice(0, 2).map((item) => item.id)).toEqual(["b4", "b1"]);
    expect(quick[2].id).toBe("b8");
    expect(quick.map((item) => item.id)).not.toContain("b9");
    expect(source.map((item) => item.id)).toEqual(before);
  });

  it("고정 토글과 최근 적용 시각 기록을 저장한다", () => {
    const s = fakeStorage();
    saveBrush(s, brush("a"));
    const pinned = toggleBrushPinned(s, "a");
    expect(pinned[0].pinned).toBe(true);
    const used = markBrushUsed(s, "a", 1234);
    expect(used[0].lastUsedAt).toBe(1234);
    expect(listBrushes(s)[0]).toMatchObject({ pinned: true, lastUsedAt: 1234 });
  });

  it("최근 사용 시각 저장이 실패하면 storage-error와 영속된 원본을 명시적으로 반환한다", () => {
    const original = brush("a");
    const storage = {
      getItem: () => JSON.stringify({
        version: BRUSH_LIBRARY_STORAGE_VERSION,
        brushes: [original],
      }),
      setItem: () => {
        throw new Error("quota");
      },
    };

    const result = markBrushUsedWithResult(storage, "a", 1234);
    expect(result.status).toBe("storage-error");
    expect(result.brushes).toEqual([original]);
    expect(result.brushes[0].lastUsedAt).toBeNull();
  });

  it("복제 이름은 충돌을 건너뛰고 기존 숫자 접미사도 정규화한다", () => {
    expect(duplicateBrushName("먹펜", ["먹펜", "먹펜 2", "먹펜 3"])).toBe("먹펜 4");
    expect(duplicateBrushName("먹펜 2", ["먹펜", "먹펜 2"])).toBe("먹펜 3");
  });

  it("원본 바로 다음에 독립 브러시를 복제하고 고정·최근 메타데이터는 초기화한다", () => {
    const s = fakeStorage();
    saveBrush(s, { ...brush("a"), pinned: true, lastUsedAt: 100 });
    saveBrush(s, brush("b"));
    const result = duplicateBrush(s, "a");
    expect(result.status).toBe("duplicated");
    expect(result.brush).toMatchObject({ name: "브러시 a 2", pinned: false, lastUsedAt: null });
    expect(result.brush?.id).not.toBe("a");
    expect(result.brushes.map((item) => item.id)).toEqual(["b", "a", result.brush?.id]);
  });

  it("수천 개 라이브러리에서도 원본 다음 위치에 복제한다", () => {
    const s = fakeStorage();
    saveBrushBatchWithResult(
      s,
      Array.from({ length: 3_000 }, (_, index) => brush(`b${index}`, index))
    );
    const result = duplicateBrush(s, "b0");
    expect(result.status).toBe("duplicated");
    expect(result.brushes).toHaveLength(3_001);
    expect(result.brushes[0]?.id).toBe("b0");
    expect(result.brushes[1]?.id).toBe(result.brush?.id);
  });

  it("브러시 팩은 개수와 무관하게 전부 저장하고 중복 id만 첫 항목으로 축약한다", () => {
    const s = fakeStorage();
    saveBrushBatchWithResult(
      s,
      Array.from({ length: 3_000 }, (_, index) => brush(`base-${index}`, index))
    );
    const result = saveBrushBatchWithResult(s, [
      { ...brush("pack-a"), name: "첫 항목" },
      { ...brush("pack-a"), name: "중복 항목" },
      brush("pack-b"),
    ]);
    expect(result.status).toBe("partial");
    expect(result.savedCount).toBe(2);
    expect(result.skippedCount).toBe(1);
    expect(result.brushes).toHaveLength(3_002);
    expect(result.brushes[0]?.id).toBe("pack-a");
    expect(result.brushes[0]?.name).toBe("첫 항목");
    expect(result.brushes[1]?.id).toBe("pack-b");
  });

  it("브러시 팩 저장 실패는 영속 원본을 보존하고 부분 성공을 노출하지 않는다", () => {
    const original = brush("original");
    const storage = {
      getItem: () => JSON.stringify({
        version: BRUSH_LIBRARY_STORAGE_VERSION,
        brushes: [original],
      }),
      setItem: () => { throw new Error("quota"); },
    };
    const result = saveBrushBatchWithResult(storage, [brush("pack-a"), brush("pack-b")]);
    expect(result).toMatchObject({ status: "storage-error", savedCount: 0, skippedCount: 2 });
    expect(result.brushes).toEqual([original]);
  });

  it("삭제 receipt로 동일 id와 원래 위치를 복원한다", () => {
    const s = fakeStorage();
    saveBrush(s, brush("a"));
    saveBrush(s, brush("b"));
    saveBrush(s, brush("c"));
    const removed = deleteBrushWithRecord(s, "b");
    expect(removed.status).toBe("deleted");
    expect(removed.deleted).toMatchObject({ brush: { id: "b" }, index: 1 });
    const restored = restoreDeletedBrush(s, removed.deleted!);
    expect(restored.status).toBe("restored");
    expect(restored.brushes.map((item) => item.id)).toEqual(["c", "b", "a"]);
  });

  it("전체 목록도 고정과 최근 사용순으로 안정 정렬한다", () => {
    const ordered = sortBrushesForLibrary([
      { ...brush("old", 1), lastUsedAt: 10 },
      { ...brush("pinned", 2), pinned: true, lastUsedAt: 2 },
      { ...brush("recent", 3), lastUsedAt: 30 },
    ]);
    expect(ordered.map((item) => item.id)).toEqual(["pinned", "recent", "old"]);
  });

  it("현재 스냅샷과 모든 물리 속성이 같을 때만 활성 브러시로 판별한다", () => {
    const saved = brush("match");
    expect(brushMatchesSnapshot(saved, validSnapshot)).toBe(true);
    expect(brushMatchesSnapshot(saved, { ...validSnapshot, strokeWidth: 13 })).toBe(false);
    expect(brushMatchesSnapshot(saved, {
      ...validSnapshot,
      brushDynamics: { width: validSnapshot.brushDynamics.width } as StudioBrushSnapshot["brushDynamics"],
    })).toBe(false);
    expect(brushMatchesSnapshot(saved, {
      ...validSnapshot,
      brushDynamics: normalizeStudioBrushDynamicsSettings({ ...validSnapshot.brushDynamics, version: 999 }),
    })).toBe(true);
    expect(brushMatchesSnapshot(saved, {
      ...validSnapshot,
      brushDynamics: normalizeStudioBrushDynamicsSettings({ ...validSnapshot.brushDynamics, seed: 493 }),
    })).toBe(false);
    const stamp = {
      ...saved,
      brushId: "airbrush-fine",
      stampTuning: { flow: 0.22, hardness: 0.12, minSize: 0.75 },
    };
    expect(brushMatchesSnapshot(stamp, {
      ...validSnapshot,
      brushId: "airbrush-fine",
      stampTuning: { flow: 0.22, hardness: 0.12, minSize: 0.75 },
    })).toBe(true);
    expect(brushMatchesSnapshot(stamp, {
      ...validSnapshot,
      brushId: "airbrush-fine",
      stampTuning: { flow: 0.5, hardness: 0.12, minSize: 0.75 },
    })).toBe(false);
  });

  it("같은 렌더링 엔진이어도 출처 프리셋 id와 이름이 다르면 정확히 일치하지 않는다", () => {
    const saved = {
      ...brush("source-match"),
      sourcePresetId: "essentials:round-sketch",
      sourcePresetName: "둥근 스케치",
    };
    expect(brushMatchesSnapshot(saved, {
      ...validSnapshot,
      sourcePresetId: "essentials:round-sketch",
      sourcePresetName: "둥근 스케치",
    })).toBe(true);
    expect(brushMatchesSnapshot(saved, {
      ...validSnapshot,
      sourcePresetId: "essentials:soft-sketch",
      sourcePresetName: "둥근 스케치",
    })).toBe(false);
    expect(brushMatchesSnapshot(saved, {
      ...validSnapshot,
      sourcePresetId: "essentials:round-sketch",
      sourcePresetName: "다른 표시 이름",
    })).toBe(false);
    expect(brushMatchesSnapshot(saved, validSnapshot)).toBe(false);
  });
});

describe("writeBrushJson / importBrushFromJson 왕복", () => {
  it("kind 필드를 포함한 JSON을 만든다", () => {
    const out = writeBrushJson(brush("a"));
    const parsed = JSON.parse(out);
    expect(parsed.kind).toBe(BRUSH_EXPORT_KIND);
    expect(parsed.version).toBe(BRUSH_EXPORT_VERSION);
    expect(parsed.name).toBe("브러시 a");
    expect(parsed.brushId).toBe("gpen");
    expect(parsed.stabilizerMode).toBe("precision");
    expect(parsed.postCorrection).toBe(7);
    expect(parsed.preserveCorners).toBe(true);
    expect(parsed.tiltEnabled).toBe(true);
    expect(parsed.tipAngle).toBe(-35);
    expect(parsed.tipRoundness).toBe(0.3);
    expect(parsed.brushDynamics).toEqual(validSnapshot.brushDynamics);
    expect(parsed.stampTuning).toBeNull();
    expect(parsed).not.toHaveProperty("pinned");
    expect(parsed).not.toHaveProperty("lastUsedAt");
  });

  it("내보내기도 런타임 계약이 없는 사용자 브러시 id를 전파하지 않는다", () => {
    const parsed = JSON.parse(writeBrushJson({
      ...brush("unsupported-export"),
      brushId: "marketplace-engine-not-installed",
    }));

    expect(parsed.brushId).toBe("pen");
  });

  it("왕복하면 같은 스냅샷을 얻는다(adjustedFields 없음)", () => {
    const original = brush("a");
    const out = writeBrushJson(original);
    const { brush: imported, adjustedFields } = importBrushFromJson(out);
    expect(imported.name).toBe(original.name);
    expect(imported.brushId).toBe(original.brushId);
    expect(imported.strokeWidth).toBe(original.strokeWidth);
    expect(imported.color).toBe(original.color);
    expect(imported.brushDynamics).toEqual(original.brushDynamics);
    expect(imported.stampTuning).toEqual(original.stampTuning);
    expect(imported).toMatchObject({ pinned: false, lastUsedAt: null });
    expect(adjustedFields).toEqual([]);
    expect(imported.id).not.toBe(original.id); // 가져오기는 새 id를 발급한다(같은 id 충돌 방지)
  });

  it("출처 프리셋 메타데이터를 JSON 내보내기·가져오기에서 손실 없이 왕복한다", () => {
    const original = {
      ...brush("source-round-trip"),
      sourcePresetId: "essentials:textured-marker",
      sourcePresetName: "텍스처 마커",
    };
    const parsed = JSON.parse(writeBrushJson(original));
    expect(parsed).toMatchObject({
      sourcePresetId: "essentials:textured-marker",
      sourcePresetName: "텍스처 마커",
    });

    const { brush: imported, adjustedFields } = importBrushFromJson(JSON.stringify(parsed));
    expect(imported).toMatchObject({
      sourcePresetId: original.sourcePresetId,
      sourcePresetName: original.sourcePresetName,
    });
    expect(adjustedFields).toEqual([]);
  });

  it("v1~v3 내보내기처럼 brushDynamics가 없어도 기본값으로 가져온다", () => {
    const legacy = JSON.parse(writeBrushJson(brush("legacy-export")));
    legacy.version = 3;
    delete legacy.brushDynamics;
    const { brush: imported, adjustedFields } = importBrushFromJson(JSON.stringify(legacy));
    expect(imported.brushDynamics).toEqual(DEFAULT_STUDIO_BRUSH_DYNAMICS_SETTINGS);
    expect(adjustedFields).toContain("brushDynamics");
  });

  it("v4 내보내기처럼 stampTuning이 없어도 스탬프 종류별 기본값으로 가져온다", () => {
    const legacy = JSON.parse(writeBrushJson({
      ...brush("legacy-stamp-export"),
      brushId: "airbrush-fine",
      stampTuning: { flow: 0.71, hardness: 0.64, minSize: 0.2 },
    }));
    legacy.version = 4;
    delete legacy.stampTuning;
    const { brush: imported, adjustedFields } = importBrushFromJson(JSON.stringify(legacy));
    expect(imported.stampTuning).toEqual({ flow: 0.16, hardness: 0.06, minSize: 0.7 });
    expect(adjustedFields).toContain("stampTuning");
  });

  it("스탬프 튜닝을 JSON 내보내기·가져오기에서 손실 없이 왕복한다", () => {
    const original = {
      ...brush("stamp-round-trip"),
      brushId: "wash-brush",
      stampTuning: { flow: 0.47, hardness: 0.68, minSize: 0.29 },
    };
    const parsed = JSON.parse(writeBrushJson(original));
    expect(parsed.stampTuning).toEqual(original.stampTuning);
    const { brush: imported, adjustedFields } = importBrushFromJson(JSON.stringify(parsed));
    expect(imported.stampTuning).toEqual(original.stampTuning);
    expect(adjustedFields).toEqual([]);
  });

  it("kind가 없거나 다르면 던진다", () => {
    expect(() => importBrushFromJson("{}")).toThrow();
    expect(() => importBrushFromJson(JSON.stringify({ kind: "something-else" }))).toThrow();
  });

  it("빈 문자열/공백은 던진다", () => {
    expect(() => importBrushFromJson("")).toThrow();
    expect(() => importBrushFromJson("   ")).toThrow();
  });

  it("깨진 JSON은 던진다", () => {
    expect(() => importBrushFromJson("{not json")).toThrow();
  });

  it("kind는 맞지만 필드가 깨졌으면 기본값으로 보정하고 adjustedFields로 알린다", () => {
    const { brush: imported, adjustedFields } = importBrushFromJson(
      JSON.stringify({ kind: BRUSH_EXPORT_KIND, name: "깨진 파일", strokeWidth: 9999, color: "invalid" })
    );
    expect(imported.name).toBe("깨진 파일");
    expect(imported.strokeWidth).toBe(BRUSH_STROKE_WIDTH_RANGE[1]);
    expect(imported.color).toBe("#7c5cfc");
    expect(adjustedFields).toEqual(expect.arrayContaining(["strokeWidth", "color"]));
  });

  it("이름이 없으면 fallbackName을, 그것도 없으면 DEFAULT_BRUSH_NAME을 쓴다", () => {
    const withFallback = importBrushFromJson(JSON.stringify({ kind: BRUSH_EXPORT_KIND }), "내파일");
    expect(withFallback.brush.name).toBe("내파일");

    const withoutFallback = importBrushFromJson(JSON.stringify({ kind: BRUSH_EXPORT_KIND }));
    expect(withoutFallback.brush.name).toBe("이름 없는 브러시");
  });
});

describe("brushFileName", () => {
  it("파일시스템 금지 문자를 제거한다", () => {
    expect(brushFileName({ name: 'a/b\\c:d*e?f"g<h>i|j' })).toBe("abcdefghij.json");
  });

  it("한글과 공백은 그대로 유지한다", () => {
    expect(brushFileName({ name: "내 지스펜" })).toBe("내 지스펜.json");
  });

  it("정제 후 이름이 비면 brush.json으로 대체한다", () => {
    expect(brushFileName({ name: "///" })).toBe("brush.json");
    expect(brushFileName({ name: "   " })).toBe("brush.json");
  });
});

// ── 내장 프로시저럴 카탈로그(120종) × 저장 라이브러리 계약 ──────────────────
// 카탈로그 프리셋을 "내 브러시"로 저장하면 StudioPage는 brushId=런타임 엔진 id,
// sourcePreset* = 카탈로그 정체성, brushDynamics = 완전한 정규화 스냅샷으로 기록한다.
// 이 블록은 160개 전부가 라이브러리 정규화를 보정 없이 통과하고, 내보내기/가져오기
// 왕복이 무손실이며, 각 파라미터가 엔진 안전 범위 안에 있음을 프리셋 단위로 고정한다.
describe("내장 카탈로그 160종 저장 라이브러리 왕복", () => {
  const selections = materializeAllStudioBrushPackSelections();

  function catalogSnapshot(selection: (typeof selections)[number]): StudioBrushSnapshot {
    return {
      sourcePresetId: selection.catalogId,
      sourcePresetName: selection.catalogName,
      brushId: selection.runtimeBrushId,
      strokeWidth: selection.defaultWidth,
      brushOpacity: selection.defaultOpacity,
      color: "#7c5cfc",
      stabilizer: 0,
      stabilizerMode: "standard",
      postCorrection: 0,
      preserveCorners: true,
      pressureCurve: 1,
      pressureMinSize: 0,
      useVelocityPressure: false,
      velocitySensitivity: 0.65,
      tiltEnabled: true,
      tipAngle: -30,
      tipRoundness: 0.24,
      brushDynamics: selection.brushDynamics,
      stampTuning: null,
  enginePrograms: null,
    };
  }

  it("160개 전 프리셋이 sanitizeBrushSnapshot을 무보정 통과한다", () => {
    expect(selections).toHaveLength(160);
    expect(new Set(selections.map((selection) => selection.catalogId)).size).toBe(160);
    for (const selection of selections) {
      const { snapshot, adjustedFields } = sanitizeBrushSnapshot(catalogSnapshot(selection));
      expect(adjustedFields, `${selection.catalogId}: sanitized fields`).toEqual([]);
      expect(snapshot, selection.catalogId).toEqual(catalogSnapshot(selection));
    }
  });

  it("확장 웨이브 73종을 포함해 전 프리셋 파라미터가 스냅샷 안전 범위 안이다", () => {
    expect(
      STUDIO_BRUSH_PACK_EXPANSION_WAVE_IDS.every((id) =>
        selections.some((selection) => selection.catalogId === id)
      )
    ).toBe(true);
    for (const selection of selections) {
      const id = selection.catalogId;
      const dynamics = selection.brushDynamics;
      expect(selection.defaultWidth, id).toBeGreaterThanOrEqual(BRUSH_STROKE_WIDTH_RANGE[0]);
      expect(selection.defaultWidth, id).toBeLessThanOrEqual(BRUSH_STROKE_WIDTH_RANGE[1]);
      expect(selection.defaultOpacity, id).toBeGreaterThanOrEqual(BRUSH_OPACITY_RANGE[0]);
      expect(selection.defaultOpacity, id).toBeLessThanOrEqual(BRUSH_OPACITY_RANGE[1]);
      // 정규화 멱등성 — 이미 정규화된 스냅샷을 다시 정규화해도 구조가 같아야 한다.
      expect(normalizeStudioBrushDynamicsSettings(dynamics), id).toEqual(dynamics);
      expect(dynamics.spacingRatio, id).not.toBeNull();
      expect(dynamics.spacingRatio!, id).toBeGreaterThanOrEqual(0.01);
      expect(dynamics.spacingRatio!, id).toBeLessThanOrEqual(16);
      if (dynamics.scatterRatio !== null) {
        expect(dynamics.scatterRatio, id).toBeGreaterThanOrEqual(0);
        expect(dynamics.scatterRatio, id).toBeLessThanOrEqual(16);
      }
      expect(dynamics.taper.startLength, id).toBeLessThanOrEqual(0.5);
      expect(dynamics.taper.endLength, id).toBeLessThanOrEqual(0.5);
      expect(dynamics.flow.base, id).toBeGreaterThan(0);
      expect(dynamics.flow.base, id).toBeLessThanOrEqual(1);
      expect(dynamics.opacity.base, id).toBe(1);
      expect(dynamics.width.base, id).toBe(selection.defaultWidth);
      expect(dynamics.roundness.base, id).toBeGreaterThanOrEqual(0.08);
      expect(dynamics.roundness.base, id).toBeLessThanOrEqual(1);
      expect(Math.abs(dynamics.angle.base), id).toBeLessThanOrEqual(180);
      expect(dynamics.grain.amount, id).toBeGreaterThanOrEqual(0);
      expect(dynamics.grain.amount, id).toBeLessThanOrEqual(1);
      expect(dynamics.grain.scale, id).toBeGreaterThanOrEqual(0.25);
      expect(dynamics.grain.scale, id).toBeLessThanOrEqual(512);
      expect(dynamics.colorDynamics.hueJitter, id).toBeGreaterThanOrEqual(0);
      expect(dynamics.colorDynamics.hueJitter, id).toBeLessThanOrEqual(180);
      expect(dynamics.tipLayers.length, id).toBeLessThanOrEqual(2);
    }
  });

  it("전 프리셋이 JSON 내보내기/가져오기 왕복에서 무손실이다", () => {
    for (const selection of selections) {
      const source = createBrush(selection.catalogName, catalogSnapshot(selection));
      const { brush: imported, adjustedFields } = importBrushFromJson(writeBrushJson(source));
      expect(adjustedFields, selection.catalogId).toEqual([]);
      expect(imported.name, selection.catalogId).toBe(selection.catalogName);
      expect(brushMatchesSnapshot(imported, catalogSnapshot(selection)), selection.catalogId).toBe(true);
    }
  });
});
