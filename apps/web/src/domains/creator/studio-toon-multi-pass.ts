/**
 * Studio Toon Multi-Pass Compositor — 3D 씬/샷으로부터 외곽선·크리즈선·
 * 실루엣·평면색·그림자·머티리얼ID·Depth·Normal·스켈레톤 패스를 분리 렌더링하고
 * 스튜디오 2D 레이어 스택으로 합성하는 코어.
 *
 * 마스터플랜 10.10 (Toon Multi-pass) & 997개 기능 갭:
 * - 12대 툰 렌더 패스: outer-line, crease-line, character-silhouette, occlusion-line, flat-color, shadow, contact-shadow, material-id, character-id, depth, normal, openpose-skeleton
 * - 패스별 가시성(isEnabled), 불투명도(opacity), 블렌드 모드(Multiply, Screen, Overlay), 선 두께 계수, 틴트 색상
 * - 2D 원고 레이어로의 무손실 추출 및 합성 순서 계산
 * - 순수 함수, 불변성, 결정론, DOM/React 무관
 */

export const STUDIO_TOON_MULTIPASS_VERSION = 1 as const;

export const TOON_PASS_KINDS = [
  "outer-line",
  "crease-line",
  "character-silhouette",
  "occlusion-line",
  "flat-color",
  "shadow",
  "contact-shadow",
  "material-id",
  "character-id",
  "depth",
  "normal",
  "openpose-skeleton",
] as const;
export type ToonPassKind = (typeof TOON_PASS_KINDS)[number];

export const PASS_BLEND_MODES = [
  "source-over",
  "multiply",
  "screen",
  "overlay",
  "color-dodge",
] as const;
export type PassBlendMode = (typeof PASS_BLEND_MODES)[number];

export interface ToonPassConfig {
  readonly passKind: ToonPassKind;
  readonly isEnabled: boolean;
  readonly opacity: number; // 0..1
  readonly blendMode: PassBlendMode;
  readonly lineThicknessFactor?: number; // 0.5..3.0
  readonly colorTintHex?: string;
}

export interface StudioToonMultiPassCompositor {
  readonly version: typeof STUDIO_TOON_MULTIPASS_VERSION;
  readonly id: string;
  readonly sceneId: string;
  readonly shotId: string;
  readonly resolution: {
    readonly width: number;
    readonly height: number;
  };
  readonly passes: readonly ToonPassConfig[];
}

export interface DerivedCompositedLayer {
  readonly layerId: string;
  readonly layerName: string;
  readonly passKind: ToonPassKind;
  readonly opacity: number;
  readonly blendMode: PassBlendMode;
  readonly stackOrder: number; // 0 (bottom) -> N (top)
}

export const DEFAULT_TOON_PASS_ORDER: readonly ToonPassKind[] = [
  "depth",
  "normal",
  "material-id",
  "character-id",
  "openpose-skeleton",
  "flat-color",
  "shadow",
  "contact-shadow",
  "occlusion-line",
  "crease-line",
  "character-silhouette",
  "outer-line",
];

export function createToonMultiPassCompositor(params: {
  id: string;
  sceneId: string;
  shotId: string;
  resolution: { width: number; height: number };
  passes?: readonly ToonPassConfig[];
}): StudioToonMultiPassCompositor {
  const defaultPasses: ToonPassConfig[] = DEFAULT_TOON_PASS_ORDER.map((kind) => {
    const isLine = kind.includes("line") || kind === "character-silhouette";
    const isShadow = kind.includes("shadow");
    const isData = kind === "depth" || kind === "normal" || kind.includes("id") || kind === "openpose-skeleton";

    return Object.freeze({
      passKind: kind,
      isEnabled: !isData, // 렌더 뷰에는 기본 컬러/선/그림자만 활성화
      opacity: 1.0,
      blendMode: isShadow ? "multiply" : isLine ? "multiply" : "source-over",
      lineThicknessFactor: isLine ? 1.0 : undefined,
    });
  });

  const mergedPasses = params.passes ?? defaultPasses;

  return Object.freeze({
    version: STUDIO_TOON_MULTIPASS_VERSION,
    id: params.id.trim(),
    sceneId: params.sceneId.trim(),
    shotId: params.shotId.trim(),
    resolution: Object.freeze({ ...params.resolution }),
    passes: Object.freeze([...mergedPasses]),
  });
}

export function updatePassConfig(
  compositor: StudioToonMultiPassCompositor,
  passKind: ToonPassKind,
  patch: Partial<Omit<ToonPassConfig, "passKind">>,
): StudioToonMultiPassCompositor {
  const index = compositor.passes.findIndex((p) => p.passKind === passKind);
  if (index === -1) {
    throw new Error(`Pass ${passKind} not found`);
  }
  const updated: ToonPassConfig = {
    ...compositor.passes[index],
    ...patch,
    opacity: patch.opacity !== undefined ? Math.max(0, Math.min(1, patch.opacity)) : compositor.passes[index].opacity,
  };

  const nextPasses = [...compositor.passes];
  nextPasses[index] = Object.freeze(updated);
  return { ...compositor, passes: Object.freeze(nextPasses) };
}

/**
 * 활성화된 패스들을 2D 원고 합성 레이어 스택으로 추출한다.
 */
export function generateCompositeLayerStack(
  compositor: StudioToonMultiPassCompositor,
): readonly DerivedCompositedLayer[] {
  const activePasses = compositor.passes.filter((p) => p.isEnabled);
  const layers: DerivedCompositedLayer[] = [];

  for (let i = 0; i < activePasses.length; i += 1) {
    const p = activePasses[i];
    layers.push(
      Object.freeze({
        layerId: `layer_3d_${compositor.shotId}_${p.passKind}`,
        layerName: `3D [${p.passKind.toUpperCase()}]`,
        passKind: p.passKind,
        opacity: p.opacity,
        blendMode: p.blendMode,
        stackOrder: i,
      }),
    );
  }

  return Object.freeze(layers);
}
