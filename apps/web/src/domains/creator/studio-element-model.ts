import type { StudioTextAiProvenance } from "./ai/studio-ai-client";
import type {
  StudioBg3dLtLayerRole,
  StudioBg3dLtRenderMode,
} from "./bg3d/studio-bg3d-lt-layer-plan";
import type { StudioBg3dSceneDocument } from "./bg3d/studio-bg3d-scene-document";
import type { NormalizedStudioBrushDynamicsSettings } from "./brush/studio-brush-dynamics";
import type { StudioBrushEngineProgramSet } from "./brush/studio-brush-engine-program-set";
import type { StudioStampBrushTuning } from "./brush/studio-brush-stamp-engine";
import type { StudioInkPressureModel } from "./brush/studio-ink-pressure-model";
import type { InkWash } from "./brush/studio-ink-wash";
import type { StudioPaperSubstrateModel } from "./brush/studio-paper-substrate-model";
import type { StudioStrokePaintModel } from "./brush/studio-stroke-paint-model";
import type { ShapeParams, StrokeStyle } from "./brush/studio-stroke-shapes";
import type { StudioLayerBorderEffectSettings } from "./layer/studio-layer-border-effect";
import type {
  StudioLayerColor,
  StudioLayerRole,
} from "./layer/studio-layer-navigator";
import type { BubbleTailSpec } from "./lettering/studio-bubble-path";
import type { TextPathConfig } from "./lettering/studio-text-path";
import type { StudioHokusaiLiveDocumentReceipt } from "./render/studio-hokusai-live-brush-document-receipt";
import type { StudioRasterAsset } from "./render/studio-raster-assets";
import type { StudioAdjustmentStack } from "./studio-adjustment-stack";
import type {
  StudioFieldIrisBlurOptions,
  StudioLensBlurOptions,
  StudioSelectiveGaussianBlurOptions,
  StudioTiltShiftBlurOptions,
} from "./studio-advanced-blur-filter-kernels";
import type { BubbleVariant } from "./studio-assets";
import type { AutoAdjust } from "./studio-auto-adjust";
import type { BlurFx } from "./studio-blur";
import type { ChannelMixer } from "./studio-channel-mixer";
import type { Clarity } from "./studio-clarity";
import type { ColorBalance } from "./studio-color-balance";
import type { ColorToAlpha } from "./studio-color-to-alpha";
import type { StudioCommunityAssetCredit } from "./studio-community-asset-license";
import type { StudioStoryBeat } from "./studio-continuity";
import type { CurvePoint } from "./studio-curves";
import type { Detail } from "./studio-detail";
import type { Distort } from "./studio-distort";
import type { DrawShapeKind } from "./studio-editor-tool-model";
import type { StudioAnimFrame } from "./studio-frame-animation";
import type { Glow } from "./studio-glow";
import type { StudioGradientSpec } from "./studio-gradient-engine";
import type { GradientMap } from "./studio-gradient-map";
import type { Grain } from "./studio-grain";
import type { Halftone } from "./studio-halftone";
import type { Light } from "./studio-light";
import type { LineArtCleanupOptions } from "./studio-line-cleanup";
import type { StudioLinked3dCorrectionProvenance } from "./studio-linked-3d-render-document";
import type { StudioLivingInkDocumentReceipt } from "./studio-living-ink-document";
import type {
  StudioMaterialMinimumDiameterRatio,
  StudioMaterialPressureModel,
} from "./studio-material-pressure-model";
import type { Outline } from "./studio-outline";
import type { StudioOutlineStrokeContractV1 } from "./studio-outline-stroke-contract";
import type { StudioPatternSpec } from "./studio-pattern-fill";
import type { PhotoFilter } from "./studio-photo-filter";
import type {
  StudioDifferenceOfGaussiansOptions,
  StudioDustScratchesOptions,
  StudioTileableBlurOptions,
} from "./studio-professional-filter-kernels";
import type { StudioPublishAiProvenance } from "./studio-publish-preflight";
import type { StudioSketchStyle } from "./studio-rough-shape";
import type { SelectiveHsl } from "./studio-selective-hsl";
import type { ShadowHighlight } from "./studio-shadow-highlight";
import type { Sketch } from "./studio-sketch";
import type { StudioStockImageCredit } from "./studio-stock-image-client";
import type { ScenarioBeatType } from "./studio-story-beats";
import type { Stylize } from "./studio-stylize";
import type {
  StudioEdgeAwareDenoiseOptions,
  StudioJpegArtifactReductionOptions,
  StudioScreentoneRemovalOptions,
} from "./studio-tone-artifact-filter-kernels";
import type { Vibrance } from "./studio-vibrance";
import type { StudioVrmSceneDocument } from "./vrm/studio-vrm-scene-document";
import type { StudioFilterMaskSurfaceId } from "@/shared/lib/studio-filter-mask-surface-contract";
import type { StudioInkInputContract } from "@/shared/lib/studio-ink-input-contract";

export interface ImageEl {
  id: string;
  type: "image";
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  /** Full-page, non-destructive filter snapshot; keeps interactive filter caches memory-bounded. */
  filterPageComposite?: boolean;
  opacity?: number; // 불투명도(흐린 배경 캐릭터·페이드 등). 미설정=1.
  flipped?: boolean; // 좌우 반전(캐릭터 미러링).
  flippedY?: boolean; // 상하 반전
  blur?: number;
  brightness?: number;
  contrast?: number;
  grayscale?: boolean;
  sepia?: boolean;
  screentone?: boolean;
  lineart?: boolean;
  chromatic?: number;
  posterize?: number;
  noise?: number;
  // 포토샵급 보정 — Konva HSL/내장 필터 + studio-filters 커스텀 픽셀 필터로 적용.
  saturation?: number; // 채도(-1..1, Konva HSL)
  hue?: number; // 색조 회전(-180..180°)
  temperature?: number; // 색온도(-100..100, 따뜻/차갑게)
  sharpen?: number; // 선명도(0..1, 언샤프 마스크)
  pixelate?: number; // 픽셀화(0..40)
  invert?: boolean; // 색 반전
  inkThreshold?: number; // 먹선 임계(0..1, 순흑/순백)
  duotoneShadow?: string; // 듀오톤 어두운 색
  duotoneHighlight?: string; // 듀오톤 밝은 색
  // 레벨 보정(Levels) — 입력/출력 검정·흰점 + 감마.
  levelsBlack?: number;
  levelsWhite?: number;
  levelsGamma?: number;
  levelsOutBlack?: number;
  levelsOutWhite?: number;
  // 레이어 스타일(그림자/글로우/둥근 모서리) — Konva.Image 네이티브 속성.
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  shadowOpacity?: number;
  cornerRadius?: number;
  // 톤 커브(Curves) + 컬러 밸런스(Color Balance) + 채널 믹서(Channel Mixer) + 선택 색상(HSL) + 생동감(Vibrance).
  curve?: CurvePoint[];
  colorBalance?: ColorBalance;
  channelMixer?: ChannelMixer;
  selectiveHsl?: SelectiveHsl;
  vibrance?: Vibrance;
  gradientMap?: GradientMap;
  photoFilter?: PhotoFilter;
  colorToAlpha?: ColorToAlpha; // 색상 투명화 — 키 색상을 알파로 punching(studio-color-to-alpha)
  autoAdjust?: AutoAdjust;
  clarity?: Clarity;
  shadowHighlight?: ShadowHighlight;
  outline?: Outline;
  /** CSP 경계 효과(fuchi) — 실루엣 EDT 거리 기반 비파괴 레이어 테두리(2026-08-20). */
  borderEffect?: StudioLayerBorderEffectSettings;
  glow?: Glow;
  halftone?: Halftone;
  grain?: Grain;
  /** 수묵/수채 번짐·종이결·안료 과립을 조합하는 비파괴 재질 효과. */
  inkWash?: InkWash;
  blurFx?: BlurFx;
  distort?: Distort;
  stylize?: Stylize;
  light?: Light;
  sketch?: Sketch;
  detail?: Detail;
  /** Non-destructive scanned/authored line-art cleanup recipe. */
  lineCleanup?: LineArtCleanupOptions;
  /** Non-destructive periodic screentone suppression with dark-ink protection. */
  screentoneRemoval?: StudioScreentoneRemovalOptions;
  /** Non-destructive JPEG block/ringing cleanup with edge protection. */
  jpegArtifactReduction?: StudioJpegArtifactReductionOptions;
  /** Non-destructive edge-aware color denoise. */
  edgeAwareDenoise?: StudioEdgeAwareDenoiseOptions;
  /** Aperture-shaped photographic blur; alpha is preserved byte-for-byte. */
  lensBlur?: StudioLensBlurOptions;
  /** Radial focus field with an aperture-shaped out-of-focus region. */
  fieldIrisBlur?: StudioFieldIrisBlurOptions;
  /** Directional focus band with feathered blur outside the band. */
  tiltShiftBlur?: StudioTiltShiftBlurOptions;
  /** Edge-aware Gaussian smoothing that protects authored line boundaries. */
  selectiveGaussianBlur?: StudioSelectiveGaussianBlurOptions;
  /** Two-scale Gaussian edge response rendered as clean black line art. */
  differenceOfGaussians?: StudioDifferenceOfGaussiansOptions;
  /** Thresholded median restoration that changes only isolated defects. */
  dustScratches?: StudioDustScratchesOptions;
  /** Wrap-boundary Gaussian blur for seamless texture and background tiles. */
  tileableBlur?: StudioTileableBlurOptions;
  // 기울이기(Skew) — 도 단위(-60..60). 0(항등)은 저장하지 않는다(studio-skew 직렬화 규약).
  skewX?: number;
  skewY?: number;
  /** Photopea-style reorderable smart filter stack (non-destructive). */
  smartFilters?: StudioAdjustmentStack;
  // 필터 마스크(Krita/Photoshop 필터 마스크) — 비파괴 필터 체인을 요소의 일부에만 적용하는
  // 요소-로컬 그레이스케일 마스크(el.src 자연 해상도 기준, maskSrc와 동일 좌표 규약).
  // 흰색/불투명=필터 결과, 검정/투명=원본, 회색=선형 블렌드. 미설정=기존 전체 적용과 동일.
  // 가시성을 자르는 maskSrc(레이어 마스크)와는 독립 축 — studio-filter-mask.ts 참고.
  /** Shared-work canonical identity; binary mask bytes live in immutable raster CRDT assets. */
  filterMaskSurfaceId?: StudioFilterMaskSurfaceId;
  /** Legacy/local/offline materialization. Shared canonical documents prefer filterMaskSurfaceId. */
  filterMaskSrc?: string;
  filterMaskEnabled?: boolean;
  // 프레임별 셀 애니메이션 — 있으면 이 이미지는 "애니메이션 셀"이다.
  // src는 항상 frames 중 현재 표시 프레임의 src와 동일하게 유지한다.
  frames?: StudioAnimFrame[];
  frameFps?: number; // 재생 속도(기본 12) — durationMs 미설정 프레임에 적용.
  frameLoop?: boolean; // 반복 재생(기본 true).
  activeFrameId?: string; // 현재 편집/표시 중인 프레임(패널이 열려 있을 때의 탐색 위치).
  // 애니메이션 GIF 업로드 — 있으면 src 자체가 data:image/gif인 다중 프레임 GIF이고, 브라우저가
  // <img> 소스를 내부적으로 계속 재생한다(디코딩은 이 앱이 하지 않는다 — studio-gif-element.ts
  // 참고). 위 frames(셀 애니메이션)와는 서로 다른 축이다: frames는 이 앱이 여러 장의 정적 src를
  // 프레임으로 넘겨가며 재생하는 것이고, isAnimatedGif는 단일 src 하나를 브라우저가 자체
  // 재생하는 것 — 실질적으로 상호배타적으로 취급한다(UrlImage 리렌더 루프의 가드 참고).
  isAnimatedGif?: boolean;
  // 스톡 사진(Unsplash) 삽입 출처 — StudioStockImagePanel에서 삽입한 이미지에만 설정된다.
  // Unsplash API Guidelines가 요구하는 "사진 사용 시 작가·Unsplash 크레딧 표시"를 삽입 이후에도
  // (예: 선택된 이미지 사이드바에서) 다시 보여줄 수 있도록 요소에 영구 보존한다.
  stockImageCredit?: StudioStockImageCredit;
  /** 커뮤니티 에셋의 저작자·사용권·상업 이용 조건. 삽입 뒤에도 출처 표시에 사용한다. */
  communityAssetCredit?: StudioCommunityAssetCredit;
  /** AI 생성/편집 provenance. 페이지 JSON과 함께 저장되어 Publish Pack 사전검사에 사용된다. */
  aiProvenance?: StudioPublishAiProvenance;
  /** 번들 소재 카탈로그의 안정 ID. 다시 열어도 라이선스·생성 메타데이터를 추적한다. */
  builtinRasterAssetId?: StudioRasterAsset["id"];
  /** Hokusai live 획의 PNG/입력/픽셀 권위. JSON 문서·CRDT 왕복 뒤에도 원본 DrawEl과 함께 보존한다. */
  hokusaiLiveReceipt?: StudioHokusaiLiveDocumentReceipt;
  /** Living Ink의 물리 operation journal과 flattened PNG 복구 영수증. */
  livingInkReceipt?: StudioLivingInkDocumentReceipt;
  /** 고급 채우기가 선화 경계로 읽는 명시적 래스터 참조 레이어. */
  fillReference?: boolean;
  /** 재편집 가능한 3D 장면 원본. PNG src와 분리하며 로컬 저장소 ID는 포함하지 않는다. */
  bg3dScene?: StudioBg3dSceneDocument;
  /** 재편집 가능한 VRM 포저 장면. 캡처 PNG와 분리하며 모델은 번들 ID 또는 콘텐츠 해시로만 식별한다. */
  vrmScene?: StudioVrmSceneDocument;
  /** 분리된 3D LT 레이어를 같은 원본 장면으로 다시 묶는 안정 식별자. */
  bg3dLtBundleId?: string;
  /** 톤·재질선·주선 중 이 래스터 레이어의 역할. */
  bg3dLtRole?: StudioBg3dLtLayerRole;
  /** 레거시 단일 PNG인지 분리 출력인지 구분하는 재편집 메타데이터. */
  bg3dLtRenderMode?: StudioBg3dLtRenderMode;
}

export interface StudioDialogueRubySpan {
  /** UTF-16 code-unit offsets, matching textarea selection and CRDT serialization. */
  readonly start: number;
  readonly end: number;
  readonly ruby: string;
}

export interface StudioDialogueRangeFormat {
  /** UTF-16 code-unit offsets, matching ruby spans and selection commands. */
  readonly start: number;
  readonly end: number;
  readonly fontSize?: number;
  readonly fontStyle?: "normal" | "bold" | "italic" | "bold italic";
  readonly textColor?: string;
}

export interface TextEl {
  id: string;
  type: "text";
  text: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  fill: string;
  rotation: number;
  font?: string; // 글꼴(웹툰 대사용)
  stroke?: string; // 효과음(SFX) 외곽선
  strokeWidth?: number;
  letterSpacing?: number; // 자간(px)
  lineHeight?: number; // 행간(배수)
  vertical?: boolean;
  align?: "left" | "center" | "right";
  fontStyle?: "normal" | "bold" | "italic" | "bold italic";
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  shadowOpacity?: number;
  fillType?: "solid" | "gradient";
  gradientColorStart?: string;
  gradientColorEnd?: string;
  gradientDirection?: "vertical" | "horizontal";
  gradient?: StudioGradientSpec; // 멀티스톱 그라데이션(엔진) — 있으면 위 2색 레거시 필드보다 우선.
  textPath?: TextPathConfig; // 곡선 텍스트(아치/물결/원) — 미설정/none이면 직선.
  /** Lossless dialogue ruby annotations. Rendering/exporters must report unsupported spans. */
  rubySpans?: readonly StudioDialogueRubySpan[];
  /** Optional range-local typography retained independently of the base text style. */
  rangeFormats?: readonly StudioDialogueRangeFormat[];
  /** Forward-compatible sticky-note identity carried through project and realtime documents. */
  stickyNotePresetId?: string;
  /** Sticky-card presentation colour; absent on ordinary text elements. */
  stickyNoteFill?: string;
  skewX?: number; // 가로 기울임(도, -60..60) — studio-skew 직렬화 규약. 미설정=0.
  skewY?: number; // 세로 기울임(도) — studio-skew 직렬화 규약. 미설정=0.
}

export interface BubbleEl {
  id: string;
  type: "bubble";
  variant: BubbleVariant;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  textFill: string;
  rotation: number;
  tail?: "left" | "right" | "none"; // 말풍선 꼬리 방향(화자 쪽). shout/box는 무시.
  tailDirection?: "bottom" | "top" | "left" | "right"; // 말풍선 꼬리 방향(상하좌우).
  extraTails?: BubbleTailSpec[]; // 추가 꼬리(두 화자 동시 대사) — 주 꼬리 외 최대 2개. studio-bubble-path 정규화 규약.
  font?: string; // 말풍선 글꼴(미설정 시 기본 고딕)
  fontSize?: number; // 말풍선 글자 크기(미설정 시 24)
  lineHeight?: number; // 행간(배수, 미설정 시 1.1)
  vertical?: boolean;
  /** Lossless dialogue ruby annotations. Rendering/exporters must report unsupported spans. */
  rubySpans?: readonly StudioDialogueRubySpan[];
  /** Optional range-local typography retained independently of the base text style. */
  rangeFormats?: readonly StudioDialogueRangeFormat[];
  align?: "left" | "center" | "right";
  fontStyle?: "normal" | "bold" | "italic" | "bold italic";
  tailXRatio?: number;
  tailHeight?: number;
  tailBase?: number; // 주 꼬리 밑동 너비(px). 미설정이면 말풍선 크기·테마에 맞춰 자동 계산.
  tailBend?: number; // 주 꼬리 곡률(-1..1). 0은 직선형 테이퍼.
  /** 꼬리 자동 부착 대상 요소 id. 설정되면 매 커밋마다 대상의 중심점을 향해 tailDirection/
   *  tailXRatio/tailHeight 가 자동 재계산된다(studio-bubble-anchor.ts). 대상이 삭제되면
   *  자동으로 지워진다(마지막 tail 값은 그대로 남아 수동 모드로 복귀). tailAnchorPoint 와
   *  상호배타 — 패널이 하나를 설정할 때 다른 하나를 undefined 로 같이 patch 한다. */
  tailAnchorId?: string;
  /** 꼬리 자동 부착 대상 고정 좌표(페이지/캔버스 좌표, el.x/y 와 동일 원점). tailAnchorId 가
   *  없을 때만 의미가 있다 — 말풍선이 움직이면 이 좌표를 향한 각도가 재계산된다(좌표 자체는
   *  고정, 저절로 움직이지 않는다). */
  tailAnchorPoint?: { x: number; y: number };
  stroke?: string;
  strokeWidth?: number;
  strokeStyle?: StrokeStyle; // 점선 등(studio-stroke-shapes 규약) — 화살촉 필드는 말풍선엔 의미 없어 무시.
  gradient?: StudioGradientSpec; // 멀티스톱 그라데이션 채우기 — 있으면 fill(단색)보다 우선(studio-gradient-engine).
  autoShrinkText?: boolean; // true면 텍스트가 넘칠 때 높이 대신 폰트 크기를 자동 축소(studio-bubble-text-fit).
  autoShrinkMinFontSize?: number; // 자동 축소 하한(px). 미설정 시 BUBBLE_AUTO_SHRINK_MIN_FONT_DEFAULT.
  starAmplitude?: number; // shout/angry variant(Star)의 안쪽 반경 비율(0..1). 미설정 시 각 variant의 기존 비율(36/68, 28/64).
  starPoints?: number; // shout/angry variant의 스파이크 개수(6..40). 미설정 시 기존 개수(20, 22) — studio-bubble-path 정규화.
  /** 외곽선 손그림 스타일(studio-bubble-outline-style) — 미설정은 기존과 동일한 매끈한 벡터 외곽선. */
  outlineStyle?: "rough" | "wobbly";
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  shadowOpacity?: number;
  /** 커스텀 폐곡선 점 배열(요소 로컬 0,0~width,height — bubblePathData 와 동일 좌표계, 짝수 길이
   *  [x0,y0,x1,y1,...], 최소 3점/6칸). 있으면 렌더는 variant별 모양(둥근사각형·별·하트·구름 등)
   *  대신 이 폴리곤을 그린다(studio-bubble-custom-shape.ts). "커스텀 모양으로 전환" 버튼이
   *  bubblePathData/Multi 결과를 샘플링해 채운다 — tailDirection/tailXRatio/tailHeight/extraTails
   *  값 자체는 보존되지만(되돌리기용) 이 필드가 있는 동안은 렌더에 반영되지 않는다(꼬리가 이미
   *  폴리곤에 구워져 있다). */
  customShapePoints?: number[];
}

export interface FrameEl {
  id: string;
  type: "frame";
  x: number;
  y: number;
  width: number;
  height: number;
  bg?: string;
  bgColor?: string;
  stroke?: string;
  strokeWidth?: number;
  dashStyle?: "solid" | "dashed";
  /** AI 비트 시트에서 적용된 장면의 서사 역할·변화 요약. 페이지/프로젝트 JSON에 그대로 남아
   * 이후 continuity lint와 작가실 편집의 안정적인 연결점이 된다. */
  storyBeat?: {
    type: ScenarioBeatType;
    summary: string;
    continuity?: Omit<StudioStoryBeat, "sceneId">;
    textAiProvenance?: StudioTextAiProvenance;
  };
  /** AI 생성 배경이 프레임에 들어간 경우의 provenance. */
  aiProvenance?: StudioPublishAiProvenance;
  // 사선/비정형 패널 — 프레임 로컬좌표(x,y 기준) 쿼드 폴리곤 [x0,y0,x1,y1,x2,y2,x3,y3].
  // 있으면 사각형 대신 이 폴리곤으로 클립·채움·테두리를 그린다.
  points?: number[];
}

export interface StickerEl {
  id: string;
  type: "sticker";
  text: string;
  x: number;
  y: number;
  fontSize: number;
  rotation: number;
  skewX?: number; // 가로 기울임(도, -60..60) — studio-skew 직렬화 규약. 미설정=0.
  skewY?: number; // 세로 기울임(도) — studio-skew 직렬화 규약. 미설정=0.
}

export const STUDIO_BRUSH_CATALOG_ID_MAX_LENGTH = 160;
export const STUDIO_BRUSH_CATALOG_NAME_MAX_LENGTH = 120;

export interface StudioBrushCatalogIdentityMetadata {
  /** 선택한 카탈로그 항목의 안정적인 ID. 실제 렌더러는 계속 `brush`를 사용한다. */
  brushCatalogId?: string;
  /** 카탈로그가 사라져도 inspector에서 표시할 수 있는 선택 당시의 이름. */
  brushCatalogName?: string;
}

function boundedStudioBrushCatalogText(
  value: unknown,
  maximum: number
): string | undefined {
  if (typeof value !== "string") return undefined;
  let safeText = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    safeText += codePoint <= 31 || (codePoint >= 127 && codePoint <= 159) ? " " : character;
  }
  const sanitized = safeText.trim();
  if (!sanitized) return undefined;
  if (sanitized.length <= maximum) return sanitized;
  const truncated = sanitized.slice(0, maximum);
  // UTF-16 길이 한도를 지키되 surrogate pair 중간에서 자르지 않는다.
  const tail = truncated.charCodeAt(truncated.length - 1);
  return tail >= 0xd800 && tail <= 0xdbff ? truncated.slice(0, -1) : truncated;
}

/**
 * 브러시 카탈로그 identity를 문서·협업 메타데이터에 안전한 문자열로 정규화한다.
 * 이 값은 inspector/reselect 전용이며 stroke의 픽셀 결과에는 관여하지 않는다.
 */
export function normalizeStudioBrushCatalogIdentityMetadata(
  raw: unknown
): StudioBrushCatalogIdentityMetadata {
  const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const brushCatalogId = boundedStudioBrushCatalogText(
    source.brushCatalogId,
    STUDIO_BRUSH_CATALOG_ID_MAX_LENGTH
  );
  const brushCatalogName = boundedStudioBrushCatalogText(
    source.brushCatalogName,
    STUDIO_BRUSH_CATALOG_NAME_MAX_LENGTH
  );
  return {
    ...(brushCatalogId ? { brushCatalogId } : {}),
    ...(brushCatalogName ? { brushCatalogName } : {}),
  };
}

export interface DrawEl extends StudioBrushCatalogIdentityMetadata, StudioElementLayerMetadata {
  id: string;
  type: "draw";
  kind?: "freehand" | DrawShapeKind;
  mode?: "pen" | "eraser";
  points: number[];
  stroke: string;
  strokeWidth: number;
  opacity?: number;
  /**
   * Versioned stroke-level alpha semantics. Omitted persisted strokes retain their frozen
   * per-dab opacity behavior; newly authored translucent round ink opts into one-shot stroke
   * opacity so overlapping dabs cannot darken an already visible prefix.
   */
  paintModel?: StudioStrokePaintModel;
  fill?: string;
  gradient?: StudioGradientSpec; // 도형 채우기 그라데이션(멀티스톱) — 미설정이면 fill 단색.
  // 도형 채우기 패턴 — 우선순위: 패턴 > 그라데이션 > fill 단색. 타일 로드 전엔 아래 채우기가 폴백.
  pattern?: StudioPatternSpec;
  brush?: string;
  pressures?: number[];
  /**
   * Browser-standard input provenance captured at pointer-down. This records channel semantics and
   * privacy policy; commercial SDK state and hardware identifiers never enter the document.
   */
  inkInput?: StudioInkInputContract;
  /** Versioned pressure→diameter semantics. Omitted persisted strokes retain the legacy curve. */
  pressureModel?: StudioInkPressureModel;
  /**
   * Versioned paper-substrate semantics. Omitted persisted strokes retain the legacy
   * valley-multiply substrate — every coupled family depositing into the valleys, with no pressure
   * input and an exact 128-texel tile repeat.
   *
   * This key is load-bearing for finished artwork: ToonSpectrum strokes are re-planned from their
   * stored points and pressures on every render rather than rasterized at commit time, so a
   * substrate correction without a key would silently repaint every existing page.
   */
  paperModel?: StudioPaperSubstrateModel;
  /**
   * Immutable outline-renderer snapshot captured at pointer start. New perfect-freehand/G-pen
   * strokes replay this contract instead of re-resolving mutable brush catalog semantics.
   */
  outlineStroke?: StudioOutlineStrokeContractV1;
  /**
   * Versioned retained-media/FX pressure response. Omitted pencil/brush/highlighter/neon/glow
   * strokes retain their historical fixed appearance even when they contain pressure samples.
   */
  materialPressureModel?: StudioMaterialPressureModel;
  /**
   * Geometry-only minimum diameter captured from the brush settings at stroke start. Omitted
   * material strokes retain their pre-snapshot dimensions; pigment pressure is never floored.
   */
  materialMinimumDiameterRatio?: StudioMaterialMinimumDiameterRatio;
  /** 새 획을 만들 때의 논리 좌표 샘플 간격. 미설정 legacy 획은 과거 3px 렌더 규칙을 유지한다. */
  sampleSpacing?: number;
  /** 손그림(rough.js) 스케치 스타일 — 미설정이면 기존 클린 프리미티브 렌더. */
  sketch?: StudioSketchStyle;
  /** 포인트별 PointerEvent 스타일러스 메타데이터. 캘리그래피·입자 브러시에서 저장한다. */
  tiltXs?: number[];
  tiltYs?: number[];
  twists?: number[];
  /** 입자 브러시가 속도·배럴 압력을 문서와 함께 재생하기 위한 포인트별 입력. */
  speeds?: number[];
  tangentialPressures?: number[];
  /** Pointer Events Level 3 pen orientation in radians, aligned one-to-one with `points`. */
  altitudeAngles?: number[];
  azimuthAngles?: number[];
  /** Pointer contact ellipse dimensions in CSS pixels, aligned one-to-one with `points`. */
  contactWidths?: number[];
  contactHeights?: number[];
  /**
   * Monotonic authoritative event time relative to pointer-down. Absolute browser clock values and
   * predicted samples are never retained.
   */
  sampleTimeOffsets?: number[];
  /** 입자 브러시의 입력→출력 매핑 스냅샷. 저장·협업·SVG 내보내기에서 같은 dab을 재현한다. */
  brushDynamics?: NormalizedStudioBrushDynamicsSettings;
  /**
   * 이 획이 어떤 엔진 프로그램 조합으로 그려졌는지의 스냅샷.
   *
   * 없으면 브러시 id 에서 유도한 기본 조합이 쓰이고, 출하된 프리셋은 전부 이 경로다(플랜이
   * 바이트 단위로 같다는 계약을 studio-brush-engine-program-set.test.ts 가 고정한다). 사용자가
   * 브러시 스튜디오에서 조합을 바꾼 획만 이 키를 싣는다 — id 에 대응하는 프리셋이 없는 조합도
   * 저장·재생·내보내기에서 같은 그림이 나와야 하기 때문이다.
   */
  brushEnginePrograms?: StudioBrushEngineProgramSet;
  /** 이 획을 다시 열거나 내보낼 때도 같은 펜촉 결과를 재현하기 위한 스냅샷. */
  brushTip?: {
    tiltEnabled: boolean;
    angleDeg: number;
    roundness: number;
  };
  /** 스탬프 브러시 튜닝 스냅샷(흐름/경도/최소 굵기) — 미설정 시 종류별 기본값. */
  stamp?: StudioStampBrushTuning;
  /** 새 스탬프 획의 append-only raw accepted-sample 재생 규약. 미설정 획은 legacy smoothing. */
  stampPipeline?: "causal-walker-v2";
  /** 새 수채/수묵 획의 prefix-stable pigment station 규약. 미설정 획은 legacy 재배치 플래너. */
  watercolorPipeline?: "causal-walker-v2";
  // 스트로크 스타일(점선/선 끝/화살촉) — 도형·선 전용. 미설정 시 기본(실선·둥근 끝).
  strokeStyle?: StrokeStyle;
  // 도형 파라미터(별 꼭짓점/다각형 변/모서리 반경) — 미설정 시 기존 하드코딩과 동일한 기본값.
  shapeParams?: ShapeParams;
  symmetry?: {
    type: "none" | "vertical" | "horizontal" | "radial" | "kaleidoscope" | "silk";
    centerX: number;
    centerY: number;
    radialCount?: number;
  };
  /**
   * Immutable pointer-down provenance when the artist draws with a canonical linked 3D pass layer
   * selected. The ordinary DrawEl stays the correction authority; pass refresh only updates the
   * page sidecar's applied/conflict projection and never rewrites or silently drops this stroke.
   */
  linked3dCorrection?: StudioLinked3dCorrectionProvenance;
}

export interface FocusLinesEl {
  id: string;
  type: "focusLines";
  x: number;
  y: number;
  width: number;
  height: number;
  lineCount: number;
  innerRadius: number;
  outerRadius: number;
  stroke: string;
  strokeWidth: number;
  noise: number;
  rotation: number;
  opacity?: number;
  centerXRatio?: number;
  centerYRatio?: number;
}

export interface SpeedLinesEl {
  id: string;
  type: "speedLines";
  x: number;
  y: number;
  width: number;
  height: number;
  lineCount: number;
  direction: "horizontal" | "vertical";
  stroke: string;
  strokeWidth: number;
  noise?: number;
  rotation: number;
  opacity?: number;
}

interface StudioElementLayerMetadata {
  name?: string;
  hidden?: boolean;
  locked?: boolean;
  noClip?: boolean;
  opacity?: number;
  blendMode?: string;
  lockAspect?: boolean;
  groupId?: string;
  clipBelow?: boolean;
  alphaLocked?: boolean;
  maskSrc?: string;
  maskEnabled?: boolean;
  layerRole?: StudioLayerRole;
  layerColor?: StudioLayerColor;
  /** 이 요소가 이메레스 밑그림 틀로 삽입됐는지 + 어디서 왔는지 표식. 카탈로그 틀: t.id 그대로.
   *  개인 보관함 항목: `custom:${item.id}`. 두 출처 모두 "이메레스에서 온 요소"라는 사실만으로
   *  일괄 삭제 대상이 된다. */
  emeresSourceId?: string;
}

// 인터섹션으로 모든 요소 변형에 레이어 메타(표시/숨김·잠금)를 부여.
export type El = (
  | ImageEl
  | TextEl
  | BubbleEl
  | StickerEl
  | DrawEl
  | FrameEl
  | FocusLinesEl
  | SpeedLinesEl
) & StudioElementLayerMetadata;
