import { describe, expect, it } from "vitest";

import {
  createDefaultStudioBg3dSceneDocument,
  serializeStudioBg3dSceneDocument,
  parseStudioBg3dSceneDocument,
} from "./studio-bg3d-scene-document";
import {
  applyStudioBg3dSunRig,
  computeStudioBg3dSunColorTemperatureK,
  computeStudioBg3dSunDirection,
  computeStudioBg3dSunElevationDeg,
  computeStudioBg3dSunLighting,
  DEFAULT_STUDIO_BG3D_SUN_RIG_CONFIG,
  resolveStudioBg3dSunLightState,
  STUDIO_BG3D_SUN_MAX_ELEVATION_DEG,
  STUDIO_BG3D_SUN_TIME_PRESETS,
  studioBg3dKelvinToHexColor,
} from "./studio-bg3d-sun-rig";

describe("computeStudioBg3dSunElevationDeg", () => {
  it("일출 6시·일몰 18시에 0, 정오에 최대 고도를 만든다", () => {
    expect(computeStudioBg3dSunElevationDeg(6)).toBeCloseTo(0, 10);
    expect(computeStudioBg3dSunElevationDeg(18)).toBeCloseTo(0, 10);
    expect(computeStudioBg3dSunElevationDeg(12)).toBeCloseTo(STUDIO_BG3D_SUN_MAX_ELEVATION_DEG, 10);
  });

  it("9시는 최대 고도의 sin(45°) 배(대칭 궤적의 알려진 각)", () => {
    const expected = STUDIO_BG3D_SUN_MAX_ELEVATION_DEG * Math.SQRT1_2;
    expect(computeStudioBg3dSunElevationDeg(9)).toBeCloseTo(expected, 10);
    expect(computeStudioBg3dSunElevationDeg(15)).toBeCloseTo(expected, 10);
  });

  it("밤에는 음수(지평선 아래)이고 24시간 래핑을 지원한다", () => {
    expect(computeStudioBg3dSunElevationDeg(0)).toBeLessThan(0);
    expect(computeStudioBg3dSunElevationDeg(22)).toBeLessThan(0);
    expect(computeStudioBg3dSunElevationDeg(36)).toBeCloseTo(computeStudioBg3dSunElevationDeg(12), 10);
    expect(computeStudioBg3dSunElevationDeg(-2)).toBeCloseTo(computeStudioBg3dSunElevationDeg(22), 10);
  });
});

describe("computeStudioBg3dSunDirection", () => {
  it("항상 단위 벡터를 만든다", () => {
    for (const [elevation, azimuth] of [[0, 0], [45, 90], [66, 215], [30, -120]] as const) {
      const [x, y, z] = computeStudioBg3dSunDirection(elevation, azimuth);
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 12);
    }
  });

  it("알려진 각도: 고도 90° → 정확히 위, 고도 0°/방위 0° → +Z, 방위 90° → +X", () => {
    const up = computeStudioBg3dSunDirection(90, 0);
    expect(up[1]).toBeCloseTo(1, 12);
    const front = computeStudioBg3dSunDirection(0, 0);
    expect(front).toEqual([0, 0, 1]);
    const side = computeStudioBg3dSunDirection(0, 90);
    expect(side[0]).toBeCloseTo(1, 12);
    expect(side[1]).toBeCloseTo(0, 12);
    const mid = computeStudioBg3dSunDirection(45, 0);
    expect(mid[1]).toBeCloseTo(Math.SQRT1_2, 12);
    expect(mid[2]).toBeCloseTo(Math.SQRT1_2, 12);
  });
});

describe("색온도 램프", () => {
  it("낮은 해일수록 따뜻하다(단조 증가 램프)", () => {
    expect(computeStudioBg3dSunColorTemperatureK(2)).toBeLessThan(computeStudioBg3dSunColorTemperatureK(20));
    expect(computeStudioBg3dSunColorTemperatureK(20)).toBeLessThan(computeStudioBg3dSunColorTemperatureK(60));
    expect(computeStudioBg3dSunColorTemperatureK(0)).toBe(2_200);
    expect(computeStudioBg3dSunColorTemperatureK(90)).toBe(6_000);
  });

  it("kelvin→hex는 결정적이고 소문자 hex이며, 저온은 붉고 고온은 푸르다", () => {
    const warm = studioBg3dKelvinToHexColor(2_200);
    const cool = studioBg3dKelvinToHexColor(7_800);
    expect(warm).toMatch(/^#[0-9a-f]{6}$/u);
    expect(cool).toMatch(/^#[0-9a-f]{6}$/u);
    expect(warm).toBe(studioBg3dKelvinToHexColor(2_200));
    const channel = (hex: string, index: number) => Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
    expect(channel(warm, 0)).toBeGreaterThan(channel(warm, 2)); // R > B
    expect(channel(cool, 2)).toBeGreaterThanOrEqual(channel(cool, 0)); // B >= R
    // 비정상 입력도 안전
    expect(studioBg3dKelvinToHexColor(Number.NaN)).toMatch(/^#[0-9a-f]{6}$/u);
  });
});

describe("resolveStudioBg3dSunLightState", () => {
  it("정오는 태양 모드·맑은 하늘, 석양 프리셋 시각은 sunset 하늘", () => {
    const noon = resolveStudioBg3dSunLightState(12);
    expect(noon.mode).toBe("sun");
    expect(noon.skyPresetId).toBe("clear_day");
    const dusk = resolveStudioBg3dSunLightState(17.6);
    expect(dusk.mode).toBe("sun");
    expect(dusk.skyPresetId).toBe("sunset");
    expect(dusk.colorTemperatureK).toBeLessThan(noon.colorTemperatureK);
  });

  it("밤에는 달빛 모드로 전환되고 광원 고도는 양수를 유지한다", () => {
    const night = resolveStudioBg3dSunLightState(22);
    expect(night.mode).toBe("moon");
    expect(night.skyPresetId).toBe("night");
    expect(night.sunElevationDeg).toBeLessThan(0);
    expect(night.lightElevationDeg).toBeGreaterThan(0);
    expect(night.keyIntensity).toBeLessThan(1);
  });

  it("시간대 프리셋 9종(새벽~자정)이 기대 모드로 갈라진다", () => {
    const modes = STUDIO_BG3D_SUN_TIME_PRESETS.map((preset) => ({
      id: preset.id,
      mode: resolveStudioBg3dSunLightState(preset.timeOfDayHours).mode,
    }));
    expect(modes).toEqual([
      { id: "dawn", mode: "sun" },
      { id: "morning", mode: "sun" },
      { id: "forenoon", mode: "sun" },
      { id: "noon", mode: "sun" },
      { id: "afternoon", mode: "sun" },
      { id: "sunset", mode: "sun" },
      { id: "dusk", mode: "moon" },
      { id: "night", mode: "moon" },
      { id: "midnight", mode: "moon" },
    ]);
  });
});

describe("computeStudioBg3dSunLighting", () => {
  it("키 라이트 방향이 고도·방위에서 온 단위 벡터이고 그림자 의도를 기록한다", () => {
    const lighting = computeStudioBg3dSunLighting({ timeOfDayHours: 12, azimuthDeg: 0, shadowsEnabled: true });
    expect(Math.hypot(...lighting.key.direction)).toBeCloseTo(1, 10);
    expect(lighting.key.direction[1]).toBeCloseTo(Math.sin((STUDIO_BG3D_SUN_MAX_ELEVATION_DEG * Math.PI) / 180), 10);
    expect(lighting.key.castsShadow).toBe(true);
    expect(lighting.fill.castsShadow).toBe(false);
    const noShadow = computeStudioBg3dSunLighting({ timeOfDayHours: 12, azimuthDeg: 0, shadowsEnabled: false });
    expect(noShadow.key.castsShadow).toBe(false);
  });

  it("필 라이트는 반대 방위(+180°)에서 온다", () => {
    const lighting = computeStudioBg3dSunLighting({ timeOfDayHours: 10, azimuthDeg: 40, shadowsEnabled: true });
    // 수평 성분의 부호가 반대
    expect(Math.sign(lighting.fill.direction[0])).toBe(-Math.sign(lighting.key.direction[0]));
    expect(Math.sign(lighting.fill.direction[2])).toBe(-Math.sign(lighting.key.direction[2]));
  });
});

describe("applyStudioBg3dSunRig", () => {
  it("canonical 문서 전이 하나로 적용되고 직렬화 왕복이 무손실이다", () => {
    const base = createDefaultStudioBg3dSceneDocument();
    const applied = applyStudioBg3dSunRig(base, DEFAULT_STUDIO_BG3D_SUN_RIG_CONFIG);
    expect(applied).not.toBeNull();
    const serialized = serializeStudioBg3dSceneDocument(applied!);
    expect(serialized).not.toBeNull();
    expect(parseStudioBg3dSceneDocument(serialized!)).toEqual(applied);
    // 카메라·출력·노드는 그대로
    expect(applied!.camera).toEqual(base.camera);
    expect(applied!.output).toEqual(base.output);
    expect(applied!.nodes).toEqual(base.nodes);
    expect(applied!.background.skyPresetId).toBe("clear_day");
  });

  it("밤 시각은 night 하늘·저노출·달빛 조명으로 전이된다", () => {
    const applied = applyStudioBg3dSunRig(createDefaultStudioBg3dSceneDocument(), {
      timeOfDayHours: 22,
      azimuthDeg: 0,
      shadowsEnabled: true,
    });
    expect(applied!.background.skyPresetId).toBe("night");
    expect(applied!.render.exposure).toBeCloseTo(0.85, 10);
    expect(applied!.lighting.key.intensity).toBeLessThan(1);
  });

  it("투명 배경 의도를 보존한다 — 컷아웃 내보내기가 불투명해지지 않는다", () => {
    const base = createDefaultStudioBg3dSceneDocument();
    const transparent = { ...base, background: { ...base.background, mode: "transparent" as const } };
    const applied = applyStudioBg3dSunRig(transparent, DEFAULT_STUDIO_BG3D_SUN_RIG_CONFIG);
    expect(applied!.background.mode).toBe("transparent");
  });

  it("비정상 config도 안전 범위로 눌러 적용된다", () => {
    const applied = applyStudioBg3dSunRig(createDefaultStudioBg3dSceneDocument(), {
      timeOfDayHours: Number.NaN,
      azimuthDeg: Number.POSITIVE_INFINITY,
      shadowsEnabled: "yes" as never,
    });
    expect(applied).not.toBeNull();
    expect(applied!.lighting.key.castsShadow).toBe(false);
    expect(Math.hypot(...applied!.lighting.key.direction)).toBeCloseTo(1, 6);
  });
});
