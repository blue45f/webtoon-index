import type { StudioBg3dShotBatchPass } from "./studio-bg3d-shot-batch-pass-catalog";

export const STUDIO_BG3D_PRODUCTION_BATCH_PRESETS = Object.freeze([
  "review",
  "manuscript",
  "ai-reference",
  "all",
] as const);

export type StudioBg3dProductionBatchPreset =
  (typeof STUDIO_BG3D_PRODUCTION_BATCH_PRESETS)[number];

export const STUDIO_BG3D_PRODUCTION_CONTACT_SHEET_SHOTS_PER_PAGE = 12;
export const STUDIO_BG3D_PRODUCTION_BATCH_MAX_SHOTS = 64;

function freezePasses(
  ...passes: StudioBg3dShotBatchPass[]
): readonly StudioBg3dShotBatchPass[] {
  return Object.freeze(passes);
}

const PRESET_PASSES: Readonly<
  Record<StudioBg3dProductionBatchPreset, readonly StudioBg3dShotBatchPass[]>
> = Object.freeze({
  review: freezePasses("beauty", "lt-composite"),
  manuscript: freezePasses(
    "lt-composite",
    "color",
    "tone",
    "texture-line",
    "main-line",
  ),
  "ai-reference": freezePasses("beauty", "main-line", "depth"),
  all: freezePasses(
    "beauty",
    "lt-composite",
    "color",
    "tone",
    "texture-line",
    "main-line",
    "depth",
  ),
});

export type StudioBg3dDeferredArtifactPassKind =
  | "normal"
  | "object-id"
  | "material-id"
  | "shadow"
  | "ambient-occlusion"
  | "emission"
  | "velocity";

export interface StudioBg3dDeferredArtifactPass {
  readonly kind: StudioBg3dDeferredArtifactPassKind;
  readonly label: string;
  readonly purpose: string;
  readonly profile: string;
}

/**
 * These artifacts already exist in the renderer-neutral capture-v2 contract. They deliberately stay
 * separate from production batch passes until capture, recovery, PNG/PSD and manifest proofs land.
 */
export const STUDIO_BG3D_DEFERRED_ARTIFACT_PASSES: readonly StudioBg3dDeferredArtifactPass[] =
  Object.freeze([
    Object.freeze({
      kind: "normal",
      label: "법선 맵",
      purpose: "후반 리라이팅·Normal Control",
      profile: "RG8 octahedral",
    }),
    Object.freeze({
      kind: "object-id",
      label: "오브젝트 ID",
      purpose: "캐릭터·소품·배경 재선택",
      profile: "stable U32 ID",
    }),
    Object.freeze({
      kind: "material-id",
      label: "재질 ID",
      purpose: "피부·의상·금속 등 재질별 보정",
      profile: "stable U32 ID",
    }),
    Object.freeze({
      kind: "shadow",
      label: "직접 그림자",
      purpose: "광원 그림자 독립 합성",
      profile: "R8 coverage",
    }),
    Object.freeze({
      kind: "ambient-occlusion",
      label: "접촉 음영",
      purpose: "모서리·접지부 미세 음영",
      profile: "R8 coverage",
    }),
    Object.freeze({
      kind: "emission",
      label: "발광",
      purpose: "네온·마법·UI 자체 발광",
      profile: "RGBA8 linear",
    }),
    Object.freeze({
      kind: "velocity",
      label: "모션 벡터",
      purpose: "방향성 블러·속도선 정렬",
      profile: "RG32F px/s",
    }),
  ]);

function samePassSet(
  left: readonly StudioBg3dShotBatchPass[],
  right: readonly StudioBg3dShotBatchPass[],
): boolean {
  if (left.length !== right.length) return false;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  if (leftSet.size !== left.length || rightSet.size !== right.length) return false;
  return leftSet.size === rightSet.size &&
    [...leftSet].every((pass) => rightSet.has(pass));
}

export function resolveStudioBg3dProductionBatchPreset(
  availablePasses: readonly StudioBg3dShotBatchPass[],
  preset: StudioBg3dProductionBatchPreset,
): readonly StudioBg3dShotBatchPass[] {
  const available = new Set(availablePasses);
  const selected = PRESET_PASSES[preset].filter((pass) => available.has(pass));
  return Object.freeze(selected);
}

export function detectStudioBg3dProductionBatchPreset(
  availablePasses: readonly StudioBg3dShotBatchPass[],
  selectedPasses: readonly StudioBg3dShotBatchPass[],
): StudioBg3dProductionBatchPreset | "custom" {
  for (const preset of STUDIO_BG3D_PRODUCTION_BATCH_PRESETS) {
    if (samePassSet(
      selectedPasses,
      resolveStudioBg3dProductionBatchPreset(availablePasses, preset),
    )) return preset;
  }
  return "custom";
}

export interface StudioBg3dProductionBatchSummaryInput {
  readonly selectedShotCount: number;
  readonly selectedPassCount: number;
  readonly includeLayeredPsd: boolean;
  readonly includeContactSheet: boolean;
}

export interface StudioBg3dProductionBatchSummary {
  readonly selectedShotCount: number;
  readonly selectedPassCount: number;
  readonly pngCount: number;
  readonly psdCount: number;
  readonly contactSheetCount: number;
  readonly totalArtifactCount: number;
  readonly warnings: readonly string[];
}

function boundedInteger(value: number, maximum: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(maximum, Math.trunc(value)));
}

/** Computes the visible package plan without allocating any image or archive buffers. */
export function planStudioBg3dProductionBatchSummary(
  input: StudioBg3dProductionBatchSummaryInput,
): StudioBg3dProductionBatchSummary {
  const selectedShotCount = boundedInteger(
    input.selectedShotCount,
    STUDIO_BG3D_PRODUCTION_BATCH_MAX_SHOTS,
  );
  const selectedPassCount = boundedInteger(input.selectedPassCount, 64);
  const pngCount = selectedShotCount * selectedPassCount;
  const psdCount = input.includeLayeredPsd ? selectedShotCount : 0;
  const contactSheetCount = input.includeContactSheet && selectedShotCount > 0
    ? Math.ceil(selectedShotCount / STUDIO_BG3D_PRODUCTION_CONTACT_SHEET_SHOTS_PER_PAGE)
    : 0;
  const warnings: string[] = [];

  if (selectedShotCount === 0) warnings.push("배치 출력할 컷을 하나 이상 선택하세요.");
  if (selectedPassCount === 0) warnings.push("PNG 렌더 패스를 하나 이상 선택하세요.");
  if (pngCount >= 256) {
    warnings.push("PNG 수가 많아 브라우저 메모리 보호를 위해 컷별 순차 렌더가 적용됩니다.");
  }
  if (input.includeLayeredPsd && selectedShotCount >= 24) {
    warnings.push("PSD 요청이 많습니다. 예산 초과 컷은 PNG를 유지하고 manifest에 fallback을 기록합니다.");
  }

  return Object.freeze({
    selectedShotCount,
    selectedPassCount,
    pngCount,
    psdCount,
    contactSheetCount,
    totalArtifactCount: pngCount + psdCount + contactSheetCount + 1,
    warnings: Object.freeze(warnings),
  });
}
