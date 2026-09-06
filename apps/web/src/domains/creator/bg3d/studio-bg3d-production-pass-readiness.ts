import { resolveStudioBg3dProductionBatchPreset } from "./studio-bg3d-production-multipass";

import type { StudioBg3dProductionBatchPreset } from "./studio-bg3d-production-multipass";
import type {
  StudioBg3dOutputSettings,
  StudioBg3dToneMode,
  StudioBg3dToneOutputType,
} from "./studio-bg3d-scene-document";
import type { StudioBg3dShotBatchPass } from "./studio-bg3d-shot-batch-pass-catalog";

export interface StudioBg3dProductionLookState {
  readonly lineEnabled: boolean;
  readonly lineStrength: number;
  readonly textureLineEnabled: boolean;
  readonly textureLineStrength: number;
  readonly toneMode: StudioBg3dToneMode;
  readonly toneType: StudioBg3dToneOutputType;
  readonly toneOpacity: number;
}

export interface StudioBg3dProductionPassIssue {
  readonly pass: StudioBg3dShotBatchPass;
  readonly reason: string;
}

export interface StudioBg3dProductionPassReadiness {
  readonly readyPasses: readonly StudioBg3dShotBatchPass[];
  readonly issues: readonly StudioBg3dProductionPassIssue[];
  readonly blockingReason: string | null;
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function summarizeStudioBg3dProductionLook(
  output: StudioBg3dOutputSettings,
): StudioBg3dProductionLookState {
  return Object.freeze({
    lineEnabled: output.line.enabled,
    lineStrength: finiteNonNegative(output.line.strength),
    textureLineEnabled: output.line.textureLineEnabled,
    textureLineStrength: finiteNonNegative(output.line.textureLineStrength),
    toneMode: output.tone.mode,
    toneType: output.tone.type,
    toneOpacity: finiteNonNegative(output.tone.opacity),
  });
}

function resolvePassIssue(
  pass: StudioBg3dShotBatchPass,
  look: StudioBg3dProductionLookState,
): string | null {
  const mainLineReady = look.lineEnabled && look.lineStrength > 0;
  const textureLineReady =
    mainLineReady && look.textureLineEnabled && look.textureLineStrength > 0;
  const toneLayerReady = look.toneMode !== "none" && look.toneOpacity > 0;
  const colorReady = toneLayerReady && look.toneType === "color";
  const toneReady = toneLayerReady && look.toneType !== "color";
  const ltCompositeReady = mainLineReady || textureLineReady || toneLayerReady;

  switch (pass) {
    case "beauty":
    case "depth":
      return null;
    case "lt-composite":
      return ltCompositeReady
        ? null
        : "선화와 톤이 모두 꺼져 있어 LT 합성 레이어가 생성되지 않습니다.";
    case "main-line":
      return mainLineReady
        ? null
        : "주선 출력이 꺼져 있거나 선 강도가 0입니다.";
    case "texture-line":
      return textureLineReady
        ? null
        : "주선 또는 질감선 출력이 꺼져 있거나 질감선 강도가 0입니다.";
    case "color":
      return colorReady
        ? null
        : look.toneType === "color"
          ? "컬러 톤 모드가 꺼져 있거나 불투명도가 0입니다."
          : "현재 톤 출력 형식이 컬러가 아니므로 컬러 패스가 생성되지 않습니다.";
    case "tone":
      return toneReady
        ? null
        : look.toneType === "color"
          ? "현재 톤 출력 형식이 컬러이므로 별도 톤 패스가 생성되지 않습니다."
          : "톤 모드가 꺼져 있거나 불투명도가 0입니다.";
  }
}

export function evaluateStudioBg3dProductionPassReadiness(
  selectedPasses: readonly StudioBg3dShotBatchPass[],
  look: StudioBg3dProductionLookState,
): StudioBg3dProductionPassReadiness {
  const readyPasses: StudioBg3dShotBatchPass[] = [];
  const issues: StudioBg3dProductionPassIssue[] = [];
  const seen = new Set<StudioBg3dShotBatchPass>();

  for (const pass of selectedPasses) {
    if (seen.has(pass)) continue;
    seen.add(pass);
    const reason = resolvePassIssue(pass, look);
    if (reason) {
      issues.push(Object.freeze({ pass, reason }));
    } else {
      readyPasses.push(pass);
    }
  }

  return Object.freeze({
    readyPasses: Object.freeze(readyPasses),
    issues: Object.freeze(issues),
    blockingReason: issues.length > 0
      ? `${issues.length}개 선택 패스가 현재 LT 설정과 맞지 않습니다. 패스 선택을 정리하거나 LT 설정을 조정하세요.`
      : null,
  });
}

/**
 * Resolves a purpose preset against both the renderer pass catalog and the active LT output state.
 * Color and non-color tone are mutually exclusive, so a manuscript preset never promises both.
 */
export function resolveStudioBg3dProductionBatchPresetForLook(
  availablePasses: readonly StudioBg3dShotBatchPass[],
  preset: StudioBg3dProductionBatchPreset,
  look: StudioBg3dProductionLookState,
): readonly StudioBg3dShotBatchPass[] {
  const requested = resolveStudioBg3dProductionBatchPreset(availablePasses, preset);
  return evaluateStudioBg3dProductionPassReadiness(requested, look).readyPasses;
}

export function detectStudioBg3dProductionBatchPresetForLook(
  availablePasses: readonly StudioBg3dShotBatchPass[],
  selectedPasses: readonly StudioBg3dShotBatchPass[],
  look: StudioBg3dProductionLookState,
): StudioBg3dProductionBatchPreset | "custom" {
  const selectedSet = new Set(selectedPasses);
  if (selectedSet.size !== selectedPasses.length) return "custom";

  for (const preset of ["review", "manuscript", "ai-reference", "all"] as const) {
    const expected = resolveStudioBg3dProductionBatchPresetForLook(
      availablePasses,
      preset,
      look,
    );
    if (
      expected.length === selectedSet.size &&
      expected.every((pass) => selectedSet.has(pass))
    ) {
      return preset;
    }
  }
  return "custom";
}
