/**
 * Studio High-Bit — 와이드 개멋/고비트 능력 탐지와 정책 결정.
 *
 * 브라우저 호환성보다 품질을 우선한다는 결정에 따라, "지원되면 켠다"가 아니라
 * **"지원되면 P3 로 작업하고, 아니면 sRGB 로 안전 강등한다"** 는 명시적 계획을 만든다.
 * 탐지 자체는 부수효과가 있으므로(캔버스 생성) 순수 결정 함수와 분리했다 —
 * `resolveStudioHighBitCapability` 는 프로브 결과만 받는 순수 함수라 테스트 가능하다.
 *
 * 실측 주의:
 *   - `canvas.getContext("2d", { colorSpace: "display-p3" })` 는 **미지원 브라우저에서도
 *     예외를 던지지 않고** sRGB 컨텍스트를 돌려준다. 반드시 `getContextAttributes().colorSpace`
 *     를 되읽어 확인해야 한다(옵션 수용 여부 ≠ 실제 적용).
 *   - `matchMedia("(color-gamut: p3)")` 는 **디스플레이**의 능력이고, 위 컨텍스트 옵션은
 *     **캔버스 파이프라인**의 능력이다. 둘 다 참일 때만 P3 작업이 사용자에게 실제 이득이다.
 */

import type { StudioHighBitStorage } from "./studio-highbit-buffer";
import type { StudioHighBitGamut, StudioHighBitGamutClipMode } from "./studio-highbit-colorspace";
import type { StudioHighBitDitherMode } from "./studio-highbit-dither";

export interface StudioHighBitCapabilityProbe {
  /** 캔버스가 `colorSpace: "display-p3"` 를 실제로 적용했는가(되읽기 확인 결과). */
  readonly canvasDisplayP3?: boolean;
  /** 디스플레이가 P3 개멋을 표시할 수 있는가(`(color-gamut: p3)`). */
  readonly displayP3Gamut?: boolean;
  /** `ImageData` 가 display-p3 색공간을 지원하는가. */
  readonly imageDataDisplayP3?: boolean;
  /** navigator.deviceMemory (GB). 미보고면 undefined. */
  readonly deviceMemoryGb?: number;
  /** 저사양/절전 힌트 — 참이면 디더는 Bayer(가장 싼 경로)로 내린다. */
  readonly lowPowerHint?: boolean;
}

export interface StudioHighBitCapabilityPlan {
  /** 합성 작업 개멋(항상 선형광). */
  readonly workingGamut: StudioHighBitGamut;
  /** 최종 출력 바이트의 개멋. */
  readonly outputGamut: StudioHighBitGamut;
  /** `getContext("2d", { colorSpace })` 에 넘길 값. */
  readonly canvasColorSpace: "srgb" | "display-p3";
  readonly storage: StudioHighBitStorage;
  readonly dither: StudioHighBitDitherMode;
  readonly gamutClip: StudioHighBitGamutClipMode;
  readonly wideGamut: boolean;
  /** 사용자/개발자에게 보여줄 한국어 근거. */
  readonly notes: readonly string[];
}

/** 프로브 결과 → 정책. 순수 함수(같은 입력 = 같은 계획). */
export function resolveStudioHighBitCapability(
  probe: StudioHighBitCapabilityProbe = {}
): StudioHighBitCapabilityPlan {
  const notes: string[] = [];
  const canvasP3 = probe.canvasDisplayP3 === true;
  const displayP3 = probe.displayP3Gamut === true;
  const wideGamut = canvasP3 && displayP3;

  if (wideGamut) {
    notes.push("캔버스와 디스플레이 모두 Display P3 를 지원해 와이드 개멋으로 작업합니다.");
  } else if (canvasP3) {
    notes.push("캔버스는 P3 를 지원하지만 디스플레이가 sRGB 라 sRGB 로 작업합니다(눈에 이득 없음).");
  } else if (displayP3) {
    notes.push("디스플레이는 P3 지만 캔버스 색공간 옵션이 적용되지 않아 sRGB 로 작업합니다.");
  } else {
    notes.push("Display P3 경로를 사용할 수 없어 sRGB 로 작업합니다.");
  }
  if (probe.imageDataDisplayP3 === false && wideGamut) {
    notes.push("ImageData 가 P3 를 지원하지 않아 픽셀 왕복은 sRGB 로 강등됩니다.");
  }

  const memory = Number.isFinite(probe.deviceMemoryGb) ? probe.deviceMemoryGb! : 0;
  const storage: StudioHighBitStorage = memory >= 8 ? "float32" : "uint16";
  notes.push(
    storage === "float32"
      ? "메모리 8GB 이상이라 레이어 표면도 float32 로 둡니다."
      : "레이어 표면은 uint16 선형 고정소수점(8비트 대비 ≥19× 정밀도, 메모리 절반)입니다."
  );

  const dither: StudioHighBitDitherMode = probe.lowPowerHint === true ? "ordered" : "blue-noise";
  notes.push(
    dither === "ordered"
      ? "저전력 힌트가 있어 Bayer 정렬 디더를 씁니다."
      : "최종 8비트 양자화에 블루노이즈 디더를 적용해 그라데이션 밴딩을 없앱니다."
  );

  return {
    workingGamut: wideGamut ? "display-p3" : "srgb",
    outputGamut: wideGamut ? "display-p3" : "srgb",
    canvasColorSpace: wideGamut ? "display-p3" : "srgb",
    storage,
    dither,
    // sRGB 로 강등될 때만 개멋 밖 색을 채도 축소로 접는다(P3 출력이면 접을 필요가 없다).
    gamutClip: wideGamut ? "clamp" : "desaturate",
    wideGamut,
    notes,
  };
}

// ---------------------------------------------------------------------------
// 브라우저 프로브 (부수효과 있음 — 주입 가능한 형태로 분리)
// ---------------------------------------------------------------------------

export interface StudioHighBitCanvasLike {
  getContext(
    contextId: "2d",
    options?: { colorSpace?: string }
  ): { getContextAttributes?: () => { colorSpace?: string } | null } | null;
}

/**
 * 캔버스가 `display-p3` 를 실제로 적용하는지 확인한다.
 * 옵션을 무시하고 sRGB 컨텍스트를 주는 브라우저를 걸러내는 것이 핵심이라, 되읽기까지 한다.
 */
export function probeStudioHighBitCanvasDisplayP3(
  createCanvas: () => StudioHighBitCanvasLike | null
): boolean {
  try {
    const canvas = createCanvas();
    const context = canvas?.getContext("2d", { colorSpace: "display-p3" });
    const attributes = context?.getContextAttributes?.();
    return attributes?.colorSpace === "display-p3";
  } catch {
    return false;
  }
}

export interface StudioHighBitEnvironmentLike {
  readonly document?: { createElement?: (tag: string) => unknown } | undefined;
  readonly matchMedia?: ((query: string) => { matches?: boolean } | null) | undefined;
  readonly navigator?: { deviceMemory?: number } | undefined;
  readonly ImageData?: unknown;
}

/**
 * 브라우저 전역에서 프로브를 수집한다. 전역을 주입받으므로 node 테스트에서도 실행 가능하다.
 * 어떤 항목이든 없으면 조용히 미지원으로 본다(예외를 밖으로 던지지 않는다).
 */
export function probeStudioHighBitEnvironment(
  environment: StudioHighBitEnvironmentLike
): StudioHighBitCapabilityProbe {
  const createCanvas = (): StudioHighBitCanvasLike | null => {
    const element = environment.document?.createElement?.("canvas");
    return (element as StudioHighBitCanvasLike | undefined) ?? null;
  };
  let imageDataDisplayP3 = false;
  const ImageDataCtor = environment.ImageData as
    | (new (width: number, height: number, settings?: { colorSpace?: string }) => {
      colorSpace?: string;
    })
    | undefined;
  if (typeof ImageDataCtor === "function") {
    try {
      imageDataDisplayP3 =
        new ImageDataCtor(1, 1, { colorSpace: "display-p3" }).colorSpace === "display-p3";
    } catch {
      imageDataDisplayP3 = false;
    }
  }
  let displayP3Gamut: boolean;
  try {
    displayP3Gamut = environment.matchMedia?.("(color-gamut: p3)")?.matches === true;
  } catch {
    displayP3Gamut = false;
  }
  const deviceMemory = environment.navigator?.deviceMemory;
  return {
    canvasDisplayP3: probeStudioHighBitCanvasDisplayP3(createCanvas),
    displayP3Gamut,
    imageDataDisplayP3,
    ...(Number.isFinite(deviceMemory) ? { deviceMemoryGb: deviceMemory } : {}),
  };
}
