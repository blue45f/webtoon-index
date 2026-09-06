import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { AVATAR_FORGE_PRESETS, createAvatarForgeState } from "./studio-vrm-avatar-forge";
import { STUDIO_VRM_EXPORT_REQUIRED_BONES } from "./studio-vrm-export-vrm-extension";
import {
  inspectGeneratedVrmHumanoid,
  reloadGeneratedVrmAsHumanoid,
} from "./studio-vrm-generate-inspect";
import {
  createUnavailableStudioVrmGenerateMcpHost,
  generateStudioVrmCharacter,
  resolveStudioVrmGenerateMcpHost,
} from "./studio-vrm-generate-mcp";
import {
  buildStudioVrmGenerateAuthoringSnapshot,
  createStudioVrmGenerateRecipe,
  exportStudioVrmFromGenerateRecipe,
  resolveStudioVrmGenerateSeed,
  STUDIO_VRM_GENERATE_DEFAULT_PRESET_ID,
} from "./studio-vrm-generate-recipe";
import { STUDIO_VRM_RIG_BONES } from "./studio-vrm-humanoid-rig";
import { readStudioVrmPoserImplementationSource } from "./studio-vrm-poser-implementation-source";
import { validateVrmGlbBytes } from "./vrm-library";

import type { StudioVrmExportSceneSnapshot } from "./studio-vrm-export-plan";

const PRESET_A = "natural-short";
const PRESET_B = "romance-long";

describe("studio VRM generate surface wiring", () => {
  it("exposes generate/export controls on the shipped Avatar Forge panel and Poser import path", () => {
    const panel = readFileSync(new URL("./StudioVrmAvatarForgePanel.tsx", import.meta.url), "utf8");
    const poser = readStudioVrmPoserImplementationSource();
    expect(panel).toContain("data-studio-vrm-generate");
    expect(panel).toContain("data-studio-vrm-generate-submit");
    expect(panel).toContain("data-studio-vrm-generate-export");
    expect(panel).toContain("generateStudioVrmCharacter");
    expect(poser).toContain("onGeneratedFile=");
    expect(poser).toContain("handleGeneratedVrmFile");
  });
});

describe("studio VRM generate recipe", () => {
  it("builds distinct authoring snapshots from two shipped presets", () => {
    expect(AVATAR_FORGE_PRESETS.some((preset) => preset.id === PRESET_A)).toBe(true);
    expect(AVATAR_FORGE_PRESETS.some((preset) => preset.id === PRESET_B)).toBe(true);

    const recipeA = createStudioVrmGenerateRecipe({ presetId: PRESET_A });
    const recipeB = createStudioVrmGenerateRecipe({ presetId: PRESET_B });
    expect(recipeA.presetId).toBe(PRESET_A);
    expect(recipeB.presetId).toBe(PRESET_B);
    expect(recipeA.label).not.toBe(recipeB.label);
    expect(recipeA.state.hair.baseColor).not.toBe(recipeB.state.hair.baseColor);

    const snapshotA = buildStudioVrmGenerateAuthoringSnapshot(recipeA);
    const snapshotB = buildStudioVrmGenerateAuthoringSnapshot(recipeB);
    expect(snapshotA.meta.name).toBe(recipeA.label);
    expect(snapshotB.meta.name).toBe(recipeB.label);
    // 피부 톤은 조형 상태에 파라미터가 없어 두 프리셋이 같은 값을 공유한다. 프리셋을
    // 가르는 것은 헤어(와 거기서 파생된 의상) 색이므로, 그 머티리얼로 구분을 확인한다.
    const hairMaterial = (snapshot: StudioVrmExportSceneSnapshot) =>
      snapshot.materials?.find((material) => material.name === "Hair");
    expect(hairMaterial(snapshotA)?.baseColorFactor).toBeDefined();
    expect(hairMaterial(snapshotA)?.baseColorFactor).not.toEqual(
      hairMaterial(snapshotB)?.baseColorFactor,
    );
    expect(snapshotA.materials?.[0]?.name).toBe("Skin");
    expect(snapshotA.materials?.[0]?.baseColorFactor).toEqual(
      snapshotB.materials?.[0]?.baseColorFactor,
    );
    expect(snapshotA.nodes[3]?.name).toBe("head");
    expect(snapshotA.nodes[3]?.scale).not.toEqual(snapshotB.nodes[3]?.scale);
  });
});

describe("studio VRM generate default preset", () => {
  it("substitutes the default preset only for the untouched state", () => {
    // 조형 상태의 기본 헤어는 "none" 이다 — 오버레이에서는 옳지만 생성에서는 대머리가 된다.
    expect(createAvatarForgeState().hair.style).toBe("none");

    const seed = resolveStudioVrmGenerateSeed({ state: createAvatarForgeState() });
    expect(seed.appliedDefaultPresetId).toBe(STUDIO_VRM_GENERATE_DEFAULT_PRESET_ID);
    expect(seed.presetId).toBe(STUDIO_VRM_GENERATE_DEFAULT_PRESET_ID);
    expect(seed.state.hair.style).not.toBe("none");

    // 입력을 아예 주지 않은 경우도 같다(CLI 의 --preset 미지정).
    expect(resolveStudioVrmGenerateSeed().appliedDefaultPresetId).toBe(
      STUDIO_VRM_GENERATE_DEFAULT_PRESET_ID,
    );
  });

  it("respects an explicitly chosen preset", () => {
    const seed = resolveStudioVrmGenerateSeed({ presetId: PRESET_B });
    expect(seed.appliedDefaultPresetId).toBeNull();
    expect(seed.presetId).toBe(PRESET_B);
  });

  it("respects a deliberate bald character — the user changed something else", () => {
    // 프리셋을 고른 뒤 머리를 지운 상태. presetId 가 남아 있으므로 순정이 아니다.
    const shaved = { ...createAvatarForgeState(PRESET_A), hair: { ...createAvatarForgeState(PRESET_A).hair, style: "none" as const } };
    const seed = resolveStudioVrmGenerateSeed({ state: shaved });
    expect(seed.appliedDefaultPresetId).toBeNull();
    expect(seed.state.hair.style).toBe("none");

    // 프리셋 없이 슬라이더만 움직인 뒤 머리를 지운 상태도 존중한다.
    const base = createAvatarForgeState();
    const tweaked = {
      ...base,
      proportions: { ...base.proportions, legLength: 1.22 },
    };
    const tweakedSeed = resolveStudioVrmGenerateSeed({ state: tweaked });
    expect(tweakedSeed.appliedDefaultPresetId).toBeNull();
    expect(tweakedSeed.state.hair.style).toBe("none");
    expect(tweakedSeed.state.proportions.legLength).toBeCloseTo(1.22, 6);
  });

  it("honours an explicit no-hair choice the state cannot express", () => {
    // 기본 헤어가 이미 "없음"이라, 목록에서 "없음"을 눌러도 상태는 순정과 똑같다.
    // 그 선택은 UI 만 알 수 있으므로 플래그로 전달받는다.
    const seed = resolveStudioVrmGenerateSeed({
      state: createAvatarForgeState(),
      allowDefaultPreset: false,
    });
    expect(seed.appliedDefaultPresetId).toBeNull();
    expect(seed.state.hair.style).toBe("none");

    const snapshot = buildStudioVrmGenerateAuthoringSnapshot(
      createStudioVrmGenerateRecipe({ allowDefaultPreset: false }),
    );
    expect(snapshot.meshes?.some((mesh) => mesh.name === "Hair")).toBe(false);
  });

  it("gives the untouched state a hairy, named character instead of a bald custom one", () => {
    const recipe = createStudioVrmGenerateRecipe({});
    expect(recipe.label).not.toBe("커스텀 캐릭터");
    expect(recipe.appliedDefaultPresetId).toBe(STUDIO_VRM_GENERATE_DEFAULT_PRESET_ID);
    const snapshot = buildStudioVrmGenerateAuthoringSnapshot(recipe);
    expect(snapshot.meshes?.some((mesh) => mesh.name === "Hair")).toBe(true);
  });

  it("tells the user in the panel when the default preset stands in", () => {
    const panel = readFileSync(new URL("./StudioVrmAvatarForgePanel.tsx", import.meta.url), "utf8");
    expect(panel).toContain("data-studio-vrm-generate-default-preset");
    // 미리보기 스와치는 편집 상태가 아니라 실제 생성될 상태를 읽어야 한다.
    expect(panel).toContain("previewRecipe.state.hair.baseColor");
  });
});

describe("studio VRM generate blink overrides", () => {
  it("stops eye-moving emotions from stacking their morphs on top of blink", () => {
    const snapshot = buildStudioVrmGenerateAuthoringSnapshot(
      createStudioVrmGenerateRecipe({ presetId: PRESET_A }),
    );
    const preset = snapshot.expressions?.preset ?? {};

    // 표정 가중치는 런타임에서 델타로 더해진다. happy(눈을 30%로 접음)와 blink(6%로 접음)를
    // 함께 적용하면 눈꺼풀이 닫히는 게 아니라 아래 가장자리를 지나쳐 뒤집힌다.
    expect(preset.happy?.overrideBlink).toBe("block");
    expect(preset.relaxed?.overrideBlink).toBe("block");
    expect(preset.surprised?.overrideBlink).toBe("block");
    // 눈 변화가 완만한 표정은 세기에 비례해 깜빡임을 줄이기만 한다.
    expect(preset.angry?.overrideBlink).toBe("blend");
    expect(preset.sad?.overrideBlink).toBe("blend");

    // 깜빡임 자체와 입모양·시선에는 오버라이드가 붙지 않는다.
    for (const name of ["blink", "blinkLeft", "blinkRight", "aa", "lookUp"] as const) {
      expect(preset[name]?.overrideBlink, name).toBeUndefined();
    }
  });
});

describe("exportStudioVrmFromGenerateRecipe", () => {
  it("emits valid VRM 1.0 humanoids for two distinct presets", async () => {
    const recipeA = createStudioVrmGenerateRecipe({ presetId: PRESET_A });
    const recipeB = createStudioVrmGenerateRecipe({ presetId: PRESET_B });
    const bytesA = exportStudioVrmFromGenerateRecipe(recipeA);
    const bytesB = exportStudioVrmFromGenerateRecipe(recipeB);

    expect(bytesA.byteLength).toBeGreaterThan(200);
    expect(bytesB.byteLength).toBeGreaterThan(200);
    expect([...bytesA]).not.toEqual([...bytesB]);

    expect(validateVrmGlbBytes(bytesA)).toEqual({ vrmVersion: 1 });
    expect(validateVrmGlbBytes(bytesB)).toEqual({ vrmVersion: 1 });

    const humanoidA = inspectGeneratedVrmHumanoid(bytesA);
    const humanoidB = inspectGeneratedVrmHumanoid(bytesB);
    expect(humanoidA.isCompleteHumanoid).toBe(true);
    expect(humanoidB.isCompleteHumanoid).toBe(true);
    // 리그가 굽는 본 = VRM 이 요구하는 15본 + 손가락 30본. 두 목록은 역할이 다르다.
    expect(humanoidA.humanoidBoneNames).toEqual([...STUDIO_VRM_RIG_BONES].sort());
    for (const required of STUDIO_VRM_EXPORT_REQUIRED_BONES) {
      expect(humanoidA.humanoidBoneNames, `${required} 누락`).toContain(required);
    }

    const reloadedA = await reloadGeneratedVrmAsHumanoid(bytesA);
    const reloadedB = await reloadGeneratedVrmAsHumanoid(bytesB);
    expect(reloadedA.missingBones).toEqual([]);
    expect(reloadedB.missingBones).toEqual([]);
    expect(reloadedA.presentBones).toHaveLength(STUDIO_VRM_EXPORT_REQUIRED_BONES.length);
    expect(reloadedA.name).toBe(recipeA.label);
    expect(reloadedB.name).toBe(recipeB.label);
  });
});

describe("generateStudioVrmCharacter MCP adapter", () => {
  it("fails closed when the generate MCP host is missing", async () => {
    const result = await generateStudioVrmCharacter(
      { presetId: PRESET_A },
      { host: createUnavailableStudioVrmGenerateMcpHost() },
    );
    expect(result).toEqual({
      status: "unavailable",
      code: "vrm_generate_mcp_unavailable",
      message: expect.stringContaining("MCP"),
      hostId: "missing-vrm-generate-mcp",
    });
  });

  it("fails closed when the host env disables generation", async () => {
    const host = resolveStudioVrmGenerateMcpHost({ STUDIO_VRM_GENERATE_MCP: "none" });
    const result = await generateStudioVrmCharacter({ presetId: PRESET_B }, { host });
    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") throw new Error("expected unavailable");
    expect(result.hostId).toBe("disabled-vrm-generate-mcp");
  });

  it("uses the local generate MCP to emit a reloadable humanoid", async () => {
    const result = await generateStudioVrmCharacter({ presetId: PRESET_A });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected generated VRM");
    expect(result.hostId).toBe("toonspectrum-vrm-generate");
    expect(result.vrmVersion).toBe(1);
    expect(result.isCompleteHumanoid).toBe(true);
    expect(validateVrmGlbBytes(result.bytes)).toEqual({ vrmVersion: 1 });
    const reloaded = await reloadGeneratedVrmAsHumanoid(result.bytes);
    expect(reloaded.missingBones).toEqual([]);
    expect(reloaded.name).toBe(result.recipe.label);
  });
});
