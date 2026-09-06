/**
 * Studio Scene Recipe — 세트·인물 슬롯·카메라·조명·포즈·효과·컷 배열을 하나의
 * 편집 모델로 묶는 순수 코어.
 *
 * 2026-07-27 기능 갭 재감사(docs/studio-feature-gap-audit-2026-07-27.md)의
 * "다음 구현 순서 5번" — Scene Recipe와 Quick Comic의 캐릭터·표정·포즈 슬롯 통합 —
 * 을 위한 도메인 코어다. design tokens·dependency impact graph와 마찬가지로
 * React·DOM·저장·네트워크 의존이 없어 프로젝트 하이드레이션과 Worker 실행이 같은
 * 결정론 계약을 공유한다.
 *
 * 의도적으로 레퍼런스는 문자열 id로만 저장한다(느슨한 결합). 존재 여부 판정은
 * resolve 단계에서 참조 카탈로그를 주입받아 진단으로 보고한다 — 코어가 특정
 * 에셋 카탈로그를 몰라야 씬 템플릿·BG3D·VRM 어느 쪽과도 붙는다.
 */

export const STUDIO_SCENE_RECIPE_VERSION = 1 as const;

export const STUDIO_SCENE_RECIPE_LIMITS = Object.freeze({
  maxRecipes: 4_096,
  maxCharacterSlots: 12,
  maxShots: 512,
  maxEffectsPerShot: 16,
  maxBeatsPerShot: 32,
  maxIdLength: 128,
  maxLabelLength: 160,
  maxStringLength: 512,
  maxDiagnostics: 256,
});

export const STUDIO_SCENE_SHOT_CAMERA_ANGLES = [
  "front",
  "three-quarter",
  "profile",
  "back",
  "low",
  "high",
  "bird",
  "worm",
] as const;

export type StudioSceneShotCameraAngle =
  (typeof STUDIO_SCENE_SHOT_CAMERA_ANGLES)[number];

export const STUDIO_SCENE_LIGHTING_PRESETS = [
  "day",
  "golden-hour",
  "overcast",
  "night",
  "neon",
  "studio-key",
  "silhouette",
] as const;

export type StudioSceneLightingPreset =
  (typeof STUDIO_SCENE_LIGHTING_PRESETS)[number];

/** 슬롯에 바인딩된 인물의 연기 상태 — Quick Comic의 캐릭터·표정·포즈 선택과 같은 축이다. */
export interface StudioSceneCharacterSlot {
  readonly id: string;
  readonly label?: string;
  /** 캐릭터·아바타 레퍼런스(VRM id, 컴포넌트 id 등) — 없으면 빈 슬롯으로 진단만 남긴다. */
  readonly characterRef?: string;
  readonly expressionRef?: string;
  readonly poseRef?: string;
  readonly costumeRef?: string;
}

export interface StudioSceneCamera {
  readonly angle: StudioSceneShotCameraAngle;
  /** 0.25..4 — 1이 기본 시야. 문서 좌표가 아닌 배율 개념이다. */
  readonly zoom: number;
}

export interface StudioSceneEffectRef {
  readonly id: string;
  readonly effectRef: string;
  /** 0..1 */
  readonly intensity: number;
}

/** 한 컷(shot)의 연출 상태. 슬롯 구성은 레시피 공유, 연기·연출은 컷별 오버라이드다. */
export interface StudioSceneShot {
  readonly id: string;
  readonly label?: string;
  readonly characterSlotOverrides?: Readonly<
    Record<string, Partial<Omit<StudioSceneCharacterSlot, "id">>>
  >;
  readonly camera?: Partial<StudioSceneCamera>;
  readonly lighting?: StudioSceneLightingPreset;
  readonly effects?: readonly StudioSceneEffectRef[];
  /** 컷 안의 비트(대사·행동) 순서 — 재배열이 곧 편집이다. */
  readonly beatRefs?: readonly string[];
}

/** 레시피 = 공유 슬롯 캐스트 + 컷 배열. 컷은 오버라이드만 닫고 기본값은 레시피가 갖는다. */
export interface StudioSceneRecipe {
  readonly version: typeof STUDIO_SCENE_RECIPE_VERSION;
  readonly id: string;
  readonly name: string;
  readonly setRef?: string;
  readonly cast: readonly StudioSceneCharacterSlot[];
  readonly defaultCamera: StudioSceneCamera;
  readonly defaultLighting: StudioSceneLightingPreset;
  readonly shots: readonly StudioSceneShot[];
}

export interface StudioSceneRecipeReferenceCatalog {
  readonly characters?: ReadonlySet<string>;
  readonly expressions?: ReadonlySet<string>;
  readonly poses?: ReadonlySet<string>;
  readonly costumes?: ReadonlySet<string>;
  readonly sets?: ReadonlySet<string>;
  readonly effects?: ReadonlySet<string>;
  readonly beats?: ReadonlySet<string>;
}

export type StudioSceneRecipeDiagnosticCode =
  | "duplicate-id"
  | "dangling-character-ref"
  | "dangling-expression-ref"
  | "dangling-pose-ref"
  | "dangling-costume-ref"
  | "dangling-set-ref"
  | "dangling-effect-ref"
  | "dangling-beat-ref"
  | "unknown-slot-override"
  | "limit-exceeded"
  | "invalid-number";

export interface StudioSceneRecipeDiagnostic {
  readonly code: StudioSceneRecipeDiagnosticCode;
  readonly message: string;
  readonly shotId?: string;
  readonly slotId?: string;
}

export interface StudioResolvedSceneShot {
  readonly id: string;
  readonly label?: string;
  readonly cast: readonly StudioSceneCharacterSlot[];
  readonly camera: StudioSceneCamera;
  readonly lighting: StudioSceneLightingPreset;
  readonly effects: readonly StudioSceneEffectRef[];
  readonly beatRefs: readonly string[];
}

const CAMERA_ZOOM_RANGE = { min: 0.25, max: 4 } as const;
const EFFECT_INTENSITY_RANGE = { min: 0, max: 1 } as const;

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clampRange(value: number, range: { min: number; max: number }): number {
  return Math.min(range.max, Math.max(range.min, value));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** 레시피의 정규형 — 누락 필터를 기본값으로 채우고 수치를 범위로 고정한다. 순수·결정론. */
export function normalizeStudioSceneRecipe(
  recipe: StudioSceneRecipe,
): StudioSceneRecipe {
  const limits = STUDIO_SCENE_RECIPE_LIMITS;
  return {
    version: STUDIO_SCENE_RECIPE_VERSION,
    id: recipe.id.slice(0, limits.maxIdLength),
    name: recipe.name.slice(0, limits.maxLabelLength),
    ...(isNonEmptyString(recipe.setRef) ? { setRef: recipe.setRef } : {}),
    cast: recipe.cast.slice(0, limits.maxCharacterSlots).map((slot) => ({
      ...slot,
      id: slot.id,
      ...(isNonEmptyString(slot.label) ? { label: slot.label } : {}),
    })),
    defaultCamera: {
      angle: recipe.defaultCamera.angle,
      zoom: clampRange(finiteOr(recipe.defaultCamera.zoom, 1), CAMERA_ZOOM_RANGE),
    },
    defaultLighting: recipe.defaultLighting,
    shots: recipe.shots.slice(0, limits.maxShots).map((shot) => ({
      ...shot,
      id: shot.id,
      effects: (shot.effects ?? [])
        .slice(0, limits.maxEffectsPerShot)
        .map((effect) => ({
          ...effect,
          intensity: clampRange(
            finiteOr(effect.intensity, 1),
            EFFECT_INTENSITY_RANGE,
          ),
        })),
      beatRefs: (shot.beatRefs ?? []).slice(0, limits.maxBeatsPerShot),
    })),
  };
}

/**
 * 레시피 + 컷 오버라이드 → 컷별 확정 상태. 오버라이드는 얕은 병합(슬롯은 id 단위
 * 부분 병합, 카메라는 필드 단위 부분 병합)이며 원본을 변경하지 않는다.
 */
export function resolveStudioSceneShot(
  recipe: StudioSceneRecipe,
  shot: StudioSceneShot,
): StudioResolvedSceneShot {
  const cast = recipe.cast.map((slot) => {
    const override = shot.characterSlotOverrides?.[slot.id];
    if (!override) return slot;
    // override 타입이 id 변경을 금지하므로(Omit<…, "id">) 슬롯 id는 항상 원본을 따른다.
    return { ...slot, ...override };
  });
  return {
    id: shot.id,
    ...(isNonEmptyString(shot.label) ? { label: shot.label } : {}),
    cast,
    camera: {
      angle: shot.camera?.angle ?? recipe.defaultCamera.angle,
      zoom: clampRange(
        finiteOr(shot.camera?.zoom, recipe.defaultCamera.zoom),
        CAMERA_ZOOM_RANGE,
      ),
    },
    lighting: shot.lighting ?? recipe.defaultLighting,
    effects: shot.effects ?? [],
    beatRefs: shot.beatRefs ?? [],
  };
}

export function resolveStudioSceneRecipeShots(
  recipe: StudioSceneRecipe,
): readonly StudioResolvedSceneShot[] {
  return recipe.shots.map((shot) => resolveStudioSceneShot(recipe, shot));
}

function pushDiagnostic(
  diagnostics: StudioSceneRecipeDiagnostic[],
  diagnostic: StudioSceneRecipeDiagnostic,
): void {
  if (diagnostics.length >= STUDIO_SCENE_RECIPE_LIMITS.maxDiagnostics) return;
  diagnostics.push(diagnostic);
}

/**
 * 참조 카탈로그를 주입받아 느슨한 레퍼런스를 진단한다. 카탈로그에 없는 집합은
 * "모름"으로 취급해 오탐을 내지 않는다(선택적 검증).
 */
export function diagnoseStudioSceneRecipe(
  recipe: StudioSceneRecipe,
  catalog?: StudioSceneRecipeReferenceCatalog,
): readonly StudioSceneRecipeDiagnostic[] {
  const diagnostics: StudioSceneRecipeDiagnostic[] = [];
  const seenSlotIds = new Set<string>();
  for (const slot of recipe.cast) {
    if (seenSlotIds.has(slot.id)) {
      pushDiagnostic(diagnostics, {
        code: "duplicate-id",
        message: `캐릭터 슬롯 id가 중복됩니다: ${slot.id}`,
        slotId: slot.id,
      });
    }
    seenSlotIds.add(slot.id);
    if (catalog?.characters && isNonEmptyString(slot.characterRef)
      && !catalog.characters.has(slot.characterRef)) {
      pushDiagnostic(diagnostics, {
        code: "dangling-character-ref",
        message: `캐릭터 레퍼런스를 찾을 수 없습니다: ${slot.characterRef}`,
        slotId: slot.id,
      });
    }
    if (catalog?.expressions && isNonEmptyString(slot.expressionRef)
      && !catalog.expressions.has(slot.expressionRef)) {
      pushDiagnostic(diagnostics, {
        code: "dangling-expression-ref",
        message: `표정 레퍼런스를 찾을 수 없습니다: ${slot.expressionRef}`,
        slotId: slot.id,
      });
    }
    if (catalog?.poses && isNonEmptyString(slot.poseRef)
      && !catalog.poses.has(slot.poseRef)) {
      pushDiagnostic(diagnostics, {
        code: "dangling-pose-ref",
        message: `포즈 레퍼런스를 찾을 수 없습니다: ${slot.poseRef}`,
        slotId: slot.id,
      });
    }
    if (catalog?.costumes && isNonEmptyString(slot.costumeRef)
      && !catalog.costumes.has(slot.costumeRef)) {
      pushDiagnostic(diagnostics, {
        code: "dangling-costume-ref",
        message: `의상 레퍼런스를 찾을 수 없습니다: ${slot.costumeRef}`,
        slotId: slot.id,
      });
    }
  }

  if (catalog?.sets && isNonEmptyString(recipe.setRef)
    && !catalog.sets.has(recipe.setRef)) {
    pushDiagnostic(diagnostics, {
      code: "dangling-set-ref",
      message: `세트 레퍼런스를 찾을 수 없습니다: ${recipe.setRef}`,
    });
  }

  const seenShotIds = new Set<string>();
  for (const shot of recipe.shots) {
    if (seenShotIds.has(shot.id)) {
      pushDiagnostic(diagnostics, {
        code: "duplicate-id",
        message: `컷 id가 중복됩니다: ${shot.id}`,
        shotId: shot.id,
      });
    }
    seenShotIds.add(shot.id);

    for (const slotId of Object.keys(shot.characterSlotOverrides ?? {})) {
      if (!seenSlotIds.has(slotId)) {
        pushDiagnostic(diagnostics, {
          code: "unknown-slot-override",
          message: `레시피 캐스트에 없는 슬롯을 오버라이드합니다: ${slotId}`,
          shotId: shot.id,
          slotId,
        });
      }
    }

    for (const effect of shot.effects ?? []) {
      if (catalog?.effects && !catalog.effects.has(effect.effectRef)) {
        pushDiagnostic(diagnostics, {
          code: "dangling-effect-ref",
          message: `효과 레퍼런스를 찾을 수 없습니다: ${effect.effectRef}`,
          shotId: shot.id,
        });
      }
      if (!Number.isFinite(effect.intensity)
        || effect.intensity < EFFECT_INTENSITY_RANGE.min
        || effect.intensity > EFFECT_INTENSITY_RANGE.max) {
        pushDiagnostic(diagnostics, {
          code: "invalid-number",
          message: `효과 강도가 0..1 범위 밖입니다: ${effect.intensity}`,
          shotId: shot.id,
        });
      }
    }

    for (const beatRef of shot.beatRefs ?? []) {
      if (catalog?.beats && !catalog.beats.has(beatRef)) {
        pushDiagnostic(diagnostics, {
          code: "dangling-beat-ref",
          message: `비트 레퍼런스를 찾을 수 없습니다: ${beatRef}`,
          shotId: shot.id,
        });
      }
    }
  }

  return diagnostics;
}
