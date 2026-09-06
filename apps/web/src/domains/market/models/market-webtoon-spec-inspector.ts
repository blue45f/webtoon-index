/**
 * market-webtoon-spec-inspector.ts
 *
 * Webtoon 3D & Digital Asset Technical Specification & Compatibility Inspector.
 * Benchmarks Acon3D, Clip Studio Assets, Unity Asset Store, and Unreal Fab.
 *
 * - Formats: GLB/glTF, VRM, OBJ, FBX, CS3O, SKP, Portable JSON Recipe.
 * - Polycount grading for webtoon studio performance:
 *   - `ultra-light` (< 15,000 tris) - extremely fast, runs on mobile/low-end tablets.
 *   - `optimal-webtoon` (15,000 ~ 100,000 tris) - golden standard for webtoon scene rendering.
 *   - `mid-poly` (100,000 ~ 300,000 tris) - high-detail hero prop or complex architecture.
 *   - `heavy-warning` (> 300,000 tris) - lag hazard for webtoon canvas, triggers LOD advice.
 * - Shading & line render capability verification:
 *   - `line-art` (clean edge extraction for black-and-white comic lineart)
 *   - `cel-shading` (stepped toon shade ramps)
 *   - `day-night-toggle` (supports night/sunset emission textures)
 *   - `dynamic-components` (movable doors, detachable furniture layers)
 */

export type AssetFormatId =
  | "glb"
  | "gltf"
  | "vrm"
  | "obj"
  | "fbx"
  | "cs3o"
  | "skp"
  | "clip-sut"
  | "portable-json";

export type PolycountGrade =
  | "ultra-light"
  | "optimal-webtoon"
  | "mid-poly"
  | "heavy-warning";

export interface Asset3dMeshMetadata {
  readonly triangleCount: number;
  readonly vertexCount: number;
  readonly textureResolutionMax: number; // e.g. 1024, 2048, 4096, 8192
  readonly hasLineExtractionSupport: boolean;
  readonly hasCelShadingPreset: boolean;
  readonly hasDayNightVariants: boolean;
  readonly dynamicLayerCount?: number; // e.g. doors, windows, props toggles
  readonly format: AssetFormatId;
}

export interface WebtoonSpecAuditReport {
  readonly polycountGrade: PolycountGrade;
  readonly polycountSummaryKo: string;
  readonly isPerformanceSafeForStudio: boolean;
  readonly recommendedLODAction?: string;
  readonly lineArtReadiness: "ready" | "needs-threshold-tuning" | "unsupported";
  readonly textureAudit: {
    readonly isSafeForWebtoon: boolean;
    readonly warning?: string;
  };
  readonly featuresAvailable: readonly string[];
}

export class MarketWebtoonSpecInspector {
  /**
   * Audits 3D/digital asset technical metadata against webtoon production standards.
   */
  public audit(meta: Asset3dMeshMetadata): WebtoonSpecAuditReport {
    // 1. Grade Polycount
    let polycountGrade: PolycountGrade;
    let polycountSummaryKo: string;
    let isSafe = true;
    let lodAction: string | undefined;

    if (meta.triangleCount < 15_000) {
      polycountGrade = "ultra-light";
      polycountSummaryKo = "초경량 모바일/태블릿 최적화 에셋";
    } else if (meta.triangleCount <= 100_000) {
      polycountGrade = "optimal-webtoon";
      polycountSummaryKo = "웹툰 캔버스 쾌적 연출 최적화 에셋";
    } else if (meta.triangleCount <= 300_000) {
      polycountGrade = "mid-poly";
      polycountSummaryKo = "디테일 중대형 배경 (다수 배치 시 주의)";
      lodAction = "단일 씬 5개 초과 배치 시 브라우저 프레임 저하에 주의하세요.";
    } else {
      polycountGrade = "heavy-warning";
      polycountSummaryKo = "고밀도 하이폴리곤 에셋 (웹툰 캔버스 경고)";
      isSafe = false;
      lodAction = "폴리곤 감축(Decimate) 또는 원경 배치용 LOD 모델 사용을 강력 권장합니다.";
    }

    // 2. Line Art Readiness
    let lineArtReadiness: "ready" | "needs-threshold-tuning" | "unsupported" = "unsupported";
    if (meta.hasLineExtractionSupport) {
      lineArtReadiness = "ready";
    } else if (["glb", "gltf", "obj", "cs3o", "skp"].includes(meta.format)) {
      lineArtReadiness = "needs-threshold-tuning";
    }

    // 3. Texture Resolution Audit (Over 4096 is dangerous for web canvases)
    const isTextureSafe = meta.textureResolutionMax <= 4096;
    const textureWarning = meta.textureResolutionMax > 4096
      ? `텍스처가 ${meta.textureResolutionMax}px로 매우 큽니다. 2048px 리사이징을 권장합니다.`
      : undefined;

    // 4. Collect Available Webtoon Features
    const features: string[] = [];
    if (meta.hasLineExtractionSupport) {
      features.push("웹툰 은선(Line-art) 원클릭 추출 지원");
    }
    if (meta.hasCelShadingPreset) {
      features.push("명암 셀 셰이딩(Toon Shading) 내장");
    }
    if (meta.hasDayNightVariants) {
      features.push("낮/노을/야경 조명 3단 변환 지원");
    }
    if (meta.dynamicLayerCount && meta.dynamicLayerCount > 0) {
      features.push(`동적 개폐/분리 레이어 ${meta.dynamicLayerCount}종 포함`);
    }

    return {
      polycountGrade,
      polycountSummaryKo,
      isPerformanceSafeForStudio: isSafe,
      recommendedLODAction: lodAction,
      lineArtReadiness,
      textureAudit: {
        isSafeForWebtoon: isTextureSafe,
        warning: textureWarning,
      },
      featuresAvailable: features,
    };
  }

  /**
   * Returns human-readable label for asset format.
   */
  public getFormatLabel(format: AssetFormatId): string {
    switch (format) {
      case "glb":
        return "GLB (웹 표준 바이너리 3D)";
      case "gltf":
        return "glTF (텍스처 분리형 3D)";
      case "vrm":
        return "VRM (인체 관절 리깅 3D 아바타)";
      case "obj":
        return "OBJ (범용 3D 오브젝트)";
      case "fbx":
        return "FBX (애니메이션 3D)";
      case "cs3o":
        return "CS3O (클립스튜디오 3D)";
      case "skp":
        return "SKP (스케치업 웹툰 배경)";
      case "clip-sut":
        return "SUT (클립스튜디오 브러시)";
      case "portable-json":
        return "Portable JSON (툰스펙트럼 규격)";
      default:
        return format;
    }
  }
}
