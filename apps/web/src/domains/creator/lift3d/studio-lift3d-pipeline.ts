/**
 * Studio Lift 3D — 원화 한 장을 3D 모델로 바꾸는 전체 경로.
 *
 * 픽셀 → 작업 격자 → 실루엣 마스크 → 깊이장 → 편집 가능 메시 → 텍스처 GLB.
 * 각 단계는 옆 모듈에 순수 함수로 들어 있고, 여기서는 프리셋과 예산, 진단만 엮는다.
 *
 * 결과에는 메시 권위 해시가 함께 실린다. 같은 원화·같은 설정이면 항상 같은 해시가 나오므로
 * 재생성 여부를 바이트 비교 없이 판정할 수 있고, DCC 워크벤치의 GLB 내보내기 계약과도 맞물린다.
 */

import {
  diagnoseStudioEditableMesh,
  hashStudioEditableMesh,
  studioEditableMeshStats,
} from "../studio-editable-half-edge-mesh";

import {
  STUDIO_LIFT3D_LIMITS,
  STUDIO_LIFT3D_REVISION,
  clampStudioLift3dResolution,
  studioLift3dFailure,
  studioLift3dSuccess,
  studioLift3dWarning,
  validateStudioLift3dSource,
  type StudioLift3dDepthProfile,
  type StudioLift3dGeometryMode,
  type StudioLift3dMaskMode,
  type StudioLift3dResult,
  type StudioLift3dSourceImage,
  type StudioLift3dSubject,
  type StudioLift3dTexture,
  type StudioLift3dWarning,
} from "./studio-lift3d-contract";
import {
  STUDIO_LIFT3D_MAX_DEPTH_BANDS,
  buildStudioLift3dDepthField,
  clampStudioLift3dBandCount,
  type StudioLift3dDepthField,
} from "./studio-lift3d-depth";
import { encodeStudioLift3dGlb, type StudioLift3dGlbFile } from "./studio-lift3d-glb";
import {
  extractStudioLift3dMask,
  resampleStudioLift3dImage,
  type StudioLift3dMask,
} from "./studio-lift3d-mask";
import {
  buildStudioLift3dGeometry,
  maxStudioLift3dResolutionForLayers,
  type StudioLift3dGeometry,
} from "./studio-lift3d-mesh";
import {
  findStudioLift3dSymmetryAxis,
  symmetrizeStudioLift3dHeights,
  type StudioLift3dSymmetry,
} from "./studio-lift3d-symmetry";

import type { StudioLift3dRenderBuffers } from "./studio-lift3d-render-buffers";

export interface StudioLift3dPreset {
  readonly geometryMode: StudioLift3dGeometryMode;
  readonly depthProfile: StudioLift3dDepthProfile;
  /** 피사체 최대 변 대비 두께 비율. */
  readonly depthScale: number;
  readonly baseScale: number;
  readonly resolution: number;
  readonly smoothing: number;
  readonly maskMode: StudioLift3dMaskMode;
  readonly keepLargestPart: boolean;
  /** scene unit 기준 완성 높이. */
  readonly targetHeight: number;
  /** 전체 두께 중 앞쪽 비율. inflate 에서만 쓰인다. */
  readonly frontRatio: number;
  /** 좌우대칭 보정 강도(0..1). 축이 충분히 대칭일 때만 실제로 걸린다. */
  readonly symmetryStrength: number;
  readonly alphaMode: "MASK" | "OPAQUE";
  readonly label: string;
  readonly hint: string;
}

/**
 * 프리셋 수치는 웹툰 원화의 실제 사용 맥락에서 잡았다.
 * - character: 사람 키 1.7 scene unit, 실루엣 폭의 30% 두께 — 옆에서 봐도 종이 인형이 아니다.
 * - prop: 손에 드는 소품 40cm, 더 두툼하게(55%).
 * - background: 배경은 뒤집어 볼 일이 없으므로 부조 슬래브. 얕은 돌출(10%)이 원근을 살린다.
 */
export const STUDIO_LIFT3D_PRESETS: Readonly<Record<StudioLift3dSubject, StudioLift3dPreset>> =
  Object.freeze({
    character: Object.freeze({
      geometryMode: "inflate",
      depthProfile: "round",
      depthScale: 0.3,
      baseScale: 0,
      resolution: 176,
      smoothing: 3,
      maskMode: "auto",
      keepLargestPart: true,
      targetHeight: 1.7,
      // 정면을 보는 인물은 가슴이 등보다 나온다. 앞을 조금 더 준다.
      frontRatio: 0.62,
      symmetryStrength: 0.7,
      alphaMode: "MASK",
      label: "캐릭터",
      hint: "배경을 지운 PNG 를 넣으면 실루엣을 앞뒤로 부풀려 닫힌 입체로 만듭니다",
    }),
    prop: Object.freeze({
      geometryMode: "inflate",
      depthProfile: "round",
      depthScale: 0.55,
      baseScale: 0,
      resolution: 144,
      smoothing: 2,
      maskMode: "auto",
      keepLargestPart: true,
      targetHeight: 0.4,
      frontRatio: 0.5,
      // 소품은 좌우대칭이라는 보장이 없다(컵 손잡이, 칼자루).
      symmetryStrength: 0,
      alphaMode: "MASK",
      label: "소품 · 오브젝트",
      hint: "컵·의자·무기처럼 손에 드는 물건. 캐릭터보다 두툼하게 부풀립니다",
    }),
    background: Object.freeze({
      geometryMode: "relief",
      depthProfile: "relief",
      depthScale: 0.1,
      baseScale: 0.02,
      resolution: 224,
      smoothing: 1,
      maskMode: "full",
      keepLargestPart: false,
      targetHeight: 6,
      frontRatio: 0.5,
      symmetryStrength: 0,
      alphaMode: "OPAQUE",
      label: "배경",
      hint: "명암을 높이로 읽어 부조로 세웁니다. 카메라를 움직이면 원근이 살아납니다",
    }),
  });

export interface StudioLift3dRequest {
  readonly subject: StudioLift3dSubject;
  readonly resolution?: number;
  readonly depthScale?: number;
  readonly smoothing?: number;
  readonly depthProfile?: StudioLift3dDepthProfile;
  readonly maskMode?: StudioLift3dMaskMode;
  readonly alphaThreshold?: number;
  readonly keyTolerance?: number;
  readonly targetHeight?: number;
  /** 어두운 면이 앞으로 나오게 뒤집는다(역광 배경). relief 프로파일에서만 의미가 있다. */
  readonly invertRelief?: boolean;
  readonly keepLargestPart?: boolean;
  /** 전체 두께 중 앞쪽 비율(0..1). inflate 에서만 의미가 있다. */
  readonly frontRatio?: number;
  /** 좌우대칭 보정 강도(0..1). 축이 충분히 대칭일 때만 걸린다. */
  readonly symmetryStrength?: number;
  /**
   * 2 이상이면 깊이를 그만큼의 밴드로 잘라 시차 카드를 세운다(`parallax`).
   * 비우거나 1 이면 프리셋의 기본 위상을 쓴다. **정수**여야 한다 — 층은 개수이고,
   * 분수를 반올림하면 위상이 조용히 바뀐다.
   */
  readonly layerBands?: number;
}

export interface StudioLift3dMetrics {
  readonly gridWidth: number;
  readonly gridHeight: number;
  readonly coverage: number;
  readonly vertexCount: number;
  readonly faceCount: number;
  readonly triangleCount: number;
  readonly boundaryEdgeCount: number;
  /** 남은 비다양체/나비 진단 건수. 0 이어야 유효한 solid 다. */
  readonly topologyErrorCount: number;
  readonly closed: boolean;
  /** 서로 떨어진 조각 수. 시차 레이어가 아니면 1 이다. */
  readonly layerCount: number;
  /** 좌우대칭 점수(0..1). 축을 찾지 못했으면 null. */
  readonly symmetryScore: number | null;
  /** 대칭 보정을 실제로 걸었는지. */
  readonly symmetryApplied: boolean;
}

export interface StudioLift3dLift {
  readonly revision: typeof STUDIO_LIFT3D_REVISION;
  readonly subject: StudioLift3dSubject;
  readonly mask: StudioLift3dMask;
  readonly depth: StudioLift3dDepthField;
  readonly geometry: StudioLift3dGeometry;
  readonly metrics: StudioLift3dMetrics;
  /** `hashStudioEditableMesh` 권위 다이제스트. 같은 입력이면 같은 값. */
  readonly meshHash: string;
}

function resolveRequest(request: StudioLift3dRequest, layerBands: number): {
  readonly preset: StudioLift3dPreset;
  readonly resolution: number;
  readonly warnings: StudioLift3dWarning[];
} {
  const preset = STUDIO_LIFT3D_PRESETS[request.subject];
  const warnings: StudioLift3dWarning[] = [];
  // 레이어를 쌓으면 같은 해상도가 몇 배의 면을 만든다. 상한을 여기서 미리 낮춰 두면
  // 두 슬라이더를 각각 최대로 올린 조합이 "항상 예산 초과" 로만 끝나는 일이 없다.
  const clamped = clampStudioLift3dResolution(
    request.resolution ?? preset.resolution,
    layerBands >= 2 ? maxStudioLift3dResolutionForLayers(layerBands) : undefined,
  );
  if (clamped.warning !== null) warnings.push(clamped.warning);
  return { preset, resolution: clamped.resolution, warnings };
}

/** 남은 위상 오류(비다양체 변·나비 정점) 개수. `closed` 판정과 경고가 함께 쓴다. */
function countStudioLift3dTopologyErrors(geometry: StudioLift3dGeometry): number {
  let errors = 0;
  for (const diagnostic of diagnoseStudioEditableMesh(geometry.mesh)) {
    if (diagnostic.severity === "error") errors += 1;
  }
  return errors;
}

/** 면 루프 길이 합에서 삼각형 수를 센다(부채꼴 분할 기준: n각형 → n−2개). */
function countStudioLift3dTriangles(geometry: StudioLift3dGeometry): number {
  let loopHalfEdges = 0;
  for (const halfEdge of geometry.mesh.halfEdges) {
    if (halfEdge.face >= 0) loopHalfEdges += 1;
  }
  return Math.max(0, loopHalfEdges - 2 * geometry.mesh.faces.length);
}

interface SymmetryOutcome {
  readonly depth: StudioLift3dDepthField;
  readonly detected: StudioLift3dSymmetry | null;
  readonly applied: boolean;
  readonly skipped: StudioLift3dWarning | null;
}

/**
 * 좌우대칭 축을 찾아 깊이를 고르게 편다.
 *
 * 점수가 낮으면 **걸지 않는다**. 옆모습이거나 한 장에 여러 대상이 있는 원화를 억지로 접으면
 * 없던 두께가 생긴다. 그 사실은 조용히 넘기지 않고 경고로 알린다 — 캐릭터 프리셋에서
 * 기대한 보정이 안 걸린 이유를 사용자가 알 수 있어야 한다.
 */
function applySymmetry(
  mask: StudioLift3dMask,
  depth: StudioLift3dDepthField,
  options: { readonly strength: number; readonly enabled: boolean },
): SymmetryOutcome {
  if (!options.enabled || options.strength <= 0) {
    return { depth, detected: null, applied: false, skipped: null };
  }
  const detected = findStudioLift3dSymmetryAxis(mask);
  if (detected === null) {
    return { depth, detected: null, applied: false, skipped: null };
  }
  if (!detected.confident) {
    return {
      depth,
      detected,
      applied: false,
      skipped: studioLift3dWarning(
        "symmetry-skipped",
        `좌우대칭이 뚜렷하지 않아(${Math.round(detected.score * 100)}%) 대칭 보정을 걸지 않았습니다`,
      ),
    };
  }
  return {
    depth: {
      ...depth,
      heights: symmetrizeStudioLift3dHeights(
        depth.heights,
        mask,
        detected.axisX,
        options.strength,
      ),
    },
    detected,
    applied: true,
    skipped: null,
  };
}

/**
 * 원화 한 장을 3D 지오메트리로 들어올린다.
 *
 * 실패는 예외가 아니라 사유 코드로 돌려준다 — 업로드한 그림이 파이프라인과 안 맞는 것은
 * 버그가 아니라 흔한 입력이고, UI 는 그 사유를 그대로 보여줘야 한다.
 */
export function liftStudioImageTo3d(
  source: StudioLift3dSourceImage,
  request: StudioLift3dRequest,
): StudioLift3dResult<StudioLift3dLift> {
  const validated = validateStudioLift3dSource(source);
  if (!validated.ok) return validated;
  if (!(request.subject in STUDIO_LIFT3D_PRESETS)) {
    return studioLift3dFailure("invalid-option", "알 수 없는 피사체 종류입니다");
  }
  // 아래 clampStudioLift3dUnit 이 비유한 값을 0 으로 떨구므로, 걸러내지 않으면 "보정을 걸었다"고
  // 보고하면서 실제로는 아무것도 하지 않는 상태가 된다.
  if (request.symmetryStrength !== undefined
    && (!Number.isFinite(request.symmetryStrength)
      || request.symmetryStrength < 0
      || request.symmetryStrength > 1)) {
    return studioLift3dFailure(
      "invalid-option",
      "symmetryStrength 는 0..1 사이의 유한한 값이어야 합니다",
    );
  }
  // NaN 은 프리셋 위상으로 조용히 흘러가고, Infinity 는 parallax 를 고른 뒤 밴드 하나로 조여져
  // "카드 한 장짜리 시차 레이어" 라는 앞뒤 안 맞는 결과가 된다. 모드를 고르기 전에 막는다.
  // 층 수는 **개수**다. 분수를 받아 반올림하면 1.5 가 조용히 2 로 올라가 프리셋 위상 대신
  // parallax 가 되는데, 비교가 이미 반올림된 값으로 이뤄져 조정 경고조차 나가지 않는다.
  // 값을 고치지 말고 계약을 분명히 한다.
  if (request.layerBands !== undefined
    && (!Number.isInteger(request.layerBands) || request.layerBands < 1)) {
    return studioLift3dFailure("invalid-option", "layerBands 는 1 이상의 정수여야 합니다");
  }

  // 밴드 수는 **위상·해상도를 고르기 전에 한 번** 조인다. 원값을 그대로 쓰면 24 를 넘는 요청이
  // 해상도 상한만 쓸데없이 깎고, 지오메트리는 뒤늦게 24 로 조여 둘이 어긋난다.
  const requestedBands = request.layerBands ?? 1;
  const layerBands = clampStudioLift3dBandCount(requestedBands);
  const { preset, resolution, warnings } = resolveRequest(request, layerBands);
  if (layerBands !== requestedBands) {
    warnings.push(studioLift3dWarning(
      "layer-bands-clamped",
      `시차 레이어를 1~${STUDIO_LIFT3D_MAX_DEPTH_BANDS} 범위의 ${layerBands}층으로 조정했습니다`,
    ));
  }
  const grid = resampleStudioLift3dImage(validated.value, resolution);
  const mask = extractStudioLift3dMask(grid, {
    mode: request.maskMode ?? preset.maskMode,
    alphaThreshold: request.alphaThreshold,
    keyTolerance: request.keyTolerance,
    keepLargestPart: request.keepLargestPart ?? preset.keepLargestPart,
  });
  warnings.push(...mask.warnings);

  if (mask.bounds === null || mask.coverage <= 0) {
    return studioLift3dFailure(
      "empty-subject",
      "피사체를 찾지 못했습니다. 배경을 지운 PNG 를 쓰거나 마스크 방식을 바꿔 보세요",
    );
  }
  if (mask.coverage < STUDIO_LIFT3D_LIMITS.minSubjectCoverage) {
    return studioLift3dFailure(
      "empty-subject",
      "피사체가 화면에서 너무 작습니다. 원화를 잘라 확대한 뒤 다시 시도해 주세요",
    );
  }

  const profile = request.depthProfile ?? preset.depthProfile;
  const depth = buildStudioLift3dDepthField(mask, grid, {
    profile,
    smoothing: request.smoothing ?? preset.smoothing,
    invertRelief: request.invertRelief,
    edgeTaper: profile === "relief" && mask.mode !== "full" ? 0.35 : 0,
  });
  if (profile !== "relief" && depth.maxDistance < 2) {
    warnings.push(studioLift3dWarning(
      "shallow-subject",
      "실루엣이 가늘어 두께가 거의 나오지 않습니다. 해상도를 올려 보세요",
    ));
  }

  const mode = layerBands >= 2 ? "parallax" : preset.geometryMode;
  const symmetry = applySymmetry(mask, depth, {
    strength: request.symmetryStrength ?? preset.symmetryStrength,
    // 대칭 보정은 앞뒤를 부풀리는 위상에서만 뜻이 있다. 부조·시차 카드의 높이는 명암이
    // 정하므로 좌우로 평균 내면 원화에 없는 형태가 생긴다.
    enabled: mode === "inflate",
  });
  if (symmetry.skipped !== null) warnings.push(symmetry.skipped);

  const built = buildStudioLift3dGeometry(mask, symmetry.depth, {
    mode,
    depthScale: request.depthScale ?? preset.depthScale,
    baseScale: preset.baseScale,
    targetHeight: request.targetHeight ?? preset.targetHeight,
    frontRatio: request.frontRatio ?? preset.frontRatio,
    layerBands,
  });
  if (!built.ok) return built;
  warnings.push(...built.warnings);

  const geometry = built.value;
  const topologyErrors = countStudioLift3dTopologyErrors(geometry);
  if (topologyErrors > 0) {
    warnings.push(studioLift3dWarning(
      "non-manifold-residual",
      `위상 경고 ${topologyErrors}건이 남았습니다. 3D 프린팅용으로 쓰려면 해상도를 낮춰 다시 만들어 보세요`,
    ));
  }
  const stats = studioEditableMeshStats(geometry.mesh);

  return studioLift3dSuccess(
    {
      revision: STUDIO_LIFT3D_REVISION,
      subject: request.subject,
      mask,
      // 메시를 만든 것과 **같은** 깊이장을 돌려준다. 대칭 보정을 걸어 놓고 원본을 돌려주면
      // 깊이 미리보기와 실제 형상이 어긋난다.
      depth: symmetry.depth,
      geometry,
      metrics: {
        gridWidth: grid.width,
        gridHeight: grid.height,
        coverage: mask.coverage,
        vertexCount: stats.vertexCount,
        faceCount: stats.faceCount,
        triangleCount: countStudioLift3dTriangles(geometry),
        boundaryEdgeCount: stats.boundaryEdgeCount,
        topologyErrorCount: topologyErrors,
        layerCount: geometry.layerCount,
        symmetryScore: symmetry.detected?.score ?? null,
        symmetryApplied: symmetry.applied,
        // 열린 변이 없다고 곧바로 solid 인 것은 아니다. 비다양체 변이 남아 있으면 경계는
        // 닫혀 있어도 유효한 solid 가 아니므로, 두 조건을 모두 만족할 때만 닫혔다고 말한다.
        closed: stats.boundaryEdgeCount === 0 && topologyErrors === 0,
      },
      meshHash: hashStudioEditableMesh(geometry.mesh),
    },
    warnings,
  );
}

export interface StudioLift3dExport {
  readonly lift: StudioLift3dLift;
  readonly glb: StudioLift3dGlbFile;
  /**
   * GLB 에 실린 것과 **같은** 버퍼. 화면 미리보기가 이걸 그대로 쓰면 삼각형화와 법선 계산을
   * 두 번 하지 않고, 파일과 화면이 어긋날 여지도 없다.
   */
  readonly buffers: StudioLift3dRenderBuffers;
}

export interface StudioLift3dExportOptions {
  readonly name: string;
  readonly texture?: StudioLift3dTexture | null;
  /** 원화를 조명 없이 그대로 보여줄지. 웹툰 원화는 대개 켜 두는 편이 원본에 가깝다. */
  readonly unlit?: boolean;
}

/** 리프트 + GLB 인코딩을 한 번에. UI 의 "3D 로 변환" 버튼이 부르는 진입점이다. */
export function liftStudioImageTo3dGlb(
  source: StudioLift3dSourceImage,
  request: StudioLift3dRequest,
  options: StudioLift3dExportOptions,
): StudioLift3dResult<StudioLift3dExport> {
  const lifted = liftStudioImageTo3d(source, request);
  if (!lifted.ok) return lifted;
  const preset = STUDIO_LIFT3D_PRESETS[request.subject];
  const encoded = encodeStudioLift3dGlb(lifted.value.geometry, {
    name: options.name,
    texture: options.texture ?? null,
    alphaMode: preset.alphaMode,
    unlit: options.unlit,
  });
  if (!encoded.ok) return encoded;
  return studioLift3dSuccess(
    { lift: lifted.value, glb: encoded.value, buffers: encoded.value.buffers },
    [...lifted.warnings, ...encoded.warnings],
  );
}
