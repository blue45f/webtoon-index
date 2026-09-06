import { normalizeBlurFx } from "../studio-blur";
import {
  isIdentityCurve,
  isIdentityCurveChannels,
  normalizeCurve,
  normalizeCurveChannels,
  type CurvePoint,
  type CurveRgbChannels,
} from "../studio-curves";

import {
  STUDIO_FILTER_PACK_KINDS,
  STUDIO_FILTER_PACK_LABELS,
  createStudioFilterPackValues,
  isStudioFilterPackKind,
  studioFilterPackValuesToPatch,
  type StudioFilterPackKind,
  type StudioFilterPackPatch,
  type StudioFilterPackValues,
} from "./studio-filter-pack";

import type { ImageFilterFields } from "../render/studio-konva-filter-fields";

/** 초기 5개 필터 — 각자 전용 드래프트 모양을 가진 하드코드 종류. */
export type StudioFilterCoreKind =
  | "gaussian-blur"
  | "motion-blur"
  | "hue-saturation-brightness"
  | "brightness-contrast"
  | "color-curves";

/** Magma-style top-menu filters. The authored image stays untouched until the dialog is applied. */
export type StudioFilterKind = StudioFilterCoreKind | StudioFilterPackKind;

/** 필터 팩 종류의 공용 드래프트 — 파라미터 스키마 기반 값 가방 하나로 표현한다. */
export type StudioFilterPackDraft = {
  kind: StudioFilterPackKind;
  values: StudioFilterPackValues;
};

export type StudioFilterDraft =
  | { kind: "gaussian-blur"; radius: number }
  | { kind: "motion-blur"; distance: number; angle: number }
  | {
      kind: "hue-saturation-brightness";
      hue: number;
      saturation: number;
      brightness: number;
    }
  | { kind: "brightness-contrast"; brightness: number; contrast: number }
  | { kind: "color-curves"; curve: CurvePoint[]; curveCh: CurveRgbChannels }
  | StudioFilterPackDraft;

/** 다이얼로그가 내보내는 패치 — 기존 필드 + 필터 팩 확장 필드(글리치/비네트). */
export type StudioFilterPatch = StudioFilterPackPatch;

export interface StudioFilterPreview {
  elementId: string;
  patch: StudioFilterPatch;
}

export function isStudioFilterPackDraft(
  draft: StudioFilterDraft,
): draft is StudioFilterPackDraft {
  return isStudioFilterPackKind(draft.kind);
}

export const STUDIO_FILTER_LABELS: Record<StudioFilterKind, string> = {
  "gaussian-blur": "가우시안 블러",
  "motion-blur": "모션 블러",
  "hue-saturation-brightness": "색조 / 채도 / 밝기",
  "brightness-contrast": "명도 / 대비",
  "color-curves": "색상 커브",
  ...STUDIO_FILTER_PACK_LABELS,
};

/** 상단 "필터" 메뉴 등록 순서 — 코어 5개 뒤에 필터 팩 전체. */
export const STUDIO_FILTER_MENU_KINDS: readonly StudioFilterKind[] = [
  "gaussian-blur",
  "motion-blur",
  "hue-saturation-brightness",
  "brightness-contrast",
  "color-curves",
  ...STUDIO_FILTER_PACK_KINDS,
];

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function toSignedAngle(angle: number): number {
  const normalized = ((angle % 360) + 360) % 360;
  return normalized > 180 ? normalized - 360 : normalized;
}

function toUnsignedAngle(angle: number): number {
  return ((angle % 360) + 360) % 360;
}

function optionalNumber(value: number): number | undefined {
  return value === 0 ? undefined : value;
}

export function createStudioFilterDraft(
  kind: StudioFilterKind,
  image: ImageFilterFields,
): StudioFilterDraft {
  if (isStudioFilterPackKind(kind)) {
    return { kind, values: createStudioFilterPackValues(kind, image) };
  }
  const blur = normalizeBlurFx(image.blurFx);
  switch (kind) {
    case "gaussian-blur":
      return {
        kind,
        radius: blur.type === "gaussian" && blur.strength > 0 ? blur.radius : 10,
      };
    case "motion-blur":
      return {
        kind,
        distance: blur.type === "motion" && blur.strength > 0 ? blur.radius : 10,
        angle: blur.type === "motion" && blur.strength > 0 ? toSignedAngle(blur.angle) : -45,
      };
    case "hue-saturation-brightness":
      return {
        kind,
        hue: clamp(image.hue ?? 0, -180, 180),
        saturation: clamp(Math.round((image.saturation ?? 0) * 100), -100, 100),
        brightness: clamp(Math.round((image.brightness ?? 0) * 100), -80, 80),
      };
    case "brightness-contrast":
      return {
        kind,
        brightness: clamp(Math.round((image.brightness ?? 0) * 100), -80, 80),
        contrast: clamp(Math.round(image.contrast ?? 0), -80, 80),
      };
    case "color-curves":
      return {
        kind,
        curve: normalizeCurve(image.curve),
        curveCh: normalizeCurveChannels(image.curveCh),
      };
  }
}

export function cloneStudioFilterDraft(draft: StudioFilterDraft): StudioFilterDraft {
  if (isStudioFilterPackDraft(draft)) return { ...draft, values: { ...draft.values } };
  if (draft.kind !== "color-curves") return { ...draft };
  return {
    ...draft,
    curve: draft.curve.map((point) => ({ ...point })),
    curveCh: Object.fromEntries(
      Object.entries(draft.curveCh).map(([channel, points]) => [
        channel,
        points?.map((point) => ({ ...point })),
      ]),
    ) as CurveRgbChannels,
  };
}

/** Converts dialog values into the existing non-destructive image-filter document fields. */
export function studioFilterDraftToPatch(draft: StudioFilterDraft): StudioFilterPatch {
  if (isStudioFilterPackDraft(draft)) {
    return studioFilterPackValuesToPatch(draft.kind, draft.values);
  }
  switch (draft.kind) {
    case "gaussian-blur":
      return {
        blurFx: {
          type: "gaussian",
          strength: 100,
          radius: clamp(Math.round(draft.radius), 1, 40),
          angle: 0,
        },
      };
    case "motion-blur":
      return {
        blurFx: {
          type: "motion",
          strength: 100,
          radius: clamp(Math.round(draft.distance), 1, 40),
          angle: toUnsignedAngle(draft.angle),
        },
      };
    case "hue-saturation-brightness":
      return {
        hue: optionalNumber(clamp(Math.round(draft.hue), -180, 180)),
        saturation: optionalNumber(clamp(draft.saturation, -100, 100) / 100),
        brightness: optionalNumber(clamp(draft.brightness, -80, 80) / 100),
      };
    case "brightness-contrast":
      return {
        brightness: optionalNumber(clamp(draft.brightness, -80, 80) / 100),
        contrast: optionalNumber(clamp(Math.round(draft.contrast), -80, 80)),
      };
    case "color-curves": {
      const curve = normalizeCurve(draft.curve);
      const curveCh = normalizeCurveChannels(draft.curveCh);
      return {
        curve: isIdentityCurve(curve) ? undefined : curve,
        curveCh: isIdentityCurveChannels(curveCh) ? undefined : curveCh,
      };
    }
  }
}

/** Paint-only projection: preview changes exactly one image without touching history or CRDT state. */
export function projectStudioFilterPreview<T extends { id: string; type: string }>(
  elements: readonly T[],
  preview: StudioFilterPreview | null,
): readonly T[] {
  if (!preview) return elements;
  return elements.map((element) =>
    element.id === preview.elementId && element.type === "image"
      ? ({ ...element, ...preview.patch } as T)
      : element,
  );
}
