/**
 * Layer border-effect compositor — 래스터 렌더 경로 어댑터.
 *
 * CSP 경계 효과(fuchi)의 픽셀 수학은 `layer/studio-layer-border-effect.ts`의 순수
 * 함수가 정본이고, 이 모듈은 그것을 Konva 필터 계약(`this.attrs` 읽기, ImageData
 * in-place 변형)으로 감싼다. `render/studio-konva-filters.ts`가 여기서만 가져가므로
 * 메인 스레드 동기 폴백과 필터 Worker가 같은 구현을 공유한다(같은 buildImageFilters).
 *
 * 핫패스 계약: 필터는 Konva 캐시 리드로우 안에서만 돌고 React 렌더를 유발하지
 * 않는다. fail-closed: attrs가 깨졌으면(무효 굵기) 픽셀을 건드리지 않는 항등 —
 * 임의 기본값으로 테두리를 조용히 그리지 않는다.
 */

import {
  applyStudioLayerBorderEffectInPlace,
  isIdentityStudioLayerBorderEffect,
  normalizeStudioLayerBorderEffect,
  type StudioLayerBorderEffectSettings,
  type StudioLayerBorderEffectType,
} from "../layer/studio-layer-border-effect";

export { studioLayerBorderEffectCachePad } from "../layer/studio-layer-border-effect";

/** 경계 효과 레시피를 실을 수 있는 요소의 최소 형태(ImageFilterFields 부분집합). */
export interface StudioLayerBorderEffectHost {
  borderEffect?: StudioLayerBorderEffectSettings;
}

/** 켜져 있고 유효 굵기가 있으면 활성 — 렌더 계획과 캐시 판정이 같은 함수를 쓴다. */
export function hasActiveStudioLayerBorderEffect(el: StudioLayerBorderEffectHost): boolean {
  return !!el.borderEffect && !isIdentityStudioLayerBorderEffect(el.borderEffect);
}

/** Konva 노드 attrs로 실리는 키 — outline(스티커 테두리) attrs와 겹치지 않게 네임스페이스. */
export interface StudioLayerBorderEffectFilterAttrs {
  layerBorderThickness: number;
  layerBorderColor: string;
  layerBorderType: StudioLayerBorderEffectType;
  /** attrs 레코드는 number|string만 싣는다 — boolean 대신 0/1. */
  layerBorderAntiAliased: 0 | 1;
}

export function studioLayerBorderEffectFilterAttrs(
  value?: Partial<StudioLayerBorderEffectSettings> | null,
): StudioLayerBorderEffectFilterAttrs {
  const normalized = normalizeStudioLayerBorderEffect(value);
  return {
    layerBorderThickness: normalized.thickness,
    layerBorderColor: normalized.color,
    layerBorderType: normalized.type,
    layerBorderAntiAliased: normalized.antiAliased === false ? 0 : 1,
  };
}

interface FilterThis {
  attrs?: Record<string, unknown>;
}

interface StudioImageDataSurface {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

/**
 * Konva 필터 래퍼 — this.attrs.layerBorder*를 읽어 순수 경계 효과를 in-place 적용한다.
 * 무효 굵기면 아무것도 그리지 않는다(항등이 안전한 닫힌 상태).
 */
export function layerBorderEffectKonvaFilter(
  this: FilterThis | undefined,
  imageData: StudioImageDataSurface,
): void {
  const attrs = this?.attrs ?? {};
  const thickness = attrs.layerBorderThickness;
  if (typeof thickness !== "number" || !Number.isFinite(thickness) || thickness <= 0) return;
  const settings = normalizeStudioLayerBorderEffect({
    enabled: true,
    thickness,
    color: typeof attrs.layerBorderColor === "string" ? attrs.layerBorderColor : undefined,
    type: attrs.layerBorderType as StudioLayerBorderEffectType | undefined,
    antiAliased: attrs.layerBorderAntiAliased !== 0 && attrs.layerBorderAntiAliased !== false,
  });
  if (!settings.enabled || settings.thickness <= 0) return;
  applyStudioLayerBorderEffectInPlace(imageData, settings);
}
