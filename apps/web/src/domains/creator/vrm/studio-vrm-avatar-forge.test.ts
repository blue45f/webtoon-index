import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  AVATAR_FORGE_BANG_STYLE_OPTIONS,
  AVATAR_FORGE_BODY_LIMITS,
  AVATAR_FORGE_BODY_PRESETS,
  AVATAR_FORGE_HAIR_LIMITS,
  AVATAR_FORGE_HAIR_STYLE_OPTIONS,
  AVATAR_FORGE_PRESETS,
  AVATAR_FORGE_VERSION,
  applyAvatarForgeBodyPreset,
  avatarForgeBraidSegmentCount,
  buildAvatarForgeHairParts,
  buildAvatarForgeBodyAdjustmentPlan,
  createAvatarForgeState,
  migrateAvatarForgeBodyToStudioVrmProportions,
  parseAvatarForgeState,
  sanitizeAvatarForgeState,
  serializeAvatarForgeState,
  type AvatarForgeHairPart,
  type AvatarForgeHairStyle,
} from "./studio-vrm-avatar-forge";
import {
  NEUTRAL_STUDIO_VRM_PROPORTIONS,
  STUDIO_VRM_PROPORTION_PRESETS,
} from "./studio-vrm-proportion-core";

/* ────────────────────────────────────────────────────────────────────────
 * v1 하위호환 잠금
 *
 * 아래 다이제스트는 v2 파라미터(bangStyle/wave/ahoge/tailHeight)가 도입되기 **직전** 코드가
 * 만들어낸 JSON.stringify(파츠 배열)의 SHA-256이다. v2 기본값은 전부 "v1 무동작" 값이므로,
 * 같은 입력은 지금도 문자 단위로 동일한 계획을 만들어야 한다.
 * 이 표가 깨지면 = 저장된 아바타의 헤어 모양이 바뀐 것이다. 값을 갱신하지 말고 코드를 고칠 것.
 * ──────────────────────────────────────────────────────────────────────── */
const V1_GEOMETRY_DIGESTS: Record<string, string> = {
  "style:none": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
  "style:short": "853cfd745c97a6a98fbfca0876b1147f440b9886e46ed0df64094ba3260b6681",
  "style:bob": "7c3ea753c6847544c13d15e39abcf47ca8432ba30e52d13a94990883f02b48e8",
  "style:long": "918ff2fc4e2c412f128d8738787740c5b065c31e9f5637b0479e6b0d895a7df8",
  "style:ponytail": "aa64ee2384d6dd9d34b88c8beee909f1a0bd2a9a745fc604bb3d32809a7945c1",
  "style:twintail": "094ac4ce13cbd7d33530130fd1fc693eb3a9efac63ff9b1644fd6d04f64acc7a",
  "style:bun": "c5c6b9b1db740036808cd77bcc809c1df450e48d6c97be7832dd0ba394557caa",
  "preset:natural-short": "853cfd745c97a6a98fbfca0876b1147f440b9886e46ed0df64094ba3260b6681",
  "preset:soft-bob": "d3cdcf3164ae62a93fc782854a8c7feb8f42964e6a631e0fc1f9dd03be38d911",
  "preset:romance-long": "9bf8c19ca5a64eb2b1ee3300ec7f36c15c482fa3a2b0a4441a77735785fb9316",
  "preset:action-pony": "9ce066e424a507e9a48ee760e9a672ea64521f0675fdbff152fc34803f773add",
  "preset:pop-twin": "0942d96a3901249077251d46f7068e5c58ae0c0bafccb4796887df3061fb8af3",
  "preset:elegant-bun": "e06a9f4184085f24d9819ee68ca516eaae9370fb117f5b3de1fd1610eeb5e366",
  "preset:androgynous-crop": "d2b80b09bdc50c7c1b53ac645917d7e9ac5fa42cfef3f7497e62806696025fd4",
  "preset:silver-senior": "de69e42fc89ccb24f295af72d19c81ad652a68da200a11affc18af94536f2d18",
  "preset:fiery-long": "5f17cd287d3f3890b5bf147b37b5cc4f23a4d725d240c16c4b54c12b3a8a8b1b",
  "preset:mint-bob": "cad5fafce7b7201659cdc01e53c2f1c844720e7d20a8e874519f3db28979ff42",
  "preset:gold-pony": "0bbc3bf10912ff81eb69c5816ecaebd9e6e3d554e0b1268d6843c7bae4cb68e3",
  "preset:ink-twin": "dccbd6724da7c319f97fd971b009ccd902cf0b3e2d94e05f352176df22b33809",
  "preset:sakura-bun": "c2953fac68550cd0f992f9eccca8809e0f2312913d3b7330fd351938ef9dee4b",
  "preset:hero-crop": "9082f34e63c04c38e5a062a224d55cbffc07566514f92719f201a65610a5ed64",
  "corner:short:0": "a091adb6b20707396e9d79177f3f88af1744209569ab67991a2f81011b037ee5",
  "corner:short:1": "6bd34ca430bf9001bcca6f849634ea15f32cd165a295c4f318470c45a9e07ef4",
  "corner:short:2": "6d889c00929953188a0a6c1476df50f7736f130dc9e146fb21f5365bb8bd0766",
  "corner:bob:0": "2e2eff5fea3dfa28f2a06a011cda6dc8fc10c05a3c6356bb3bebeb7a4db9217a",
  "corner:bob:1": "9147e3044897f38c6312bfd1b3836cbeb8ccd3bc44a9259c2ae27f81ed22c8cf",
  "corner:bob:2": "a018276acc71798218920d2c4b1ceb2aaf4824757c43e142cb27acda1e8bd553",
  "corner:long:0": "91deecb58e5347831acc3208de7172ccd593409231eb48f42b6e2e30cf349d27",
  "corner:long:1": "44ad31d5268866bb4611ea625d22afb82159b71278e0d63659caff42451fdb0e",
  "corner:long:2": "3edf4c73dccb7a4d95e1e1fbb918cc7b0bbae195242b48063527c6b1c281c134",
  "corner:ponytail:0": "87805b2449b502f37e1fdd35708fb8ec223512311095c778901519a505a3bd8e",
  "corner:ponytail:1": "8add6ba7b73607a31fe2503fe6edf8b060d1114ddbff9d5549ca4f0d5e18ad0f",
  "corner:ponytail:2": "ac25e0cbd774ff7b964276e7016036c96950d57135912b6be95cd7a85f14aa1e",
  "corner:twintail:0": "d7d2d9500c1c3c82e64a4408e0f094251be3bfc95623dd258f0fbe947ec36d10",
  "corner:twintail:1": "2871373e507c7a867a4d270f9128ab81efddedd6be805b287842dfcb0fa53834",
  "corner:twintail:2": "93d8051a185a6ea1fa4aaa0f12db0923bd547e0b91ed7f5c0b1ce28e5099c1f5",
  "corner:bun:0": "20b65c52c180d6b8c2e28d03a49e1557a97e93bfb6eb613c5bc6e808886d03e6",
  "corner:bun:1": "761fd58b964ae7bc3628a2297314c5ca28684b99f4a92fe888b12bc7ab4782f7",
  "corner:bun:2": "ebd2c4336199608cec6c4b82d184e134e5e3d889d99b0ddcb00b7a79b7174e8a",
};

const V1_STYLES = ["none", "short", "bob", "long", "ponytail", "twintail", "bun"] as const;
const V1_PRESET_IDS = [
  "natural-short", "soft-bob", "romance-long", "action-pony", "pop-twin", "elegant-bun",
  "androgynous-crop", "silver-senior", "fiery-long", "mint-bob", "gold-pony", "ink-twin",
  "sakura-bun", "hero-crop",
] as const;
const V1_CORNERS = [
  { volume: 0.72, length: 0.55, strandWidth: 0.68, fringe: 0.2, curl: 0, shine: 0 },
  { volume: 1.45, length: 1.7, strandWidth: 1.45, fringe: 1.35, curl: 1, shine: 1 },
  { volume: 1.13, length: 0.91, strandWidth: 1.07, fringe: 0.63, curl: 0.37, shine: 0.81 },
] as const;

const V2_STYLES = ["wavy", "braid", "twin-braid", "hime", "wolf", "half-up", "pixie"] as const;
const ALL_STYLES = [...V1_STYLES, ...V2_STYLES] as const;

function digest(parts: AvatarForgeHairPart[]) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function stateDigest(state: unknown) {
  return createHash("sha256").update(JSON.stringify(state)).digest("hex");
}

function styleState(style: AvatarForgeHairStyle, patch: Partial<Record<string, unknown>> = {}) {
  const state = createAvatarForgeState();
  state.hair = { ...state.hair, style, ...patch } as typeof state.hair;
  return state;
}

function partById(parts: AvatarForgeHairPart[], id: string) {
  const found = parts.find((part) => part.id === id);
  if (!found) throw new Error(`missing part: ${id} (have: ${parts.map((p) => p.id).join(", ")})`);
  return found;
}

/* ── 기존 v1 계약(그대로 유지) ─────────────────────────────────────────── */

describe("studio-vrm-avatar-forge state", () => {
  it("offers diverse, independently cloned starter presets", () => {
    expect(AVATAR_FORGE_PRESETS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(AVATAR_FORGE_PRESETS.map((preset) => preset.state.hair.style)).size).toBeGreaterThanOrEqual(6);

    const first = createAvatarForgeState("soft-bob");
    const second = createAvatarForgeState("soft-bob");
    first.hair.baseColor = "#000000";
    expect(second.hair.baseColor).not.toBe(first.hair.baseColor);
  });

  it("sanitizes hostile or stale state without leaking unknown fields", () => {
    const result = sanitizeAvatarForgeState({
      version: 999,
      presetId: "x".repeat(100),
      face: { headWidth: 99, headHeight: -4, headDepth: "1.08", cheekVolume: Number.NaN },
      hair: {
        style: "exploit",
        replaceOriginal: "yes",
        volume: Number.POSITIVE_INFINITY,
        length: -1,
        strandWidth: 99,
        fringe: 0.5,
        curl: 2,
        shine: -2,
        baseColor: "url(javascript:bad)",
        tipColor: "#ABCDEF",
      },
      unknown: "discarded",
    });

    expect(result.version).toBe(AVATAR_FORGE_VERSION);
    expect(result.presetId).toHaveLength(64);
    expect(result.face.headWidth).toBe(1.18);
    expect(result.face.headHeight).toBe(0.86);
    expect(result.face.headDepth).toBe(1.08);
    expect(result.face.cheekVolume).toBe(0.35);
    expect(result.hair.style).toBe("none");
    expect(result.hair.replaceOriginal).toBe(false);
    expect(result.hair.length).toBe(0.55);
    expect(result.hair.strandWidth).toBe(1.45);
    expect(result.hair.curl).toBe(1);
    expect(result.hair.shine).toBe(0);
    expect(result.hair.baseColor).toBe("#352a28");
    expect(result.hair.tipColor).toBe("#abcdef");
    expect("unknown" in result).toBe(false);
  });

  it("parses JSON and falls back safely for malformed JSON", () => {
    expect(parseAvatarForgeState(JSON.stringify(createAvatarForgeState("elegant-bun"))).hair.style).toBe("bun");
    expect(parseAvatarForgeState("{broken").hair.style).toBe("none");
  });

  it("serializes a plain sanitized object", () => {
    const serialized = serializeAvatarForgeState({ hair: { style: "long", baseColor: "#112233" } });
    expect(serialized).toEqual(parseAvatarForgeState(serialized));
    expect(serialized.hair.style).toBe("long");
    expect(serialized.hair.baseColor).toBe("#112233");
  });

  it.each(ALL_STYLES.filter((style) => style !== "none"))(
    "builds deterministic geometry plans for %s",
    (style) => {
      const state = styleState(style);
      const first = buildAvatarForgeHairParts(state);
      const second = buildAvatarForgeHairParts(state);
      expect(first).toEqual(second);
      expect(digest(first)).toBe(digest(second));
      expect(first.length).toBeGreaterThanOrEqual(6);
      expect(new Set(first.map((part) => part.id)).size).toBe(first.length);
      expect(first.every((part) => part.baseColor === state.hair.baseColor)).toBe(true);
    }
  );

  it("returns no generated parts for the none hairstyle", () => {
    const state = createAvatarForgeState();
    state.hair.style = "none";
    expect(buildAvatarForgeHairParts(state)).toEqual([]);
  });

  it("scales long-hair plans from normalized controls", () => {
    const compact = createAvatarForgeState("romance-long");
    compact.hair.length = 0.7;
    const extended = createAvatarForgeState("romance-long");
    extended.hair.length = 1.6;

    const compactBack = buildAvatarForgeHairParts(compact).find((part) => part.id === "back");
    const extendedBack = buildAvatarForgeHairParts(extended).find((part) => part.id === "back");
    expect(extendedBack?.scale[1]).toBeGreaterThan(compactBack?.scale[1] ?? 0);
  });
});

/* ── v1 → v4 하위호환 ──────────────────────────────────────────────────── */

describe("v1 하위호환(바이트 단위 지오메트리 고정)", () => {
  it("스키마 버전이 4로 올라갔다", () => {
    expect(AVATAR_FORGE_VERSION).toBe(4);
  });

  it.each(V1_STYLES)("v1 스타일 %s의 파츠 계획이 v1과 문자 단위로 같다", (style) => {
    expect(digest(buildAvatarForgeHairParts(styleState(style)))).toBe(V1_GEOMETRY_DIGESTS[`style:${style}`]);
  });

  it.each(V1_PRESET_IDS)("v1 프리셋 %s의 파츠 계획이 v1과 문자 단위로 같다", (presetId) => {
    expect(digest(buildAvatarForgeHairParts(createAvatarForgeState(presetId)))).toBe(
      V1_GEOMETRY_DIGESTS[`preset:${presetId}`]
    );
  });

  it("파라미터 극단값 코너에서도 v1 계획이 재현된다", () => {
    let checked = 0;
    for (const style of ["short", "bob", "long", "ponytail", "twintail", "bun"] as const) {
      V1_CORNERS.forEach((corner, index) => {
        expect(digest(buildAvatarForgeHairParts(styleState(style, corner)))).toBe(
          V1_GEOMETRY_DIGESTS[`corner:${style}:${index}`]
        );
        checked += 1;
      });
    }
    expect(checked).toBe(18);
  });

  it("v1 필드는 라운드트립에서 보존되고 v2 필드는 v1 등가값으로 채워진다", () => {
    const legacyDocument = {
      version: 1,
      presetId: "romance-long",
      face: { headWidth: 1, headHeight: 1.04, headDepth: 1, cheekVolume: 0.35, chinLength: 1.05 },
      hair: {
        style: "long",
        replaceOriginal: true,
        volume: 1,
        length: 1.3,
        strandWidth: 1,
        fringe: 0.75,
        curl: 0.15,
        shine: 0.68,
        baseColor: "#2c253f",
        tipColor: "#725d8d",
      },
      faceAccents: [{ id: "blush", enabled: true, color: "#ef8f9d", intensity: 0.35 }],
    };

    const migrated = parseAvatarForgeState(JSON.stringify(legacyDocument));

    // v1 값은 한 글자도 변하지 않는다.
    expect(migrated.presetId).toBe("romance-long");
    expect(migrated.face).toEqual(legacyDocument.face);
    expect(migrated.hair.style).toBe("long");
    expect(migrated.hair.replaceOriginal).toBe(true);
    expect(migrated.hair.length).toBe(1.3);
    expect(migrated.hair.shine).toBe(0.68);
    expect(migrated.hair.baseColor).toBe("#2c253f");
    expect(migrated.faceAccents?.find((accent) => accent.id === "blush")).toEqual({
      id: "blush", enabled: true, color: "#ef8f9d", intensity: 0.35,
    });

    // v2 필드는 "v1과 같은 렌더"를 보장하는 값으로 승격된다.
    expect(migrated.version).toBe(AVATAR_FORGE_VERSION);
    expect(migrated.hair.bangStyle).toBe("full");
    expect(migrated.hair.wave).toBe(0);
    expect(migrated.hair.ahoge).toBe(0);
    expect(migrated.hair.tailHeight).toBe(0.5);

    // 그리고 실제 지오메트리도 v1 프리셋 계획과 동일하다.
    expect(digest(buildAvatarForgeHairParts(migrated))).toBe(V1_GEOMETRY_DIGESTS["preset:romance-long"]);
  });

  it("버전이 없거나 1인 문서에 v2 키가 섞여 있으면 방어적으로 무시한다", () => {
    const poisoned = {
      version: 1,
      hair: { style: "ponytail", bangStyle: "blunt", wave: 0.9, ahoge: 1, tailHeight: 0.95 },
    };
    const migrated = sanitizeAvatarForgeState(poisoned);
    expect(migrated.hair.bangStyle).toBe("full");
    expect(migrated.hair.wave).toBe(0);
    expect(migrated.hair.ahoge).toBe(0);
    expect(migrated.hair.tailHeight).toBe(0.5);
    expect(digest(buildAvatarForgeHairParts(migrated))).toBe(V1_GEOMETRY_DIGESTS["style:ponytail"]);

    // 버전 필드가 아예 없는 문서도 같은 취급.
    const versionless = sanitizeAvatarForgeState({ hair: { style: "bun", wave: 1, ahoge: 1 } });
    expect(digest(buildAvatarForgeHairParts(versionless))).toBe(V1_GEOMETRY_DIGESTS["style:bun"]);
  });

  it("v2 문서에서는 신규 필드가 살아남는다", () => {
    const roundTripped = parseAvatarForgeState(
      JSON.stringify(
        serializeAvatarForgeState({
          version: AVATAR_FORGE_VERSION,
          hair: { style: "wavy", bangStyle: "curtain", wave: 0.8, ahoge: 0.4, tailHeight: 0.9 },
        })
      )
    );
    expect(roundTripped.hair.bangStyle).toBe("curtain");
    expect(roundTripped.hair.wave).toBe(0.8);
    expect(roundTripped.hair.ahoge).toBe(0.4);
    expect(roundTripped.hair.tailHeight).toBe(0.9);
  });

  it("기본 파라미터에서는 파츠에 wave 키 자체가 없다(바이트 동일성의 근거)", () => {
    for (const style of V1_STYLES) {
      for (const part of buildAvatarForgeHairParts(styleState(style))) {
        expect("wave" in part).toBe(false);
        expect("waveFrequency" in part).toBe(false);
      }
    }
  });
});

/* ── v3 체형 실루엣 → v4 관절 비율 ─────────────────────────────────────── */

describe("v3 체형 실루엣", () => {
  it("v1·v2 문서는 새 체형 키를 신뢰하지 않고 원본 비율로 안전하게 승격한다", () => {
    for (const version of [1, 2]) {
      const restored = sanitizeAvatarForgeState({
        version,
        bodyPresetId: "hero",
        body: {
          shoulderWidth: 1.14,
          torsoLength: 1.12,
          hipWidth: 1.12,
          armLength: 1.1,
          legLength: 1.12,
        },
      });

      expect(restored.body).toEqual({
        shoulderWidth: 1,
        torsoLength: 1,
        hipWidth: 1,
        armLength: 1,
        legLength: 1,
      });
      expect(restored.bodyPresetId).toBeUndefined();
    }
  });

  it("v3 체형을 한계값 안으로 정규화하고 직렬화 왕복에서 보존한다", () => {
    const serialized = serializeAvatarForgeState({
      version: AVATAR_FORGE_VERSION,
      bodyPresetId: "long-line",
      body: {
        shoulderWidth: 9,
        torsoLength: "1.06",
        hipWidth: -2,
        armLength: 1.05,
        legLength: Number.NaN,
      },
    });

    expect(serialized.body).toEqual({
      shoulderWidth: AVATAR_FORGE_BODY_LIMITS.shoulderWidth.max,
      torsoLength: 1.06,
      hipWidth: AVATAR_FORGE_BODY_LIMITS.hipWidth.min,
      armLength: 1.05,
      legLength: 1,
    });
    expect(serialized.bodyPresetId).toBe("long-line");
    expect(parseAvatarForgeState(JSON.stringify(serialized))).toEqual(serialized);
  });

  it("체형 프리셋은 결정론적이고 얼굴·헤어·색상 디테일을 보존한다", () => {
    const source = createAvatarForgeState("wave-diva");
    const first = applyAvatarForgeBodyPreset(source, "hero");
    const second = applyAvatarForgeBodyPreset(source, "hero");

    expect(AVATAR_FORGE_BODY_PRESETS).toHaveLength(5);
    expect(first).toEqual(second);
    expect(first.bodyPresetId).toBe("hero");
    expect(first.presetId).toBeUndefined();
    expect(first.body).toEqual(
      AVATAR_FORGE_BODY_PRESETS.find((preset) => preset.id === "hero")?.body,
    );
    expect(first.face).toEqual(source.face);
    expect(first.hair).toEqual(source.hair);
    expect(first.faceAccents).toEqual(source.faceAccents);
    expect(first.body).not.toBe(
      AVATAR_FORGE_BODY_PRESETS.find((preset) => preset.id === "hero")?.body,
    );
  });

  it("본 조정 계획은 폭과 길이를 구분해 유한하고 중복 없는 본만 만든다", () => {
    const body = applyAvatarForgeBodyPreset(createAvatarForgeState(), "hero").body;
    const first = buildAvatarForgeBodyAdjustmentPlan(body);
    const second = buildAvatarForgeBodyAdjustmentPlan(body);
    const byBone = new Map(first.map((entry) => [entry.bone, entry]));

    expect(first).toEqual(second);
    expect(new Set(first.map((entry) => entry.bone)).size).toBe(first.length);
    expect(byBone.get("chest")?.scaleMultiplier).toEqual([body.shoulderWidth, 1, 1]);
    expect(byBone.get("hips")?.scaleMultiplier).toEqual([body.hipWidth, 1, 1]);
    expect(byBone.get("leftHand")?.positionMultiplier).toEqual([
      body.armLength,
      body.armLength,
      body.armLength,
    ]);
    expect(byBone.get("leftFoot")?.positionMultiplier).toEqual([
      body.legLength,
      body.legLength,
      body.legLength,
    ]);
    expect(first.flatMap((entry) => [
      ...entry.positionMultiplier,
      ...entry.scaleMultiplier,
    ]).every(Number.isFinite)).toBe(true);
  });
});

/* ── v4 canonical proportion state ──────────────────────────────────────── */

describe("v4 canonical proportion state", () => {
  it("v1·v2의 중립 비율을 보존하고 v3의 네 호환 컨트롤만 관절 비율로 승격한다", () => {
    for (const version of [1, 2]) {
      const migrated = sanitizeAvatarForgeState({
        version,
        body: {
          shoulderWidth: 1.14,
          torsoLength: 1.12,
          hipWidth: 1.12,
          armLength: 1.1,
          legLength: 1.12,
        },
      });
      expect(migrated.proportions).toEqual(NEUTRAL_STUDIO_VRM_PROPORTIONS);
      expect(migrated.legacyHipWidth).toBeUndefined();
    }

    const migrated = sanitizeAvatarForgeState({
      version: 3,
      bodyPresetId: "hero",
      body: {
        shoulderWidth: 1.1,
        torsoLength: 1.06,
        hipWidth: 1.08,
        armLength: 1.04,
        legLength: 1.07,
      },
    });

    expect(migrated.proportions).toEqual({
      ...NEUTRAL_STUDIO_VRM_PROPORTIONS,
      shoulderWidth: 1.1,
      torsoLength: 1.06,
      armLength: 1.04,
      legLength: 1.07,
    });
    expect(migrated.bodyPresetId).toBe("hero");
    expect(migrated.legacyHipWidth).toBe(1.08);
  });

  it("v3 얼굴·헤어·색상·악센트를 보존하며 결정적인 v4 문서로 마이그레이션한다", () => {
    const source = createAvatarForgeState("wave-diva");
    const legacyDocument = {
      version: 3,
      presetId: source.presetId,
      bodyPresetId: "soft",
      face: { ...source.face, headDepth: 1.08, cheekVolume: 0.58 },
      body: {
        shoulderWidth: 0.94,
        torsoLength: 0.99,
        hipWidth: 1.08,
        armLength: 0.98,
        legLength: 0.99,
      },
      hair: {
        ...source.hair,
        replaceOriginal: true,
        shine: 0.73,
        baseColor: "#123456",
        tipColor: "#abcdef",
      },
      faceAccents: source.faceAccents?.map((accent) =>
        accent.id === "beauty-mark"
          ? { ...accent, enabled: true, color: "#112233", intensity: 0.82 }
          : { ...accent },
      ),
    };

    const first = sanitizeAvatarForgeState(legacyDocument);
    const second = sanitizeAvatarForgeState(legacyDocument);

    expect(first).toEqual(second);
    expect(first.face).toEqual(legacyDocument.face);
    expect(first.hair).toEqual(legacyDocument.hair);
    expect(first.faceAccents).toEqual(legacyDocument.faceAccents);
    expect(first.proportions.shoulderWidth).toBe(0.94);
    expect(first.proportions.torsoLength).toBe(0.99);
    expect(first.proportions.armLength).toBe(0.98);
    expect(first.proportions.legLength).toBe(0.99);
    expect(first.legacyHipWidth).toBe(1.08);
    expect(stateDigest(first)).toBe(
      "626bd75bd6c47cd9676a1cdb09a0506d0740d9b343d6ced9b888b2992eec8b49",
    );
  });

  it("hipWidth는 코어 비율로 가장하지 않고 v3 메타데이터로만 보존한다", () => {
    const narrow = migrateAvatarForgeBodyToStudioVrmProportions({
      shoulderWidth: 1.03,
      torsoLength: 1.04,
      hipWidth: 0.9,
      armLength: 1.05,
      legLength: 1.06,
    });
    const wide = migrateAvatarForgeBodyToStudioVrmProportions({
      shoulderWidth: 1.03,
      torsoLength: 1.04,
      hipWidth: 1.12,
      armLength: 1.05,
      legLength: 1.06,
    });
    const migrated = sanitizeAvatarForgeState({
      version: 3,
      body: {
        shoulderWidth: 1.03,
        torsoLength: 1.04,
        hipWidth: 1.12,
        armLength: 1.05,
        legLength: 1.06,
      },
    });

    expect(narrow).toEqual(wide);
    expect("hipWidth" in migrated.proportions).toBe(false);
    expect(migrated.legacyHipWidth).toBe(1.12);
    expect(migrated.body.hipWidth).toBe(1.12);
  });

  it("v4 정규화·JSON 왕복은 멱등이고 손상되거나 누락된 입력은 안전한 중립으로 복구한다", () => {
    const resolved = sanitizeAvatarForgeState({
      version: AVATAR_FORGE_VERSION,
      proportions: {
        version: 999,
        presetId: " custom ",
        overallHeight: "1.23",
        headBodyRatio: 1.4,
        armLength: 0.71,
        legLength: 1.42,
        torsoLength: 0.81,
        shoulderWidth: 1.22,
        handScale: 1.3,
        footScale: 0.8,
        neckLength: 1.5,
        unknown: "discard",
      },
      legacyHipWidth: 1.09,
      hair: { style: "hime", baseColor: "#112233", tipColor: "#445566" },
    });

    expect(sanitizeAvatarForgeState(resolved)).toEqual(resolved);
    expect(parseAvatarForgeState(JSON.stringify(resolved))).toEqual(resolved);
    expect(resolved.proportions.presetId).toBe("custom");
    expect("unknown" in resolved.proportions).toBe(false);

    const corrupt = sanitizeAvatarForgeState({
      version: AVATAR_FORGE_VERSION,
      proportions: {
        overallHeight: Number.POSITIVE_INFINITY,
        headBodyRatio: false,
        armLength: [],
        legLength: null,
        torsoLength: {},
      },
    });
    expect(corrupt.proportions).toEqual(NEUTRAL_STUDIO_VRM_PROPORTIONS);
    expect(sanitizeAvatarForgeState({ version: AVATAR_FORGE_VERSION }).proportions).toEqual(
      NEUTRAL_STUDIO_VRM_PROPORTIONS,
    );
    expect(parseAvatarForgeState("{broken").proportions).toEqual(
      NEUTRAL_STUDIO_VRM_PROPORTIONS,
    );
  });

  it("3–9두신 비율 프리셋을 canonical state에서 손실 없이 받는다", () => {
    expect(STUDIO_VRM_PROPORTION_PRESETS.map((preset) => preset.targetHeadUnits)).toEqual([
      8, 7, 6, 5, 4, 3, 9,
    ]);
    for (const preset of STUDIO_VRM_PROPORTION_PRESETS) {
      const resolved = sanitizeAvatarForgeState({
        version: AVATAR_FORGE_VERSION,
        proportions: preset.proportions,
      });
      expect(resolved.proportions).toEqual(preset.proportions);
      expect(resolved.proportions.presetId).toBe(preset.id);
    }
  });

  it("체형 프리셋은 나머지 canonical 비율을 보존하고 대응하는 네 관절 컨트롤만 바꾼다", () => {
    const source = sanitizeAvatarForgeState({
      version: AVATAR_FORGE_VERSION,
      proportions: STUDIO_VRM_PROPORTION_PRESETS.find(
        (preset) => preset.id === "sd-chibi-3",
      )?.proportions,
    });
    const applied = applyAvatarForgeBodyPreset(source, "hero");
    const hero = AVATAR_FORGE_BODY_PRESETS.find((preset) => preset.id === "hero")?.body;

    expect(applied.proportions.presetId).toBeUndefined();
    expect(applied.proportions.overallHeight).toBe(source.proportions.overallHeight);
    expect(applied.proportions.headBodyRatio).toBe(source.proportions.headBodyRatio);
    expect(applied.proportions.handScale).toBe(source.proportions.handScale);
    expect(applied.proportions.footScale).toBe(source.proportions.footScale);
    expect(applied.proportions.neckLength).toBe(source.proportions.neckLength);
    expect(applied.proportions.shoulderWidth).toBe(hero?.shoulderWidth);
    expect(applied.proportions.torsoLength).toBe(hero?.torsoLength);
    expect(applied.proportions.armLength).toBe(hero?.armLength);
    expect(applied.proportions.legLength).toBe(hero?.legLength);
    expect(applied.legacyHipWidth).toBe(hero?.hipWidth);
    expect(applied.body.hipWidth).toBe(hero?.hipWidth);
  });
});

/* ── v2 신규 헤어 스타일 ───────────────────────────────────────────────── */

describe("v2 신규 헤어 스타일", () => {
  it("스타일 카탈로그가 14종으로 늘고 id가 중복되지 않는다", () => {
    expect(AVATAR_FORGE_HAIR_STYLE_OPTIONS).toHaveLength(14);
    const ids = AVATAR_FORGE_HAIR_STYLE_OPTIONS.map((option) => option.id);
    expect(new Set(ids).size).toBe(14);
    for (const style of V2_STYLES) expect(ids).toContain(style);
    // 힌트·이모지가 비어 있으면 UI에서 구분이 안 된다.
    for (const option of AVATAR_FORGE_HAIR_STYLE_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.emoji.length).toBeGreaterThan(0);
      expect(option.hint.length).toBeGreaterThan(0);
    }
  });

  it("모든 스타일이 서로 다른 파츠 구성을 만든다", () => {
    const seen = new Map<string, AvatarForgeHairStyle>();
    for (const style of ALL_STYLES) {
      if (style === "none") continue;
      const key = digest(buildAvatarForgeHairParts(styleState(style)));
      expect(seen.has(key), `${style} duplicates ${seen.get(key)}`).toBe(false);
      seen.set(key, style);
    }
    expect(seen.size).toBe(13);
  });

  it("웨이브 롱은 기본에서도 웨이브 파츠를 갖고 wave 파라미터가 진폭을 키운다", () => {
    const calm = buildAvatarForgeHairParts(styleState("wavy"));
    const wild = buildAvatarForgeHairParts(styleState("wavy", { wave: 1 }));

    const calmStrand = partById(calm, "wavy-inner-left");
    const wildStrand = partById(wild, "wavy-inner-left");
    expect(calmStrand.wave).toBeCloseTo(0.45, 10);
    expect(wildStrand.wave).toBeCloseTo(1, 10);
    expect(wildStrand.wave!).toBeGreaterThan(calmStrand.wave!);
    expect(calmStrand.waveFrequency).toBe(2.9);

    // 웨이브가 붙는 파츠는 5개 중 4개(등판 볼륨 ellipsoid는 제외).
    expect(calm.filter((part) => part.wave !== undefined)).toHaveLength(4);
    expect(partById(calm, "wavy-back").wave).toBeUndefined();
  });

  it("wave 파라미터는 기존 스타일의 가닥에도 적용되고 0이면 흔적이 없다", () => {
    const straight = buildAvatarForgeHairParts(styleState("long"));
    const waved = buildAvatarForgeHairParts(styleState("long", { wave: 0.6 }));

    expect(partById(straight, "side-left").wave).toBeUndefined();
    expect(partById(waved, "side-left").wave).toBe(0.6);
    expect(partById(waved, "side-left").waveFrequency).toBe(2.4);
    // 위치·스케일은 그대로 — wave는 렌더 시 축 변형만 준다.
    expect(partById(waved, "side-left").scale).toEqual(partById(straight, "side-left").scale);
  });

  it("땋은 머리는 마디 수가 길이에서 결정론적으로 유도된다", () => {
    expect(avatarForgeBraidSegmentCount(0.55)).toBe(5);
    expect(avatarForgeBraidSegmentCount(1)).toBe(6);
    expect(avatarForgeBraidSegmentCount(1.7)).toBe(8);
    expect(avatarForgeBraidSegmentCount(Number.NaN)).toBe(6);

    const short = buildAvatarForgeHairParts(styleState("braid", { length: 0.55 }));
    const long = buildAvatarForgeHairParts(styleState("braid", { length: 1.7 }));
    const countSegments = (parts: AvatarForgeHairPart[]) => parts.filter((part) => part.role === "braid").length;

    expect(countSegments(short)).toBe(5);
    expect(countSegments(long)).toBe(8);
    // 마디는 위에서 아래로 단조 감소하고, 굵기도 끝으로 갈수록 얇아진다.
    const segments = long.filter((part) => part.role === "braid");
    for (let index = 1; index < segments.length; index += 1) {
      expect(segments[index].position[1]).toBeLessThan(segments[index - 1].position[1]);
      expect(segments[index].scale[0]).toBeLessThan(segments[index - 1].scale[0]);
    }
    // 묶음 매듭 1개 + 목덜미 볼륨 1개가 함께 나온다.
    expect(long.filter((part) => part.id === "braid-tie")).toHaveLength(1);
    expect(long.filter((part) => part.id === "braid-nape")).toHaveLength(1);
  });

  it("양갈래 땋기는 좌우 대칭이다", () => {
    const parts = buildAvatarForgeHairParts(styleState("twin-braid"));
    const left = parts.filter((part) => part.id.startsWith("braid-left-"));
    const right = parts.filter((part) => part.id.startsWith("braid-right-"));
    expect(left).toHaveLength(right.length);
    expect(left.length).toBeGreaterThanOrEqual(6);
    for (let index = 0; index < left.length; index += 1) {
      // 거울 대칭: x는 부호 반전, y/z·스케일은 동일, z회전은 부호 반전.
      expect(right[index].position[0]).toBeCloseTo(-left[index].position[0], 12);
      expect(right[index].position[1]).toBeCloseTo(left[index].position[1], 12);
      expect(right[index].position[2]).toBeCloseTo(left[index].position[2], 12);
      expect(right[index].rotation[2]).toBeCloseTo(-left[index].rotation[2], 12);
      expect(right[index].scale).toEqual(left[index].scale);
    }
    expect(partById(parts, "braid-left-tie").position[0]).toBeCloseTo(-0.42, 12);
    expect(partById(parts, "braid-right-tie").position[0]).toBeCloseTo(0.42, 12);
  });

  it("히메컷은 뭉툭한 사이드락(taper≈0)과 긴 뒷머리를 갖는다", () => {
    const parts = buildAvatarForgeHairParts(styleState("hime"));
    expect(partById(parts, "hime-lock-left").taper).toBeLessThan(0.1);
    expect(partById(parts, "hime-lock-right").taper).toBeLessThan(0.1);
    expect(partById(parts, "hime-back").scale[1]).toBeGreaterThan(partById(parts, "hime-lock-left").scale[1] * 2);
  });

  it("울프컷은 목덜미 가닥만 길고 옆머리는 짧다", () => {
    const parts = buildAvatarForgeHairParts(styleState("wolf"));
    expect(partById(parts, "wolf-nape-center").scale[1]).toBeGreaterThan(
      partById(parts, "wolf-side-left").scale[1] * 2
    );
    expect(parts.filter((part) => part.role === "tail")).toHaveLength(3);
    // 울프컷은 윗머리에 볼륨을 주므로 캡이 기본보다 크다.
    expect(partById(parts, "cap").scale[0]).toBeGreaterThan(partById(buildAvatarForgeHairParts(styleState("long")), "cap").scale[0]);
  });

  it("픽시는 가장 적은 파츠와 가장 작은 캡을 갖는다", () => {
    const pixie = buildAvatarForgeHairParts(styleState("pixie"));
    const long = buildAvatarForgeHairParts(styleState("long"));
    expect(partById(pixie, "cap").scale[1]).toBeLessThan(partById(long, "cap").scale[1]);
    expect(partById(pixie, "pixie-nape").scale[1]).toBeLessThan(partById(long, "back").scale[1]);
  });

  it("반묶음은 묶음 매듭과 흘러내린 뒷머리를 함께 만든다", () => {
    const parts = buildAvatarForgeHairParts(styleState("half-up"));
    expect(partById(parts, "halfup-knot").role).toBe("bun");
    expect(partById(parts, "halfup-back").role).toBe("back");
    expect(parts.filter((part) => part.role === "side")).toHaveLength(2);
  });
});

/* ── v2 파라미터 효과 ──────────────────────────────────────────────────── */

describe("v2 파라미터 효과", () => {
  it("앞머리 형태 6종이 모두 다른 앞머리 파츠를 만든다", () => {
    expect(AVATAR_FORGE_BANG_STYLE_OPTIONS).toHaveLength(6);
    const seen = new Map<string, string>();
    for (const option of AVATAR_FORGE_BANG_STYLE_OPTIONS) {
      const bangs = buildAvatarForgeHairParts(styleState("bob", { bangStyle: option.id })).filter(
        (part) => part.role === "bang"
      );
      const key = JSON.stringify(bangs);
      expect(seen.has(key), `${option.id} duplicates ${seen.get(key)}`).toBe(false);
      seen.set(key, option.id);
    }

    const counts = Object.fromEntries(
      AVATAR_FORGE_BANG_STYLE_OPTIONS.map((option) => [
        option.id,
        buildAvatarForgeHairParts(styleState("bob", { bangStyle: option.id })).filter((part) => part.role === "bang")
          .length,
      ])
    );
    expect(counts).toEqual({ full: 3, split: 4, "side-swept": 3, curtain: 4, blunt: 5, none: 0 });
  });

  it("일자뱅은 5가닥이 균등 간격으로 놓이고 끝이 뭉툭하다", () => {
    const bangs = buildAvatarForgeHairParts(styleState("bob", { bangStyle: "blunt" })).filter(
      (part) => part.role === "bang"
    );
    const xs = bangs.map((part) => part.position[0]);
    expect(xs).toEqual([-0.24, -0.12, 0, 0.12, 0.24]);
    for (const part of bangs) expect(part.taper).toBeLessThan(0.1);
  });

  it("fringe 파라미터가 앞머리 길이를 모든 형태에서 늘린다", () => {
    for (const option of AVATAR_FORGE_BANG_STYLE_OPTIONS) {
      if (option.id === "none") continue;
      const short = buildAvatarForgeHairParts(styleState("bob", { bangStyle: option.id, fringe: 0.2 }));
      const long = buildAvatarForgeHairParts(styleState("bob", { bangStyle: option.id, fringe: 1.35 }));
      const shortBang = short.filter((part) => part.role === "bang")[0];
      const longBang = long.filter((part) => part.role === "bang")[0];
      expect(longBang.scale[1]).toBeGreaterThan(shortBang.scale[1]);
    }
  });

  it("tailHeight 0.5는 v1 위치이고, 올리면 묶음이 실제로 올라간다", () => {
    const base = buildAvatarForgeHairParts(styleState("ponytail"));
    const high = buildAvatarForgeHairParts(styleState("ponytail", { tailHeight: 1 }));
    const low = buildAvatarForgeHairParts(styleState("ponytail", { tailHeight: 0 }));

    expect(partById(base, "pony-root").position[1]).toBe(0.13);
    expect(partById(high, "pony-root").position[1]).toBeCloseTo(0.13 + 0.28, 10);
    expect(partById(low, "pony-root").position[1]).toBeCloseTo(0.13 - 0.28, 10);
    expect(partById(high, "pony-tail").position[1]).toBeGreaterThan(partById(low, "pony-tail").position[1]);
    // 높이 올릴수록 꼬리가 뒤로 덜 눕는다.
    expect(partById(high, "pony-tail").rotation[0]).toBeGreaterThan(partById(low, "pony-tail").rotation[0]);
  });

  it("tailHeight는 트윈테일·번·반묶음·땋기에도 함께 적용된다", () => {
    for (const style of ["twintail", "bun", "half-up", "braid"] as const) {
      const low = buildAvatarForgeHairParts(styleState(style, { tailHeight: 0.1 }));
      const high = buildAvatarForgeHairParts(styleState(style, { tailHeight: 0.9 }));
      const anchorId =
        style === "twintail" ? "twin-left" : style === "bun" ? "bun" : style === "half-up" ? "halfup-knot" : "braid-tie";
      expect(partById(high, anchorId).position[1]).toBeGreaterThan(partById(low, anchorId).position[1]);
    }
  });

  it("ahoge는 0이면 파츠가 없고, 키우면 길어지며 캡 위에 놓인다", () => {
    const none = buildAvatarForgeHairParts(styleState("short"));
    expect(none.some((part) => part.role === "ahoge")).toBe(false);

    const small = partById(buildAvatarForgeHairParts(styleState("short", { ahoge: 0.2 })), "ahoge");
    const big = partById(buildAvatarForgeHairParts(styleState("short", { ahoge: 1 })), "ahoge");
    expect(big.scale[1]).toBeGreaterThan(small.scale[1]);
    expect(big.wave!).toBeGreaterThan(small.wave!);

    const cap = partById(buildAvatarForgeHairParts(styleState("short", { ahoge: 1 })), "cap");
    expect(big.position[1]).toBeGreaterThan(cap.position[1] + cap.scale[1]);
  });

  it("ahoge는 모든 스타일에 붙는다(none 제외)", () => {
    for (const style of ALL_STYLES) {
      const parts = buildAvatarForgeHairParts(styleState(style, { ahoge: 0.7 }));
      expect(parts.filter((part) => part.role === "ahoge")).toHaveLength(style === "none" ? 0 : 1);
    }
  });

  it("volume·length·strandWidth는 문서대로 각각 캡·기장·굵기를 움직인다", () => {
    const thin = buildAvatarForgeHairParts(styleState("long", { volume: 0.72, length: 0.55, strandWidth: 0.68 }));
    const thick = buildAvatarForgeHairParts(styleState("long", { volume: 1.45, length: 1.7, strandWidth: 1.45 }));

    expect(partById(thick, "cap").scale[0]).toBeCloseTo(partById(thin, "cap").scale[0] * (1.45 / 0.72), 10);
    expect(partById(thick, "side-left").scale[1]).toBeCloseTo(partById(thin, "side-left").scale[1] * (1.7 / 0.55), 10);
    expect(partById(thick, "side-left").scale[0]).toBeCloseTo(partById(thin, "side-left").scale[0] * (1.45 / 0.68), 10);
  });

  it("새 파라미터도 한계값 밖 입력을 잘라낸다", () => {
    const clamped = sanitizeAvatarForgeState({
      version: AVATAR_FORGE_VERSION,
      hair: { style: "wavy", bangStyle: "not-a-bang", wave: 9, ahoge: -3, tailHeight: "0.7" },
    });
    expect(clamped.hair.bangStyle).toBe("full");
    expect(clamped.hair.wave).toBe(AVATAR_FORGE_HAIR_LIMITS.wave.max);
    expect(clamped.hair.ahoge).toBe(AVATAR_FORGE_HAIR_LIMITS.ahoge.min);
    expect(clamped.hair.tailHeight).toBe(0.7);
  });

  it("신규 프리셋이 신규 스타일을 실제로 사용한다", () => {
    const styles = new Set(AVATAR_FORGE_PRESETS.map((preset) => preset.state.hair.style));
    for (const style of V2_STYLES) expect(styles.has(style)).toBe(true);
    expect(AVATAR_FORGE_PRESETS.length).toBe(21);
    expect(new Set(AVATAR_FORGE_PRESETS.map((preset) => preset.id)).size).toBe(21);
  });

  it("모든 프리셋이 정상 상태로 복원된다", () => {
    for (const preset of AVATAR_FORGE_PRESETS) {
      const restored = createAvatarForgeState(preset.id);
      expect(restored.presetId).toBe(preset.id);
      expect(restored.hair.style).toBe(preset.state.hair.style);
      expect(buildAvatarForgeHairParts(restored).length).toBeGreaterThan(0);
      expect(digest(buildAvatarForgeHairParts(restored))).toBe(digest(buildAvatarForgeHairParts(preset.state)));
    }
  });
});
