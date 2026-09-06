/**
 * Studio Quality Engine Adapter — CanvasKit/Skia 를 **나중에 꽂기 위한 이음매**(순수·DOM 무의존).
 *
 * 목적: Canvas2D 로는 원리적으로 안 되는 두 가지 — (1) 제대로 된 텍스트 셰이핑(커닝·합자·복합
 * 문자·양방향), (2) 고품질 패스 연산(베지어를 보존한 불리언, 획→패스 변환) — 을 담당할 엔진을
 * **인터페이스 뒤로 숨긴다**. CanvasKit은 작업 시작 전에 명시적으로 선택되고, 로드나 실행이
 * 실패하면 unavailable로 닫힌다. 아래의 순수 JS basic-reference 구현은 레이아웃 연구·테스트에서
 * 직접 요청할 수 있을 뿐 CanvasKit 실패 뒤 자동 실행되지 않는다.
 *
 * ── 지금 이 저장소의 실제 상태(2026-07-28 실측) ─────────────────────────────
 *  - `canvaskit-wasm@0.41.1` 과 실제 quality provider가 설치돼 있다. provider만 동적 import하고
 *    이 계약 모듈은 CanvasKit을 import하지 않아 Studio 초기 정적 그래프는 오염시키지 않는다.
 *  - 텍스트는 `StudioKonvaTextNodes.tsx`(Konva `Text` = canvas `fillText`)와
 *    `studio-svg-export.ts`(`<text>`)로 그려진다. 둘 다 셰이핑 엔진이 아니라 **플랫폼 텍스트
 *    렌더러**라, 어떤 OpenType 피처를 켤지 지정할 수 없다. `studio-vertical-text.ts` 의 주석이
 *    이미 같은 사실을 적어 두었다("둘 다 OpenType vert/vrt2 피처를 켤 방법이 없다").
 *  - 패스 불리언은 `studio-path-boolean.ts` 가 polygon-clipping 으로 한다 — 곡선을 ≥64 세그먼트로
 *    **평탄화**한 뒤 폴리곤으로 계산하고, 구멍은 폭 0 브리지(키홀)로 잇는다. 정확하지만 곡선이
 *    사라지고 점이 폭증한다. Skia `PathOps` 는 베지어를 베지어로 유지한다.
 *
 * ── 어댑터 계약 ─────────────────────────────────────────────────────────────
 * `StudioQualityEngine` 는 **동기** 인터페이스다(그리기 루프에서 부르므로). 비동기인 것은 엔진을
 * 얻는 과정(`resolveQualityEngine`)뿐이고, 이는 WASM 로드가 lazy 청크여야 한다는 요구에서 온다.
 * 로드가 실패하면 선택한 CanvasKit 공급자를 unavailable로 보고한다. 다른 구현을 쓰려면 다음
 * 작업에서 호출자가 별도로 선택해야 한다.
 */

import { StudioEngineUnavailableError } from "./studio-engine-failure-policy";

// ---------------------------------------------------------------------------
// 셰이핑 계약
// ---------------------------------------------------------------------------

export interface StudioShapingFeatures {
  /** 커닝(`kern`). basic-reference는 무시한다. */
  kerning?: boolean;
  /** 표준 합자(`liga`). basic-reference는 무시한다. */
  ligatures?: boolean;
  /** 세로쓰기 대체(`vert`/`vrt2`). basic-reference는 무시한다. */
  vertical?: boolean;
}

export interface StudioTextShapingRequest {
  text: string;
  fontFamily: string;
  fontSizePx: number;
  letterSpacingPx?: number;
  /** 주면 줄바꿈을 수행한다. 없으면 한 줄. */
  maxWidthPx?: number;
  direction?: "ltr" | "rtl";
  features?: StudioShapingFeatures;
}

export interface StudioShapedGlyph {
  /** 실제 셰이퍼만 채운다. basic-reference는 null(글리프 id 를 알 방법이 없다). */
  glyphId: number | null;
  /** 원본 문자열에서의 코드포인트 인덱스(클러스터). */
  cluster: number;
  advancePx: number;
  xOffsetPx: number;
  yOffsetPx: number;
}

export interface StudioShapedLine {
  text: string;
  startCluster: number;
  endCluster: number;
  widthPx: number;
}

export interface StudioShapedRun {
  glyphs: readonly StudioShapedGlyph[];
  lines: readonly StudioShapedLine[];
  widthPx: number;
  ascentPx: number;
  descentPx: number;
  /**
   * 진짜 셰이핑이 일어났는가. **false 면 커닝·합자·복합문자 결합이 적용되지 않은 근사다** —
   * UI 는 이 값을 그대로 노출해야 하고, PDF 텍스트 배치처럼 정밀도가 필요한 곳은 false 일 때
   * 텍스트를 아웃라인으로 굽는 대신 경고를 띄워야 한다.
   */
  shaped: boolean;
  /** basic-reference가 못 한 것들(한국어). shaped=true 면 빈 배열. */
  limitations: readonly string[];
}

// ---------------------------------------------------------------------------
// 패스 연산 계약
// ---------------------------------------------------------------------------

export type StudioQualityPathOp = "union" | "intersect" | "difference" | "xor";

export interface StudioStrokeToPathStyle {
  widthPx: number;
  cap: "butt" | "round" | "square";
  join: "miter" | "round" | "bevel";
  miterLimit: number;
  dash?: { pattern: readonly number[]; phase: number };
}

export const STUDIO_PORTABLE_PATH_GEOMETRY_VERSION = 1 as const;

export interface StudioPortablePathGeometryContour {
  /** Flattened document-space point pairs: [x0, y0, x1, y1, ...]. */
  readonly points: readonly number[];
  readonly closed: boolean;
}

/**
 * Vendor-neutral, bounded geometry extracted while the CanvasKit Path is still alive.
 *
 * This is a settled-operation suggestion only. CanvasKit verbs, Embind objects and WASM
 * pointers never cross the Worker boundary, and the saved document remains ToonSpectrum-owned.
 */
export interface StudioPortablePathGeometry {
  readonly kind: "studio-portable-path-geometry";
  readonly version: typeof STUDIO_PORTABLE_PATH_GEOMETRY_VERSION;
  readonly fillRule: "nonzero";
  readonly flatnessPx: number;
  readonly bounds: Readonly<{
    readonly minX: number;
    readonly minY: number;
    readonly maxX: number;
    readonly maxY: number;
    readonly width: number;
    readonly height: number;
  }>;
  readonly contours: readonly StudioPortablePathGeometryContour[];
  readonly flattenedPointCount: number;
  readonly sourceCommandValueCount: number;
}

export type StudioPathOpsResult =
  | {
      ok: true;
      pathData: string;
      /** Present for CanvasKit Worker results; optional for narrow reference/test providers. */
      geometry?: StudioPortablePathGeometry;
    }
  | { ok: false; reason: string };

// ---------------------------------------------------------------------------
// 엔진 인터페이스
// ---------------------------------------------------------------------------

export interface StudioQualityEngineCapabilities {
  /** OpenType 셰이핑(커닝·합자·복합 문자·양방향). */
  textShaping: boolean;
  /** 베지어를 보존하는 패스 불리언. */
  pathBoolean: boolean;
  /** 획을 채움 패스로 변환(`getFillPath`). */
  strokeToPath: boolean;
  /** 글꼴 서브셋(임베드 크기 절감). */
  fontSubsetting: boolean;
}

export interface StudioQualityEngine {
  readonly id: "basic-reference" | "canvaskit";
  readonly capabilities: StudioQualityEngineCapabilities;
  shapeText(request: StudioTextShapingRequest): StudioShapedRun;
  /** SVG path data 두 개를 불리언 결합. 미지원이면 `{ ok:false, reason }`. */
  pathOp(a: string, b: string, op: StudioQualityPathOp): StudioPathOpsResult;
  /** 획을 채움 패스로. 미지원이면 `{ ok:false, reason }`. */
  strokeToPath(pathData: string, style: StudioStrokeToPathStyle): StudioPathOpsResult;
}

// ---------------------------------------------------------------------------
// 명시적 basic-reference 구현 — 실제로 쓸모 있는 만큼만 하고 한계를 숨기지 않는다.
// ---------------------------------------------------------------------------

/**
 * 글자 하나의 전진폭을 재는 포트. 기본 구현은 유니코드 블록 기반 **추정치**다(아래 표 참고).
 * 브라우저에서는 `createCanvasAdvanceMeasurer()` 처럼 `ctx.measureText` 를 감싼 것을 주입하면
 * 실제 폭이 되지만, 그래도 **셰이핑은 아니다**(커닝·합자는 여전히 없음).
 */
export type StudioAdvanceMeasurer = (char: string, fontSizePx: number, fontFamily: string) => number;

/**
 * 폭 추정 표(em 배수). 정확한 값이 아니라 **레이아웃이 무너지지 않을 정도의 근사**다.
 *  - 한중일 표의문자·한글 음절·전각 구두점: 1.0em(전각)
 *  - 반각 가타카나·라틴: 0.5em
 *  - 공백: 0.28em
 * 실제 폭이 필요하면 `measureAdvance` 를 주입한다.
 */
export function estimateAdvanceEm(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  if (code === 0x20) return 0.28;
  if (code === 0x09) return 1.12;
  // 한글 음절/자모, CJK 통합 한자, 가나, 전각 형태 — 전부 전각.
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x20000 && code <= 0x3fffd)
  ) {
    return 1;
  }
  return 0.5;
}

const defaultMeasurer: StudioAdvanceMeasurer = (char, fontSizePx) => estimateAdvanceEm(char) * fontSizePx;

/** 줄 끝에 혼자 남으면 안 되는 문자(행두 금칙) — 닫는 괄호·구두점. */
const NO_LINE_START = ")]}〉》」』】〕,.、。，．!?！？:;：；ㆍ·…";

const BASIC_REFERENCE_LIMITATIONS: readonly string[] = [
  "커닝(kern)·합자(liga) 등 OpenType 피처가 적용되지 않습니다.",
  "아랍어·데바나가리처럼 문자가 서로 결합하는 문자 체계는 올바르게 배치되지 않습니다.",
  "양방향(BiDi) 재정렬을 하지 않아 히브리어·아랍어가 섞이면 순서가 틀립니다.",
  "글리프 인덱스를 알 수 없어 PDF 임베드에는 별도 글꼴 메트릭이 필요합니다.",
];

export interface StudioBasicQualityEngineOptions {
  measureAdvance?: StudioAdvanceMeasurer;
  /** 폰트 크기 대비 상단/하단 — 기본값은 흔한 한글 글꼴 비율(0.88 / 0.22). */
  ascentRatio?: number;
  descentRatio?: number;
}

/**
 * 명시적으로 요청하는 basic-reference 엔진. 셰이핑 대신 **문자 단위 배치 + 줄바꿈**만 한다.
 * 줄바꿈 규칙: 공백에서 우선 끊고, 공백이 없는 CJK 는 글자 단위로 끊되 행두 금칙 문자는
 * 앞 줄로 끌어온다. 이 정도가 "웹툰 말풍선" 용도에서 실용적인 하한선이다.
 */
export function createBasicQualityEngine(
  options: StudioBasicQualityEngineOptions = {},
): StudioQualityEngine {
  const measure = options.measureAdvance ?? defaultMeasurer;
  const ascentRatio = options.ascentRatio ?? 0.88;
  const descentRatio = options.descentRatio ?? 0.22;

  return {
    id: "basic-reference",
    capabilities: { textShaping: false, pathBoolean: false, strokeToPath: false, fontSubsetting: false },

    shapeText(request: StudioTextShapingRequest): StudioShapedRun {
      const size = request.fontSizePx;
      const spacing = request.letterSpacingPx ?? 0;
      const chars = [...request.text];
      const glyphs: StudioShapedGlyph[] = [];
      let penX = 0;
      chars.forEach((char, cluster) => {
        const advance = char === "\n" ? 0 : measure(char, size, request.fontFamily) + spacing;
        glyphs.push({ glyphId: null, cluster, advancePx: advance, xOffsetPx: penX, yOffsetPx: 0 });
        penX += advance;
      });

      const lines = breakLines(chars, glyphs, request.maxWidthPx);
      const widthPx = lines.reduce((max, line) => Math.max(max, line.widthPx), 0);
      return {
        glyphs,
        lines,
        widthPx,
        ascentPx: size * ascentRatio,
        descentPx: size * descentRatio,
        shaped: false,
        limitations: BASIC_REFERENCE_LIMITATIONS,
      };
    },

    pathOp(): StudioPathOpsResult {
      return {
        ok: false,
        reason:
          "고품질 패스 연산 엔진이 없어요. 지금은 폴리곤 근사(studio-path-boolean)만 가능하고, 곡선은 직선 조각으로 바뀝니다.",
      };
    },

    strokeToPath(): StudioPathOpsResult {
      return {
        ok: false,
        reason: "획을 패스로 굽는 기능은 고품질 엔진이 있어야 해요(선 두께가 그대로 유지됩니다).",
      };
    },
  };
}

/** 줄바꿈 — maxWidth 가 없으면 개행 문자 기준으로만 나눈다. */
function breakLines(
  chars: readonly string[],
  glyphs: readonly StudioShapedGlyph[],
  maxWidthPx: number | undefined,
): StudioShapedLine[] {
  const lines: StudioShapedLine[] = [];
  let start = 0;
  let width = 0;
  let lastBreak = -1;

  const flush = (endExclusive: number): void => {
    const text = chars.slice(start, endExclusive).join("");
    let lineWidth = 0;
    for (let i = start; i < endExclusive; i++) lineWidth += glyphs[i]!.advancePx;
    lines.push({ text, startCluster: start, endCluster: endExclusive, widthPx: lineWidth });
  };

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i]!;
    if (char === "\n") {
      flush(i);
      start = i + 1;
      width = 0;
      lastBreak = -1;
      continue;
    }
    const advance = glyphs[i]!.advancePx;
    if (maxWidthPx !== undefined && width + advance > maxWidthPx && i > start) {
      // 행두 금칙: 다음 줄 첫 글자가 금칙 문자면 한 글자 더 붙여 앞 줄로 넘긴다.
      let breakAt = lastBreak > start ? lastBreak : i;
      if (breakAt < chars.length && NO_LINE_START.includes(chars[breakAt]!) && breakAt + 1 <= chars.length) {
        breakAt = Math.min(chars.length, breakAt + 1);
      }
      flush(breakAt);
      start = breakAt;
      width = 0;
      lastBreak = -1;
      for (let j = start; j <= i; j++) width += glyphs[j]!.advancePx;
      if (char === " ") lastBreak = i + 1;
      continue;
    }
    width += advance;
    if (char === " ") lastBreak = i + 1;
  }
  if (start <= chars.length) flush(chars.length);
  return lines;
}

// ---------------------------------------------------------------------------
// 엔진 해석(lazy 로더 등록 지점)
// ---------------------------------------------------------------------------

export type StudioQualityEngineLoader = () => Promise<StudioQualityEngine>;

let registeredLoader: StudioQualityEngineLoader | null = null;
let cached: StudioQualityEngine | null = null;
let pending: Promise<StudioQualityEngine> | null = null;
let lastLoadError: string | null = null;

/**
 * 고품질 엔진 로더 등록. **여기서만** canvaskit-wasm 을 `import()` 해야 한다 — 그래야 WASM 이
 * 스튜디오의 정적 청크 그래프에 들어가지 않고 별도 lazy 청크로 남는다.
 * 등록 예(의존성을 넣은 뒤):
 *   registerQualityEngineLoader(async () => {
 *     const { default: init } = await import("canvaskit-wasm");
 *     const ck = await init({ locateFile: (file) => `/canvaskit/${file}` });
 *     return createCanvasKitQualityEngine(ck);
 *   });
 */
export function registerQualityEngineLoader(loader: StudioQualityEngineLoader | null): void {
  registeredLoader = loader;
  cached = null;
  pending = null;
  lastLoadError = null;
}

/** 테스트/핫리로드용 초기화. */
export function resetQualityEngine(): void {
  registeredLoader = null;
  cached = null;
  pending = null;
  lastLoadError = null;
}

/** 마지막 로드 실패 사유(한국어). 실패한 적 없으면 null. */
export function qualityEngineLoadError(): string | null {
  return lastLoadError;
}

/**
 * 명시적으로 선택된 CanvasKit 엔진을 얻는다. 로더 부재·로드 실패·잘못된 provider 반환은
 * unavailable로 닫히며 다른 엔진을 만들지 않는다. 같은 호출이 동시에 여러 번 들어와도
 * 선택 provider의 로더는 한 번만 실행된다.
 */
export async function resolveQualityEngine(): Promise<StudioQualityEngine> {
  if (cached) return cached;
  if (!registeredLoader) {
    throw new StudioEngineUnavailableError({
      providerId: "canvaskit",
      stage: "initialization",
      message: "CanvasKit quality engine loader is not registered.",
    });
  }
  if (!pending) {
    const loader = registeredLoader;
    pending = (async () => {
      try {
        const engine = await loader();
        if (engine.id !== "canvaskit") {
          throw new Error(`selected CanvasKit loader returned ${engine.id}`);
        }
        cached = engine;
        lastLoadError = null;
        return engine;
      } catch (error) {
        lastLoadError =
          error instanceof Error
            ? `CanvasKit 엔진을 불러오지 못했어요(${error.message}). 선택한 엔진을 사용할 수 없습니다.`
            : "CanvasKit 엔진을 불러오지 못했어요. 선택한 엔진을 사용할 수 없습니다.";
        pending = null;
        throw new StudioEngineUnavailableError({
          providerId: "canvaskit",
          stage: "initialization",
          message: lastLoadError,
          cause: error,
        });
      }
    })();
  }
  return pending;
}

/** 동기 접근 — 선택한 CanvasKit이 아직 준비되지 않았으면 null이며 다른 엔진을 만들지 않는다. */
export function qualityEngineNow(): StudioQualityEngine | null {
  return cached;
}

// ---------------------------------------------------------------------------
// 번들 비용 — 실제 설치된 0.41.1 기본/full WASM의 로컬 파일 크기를 반영한다.
// ---------------------------------------------------------------------------

export interface StudioCanvasKitBundleFacts {
  /** 배포 변형 이름. */
  variant: string;
  /** 압축 전 대략 바이트. */
  approxRawBytes: number;
  /** brotli 후 대략 바이트. */
  approxBrotliBytes: number;
  note: string;
}

/**
 * `canvaskit-wasm@0.41.1` 기본 바이너리는 로컬에서 7,159,342 byte, full 바이너리는
 * 8,080,104 byte다. 압축 수치는 여전히 참고치이며 배포물 검증에서 다시 측정한다. 번들 크기는
 * 품질 채택 게이트가 아니지만, JS glue와 WASM이 lazy 자산으로 남는지는 빌드에서 검증한다.
 */
export const CANVASKIT_BUNDLE_FACTS: readonly StudioCanvasKitBundleFacts[] = [
  {
    variant: "canvaskit 0.41.1 (기본 배포본)",
    approxRawBytes: 7_159_342,
    approxBrotliBytes: 2_500_000,
    note: "WASM 원본 크기는 로컬 실측, brotli 크기는 참고치. PathOps·Paragraph를 포함합니다.",
  },
  {
    variant: "canvaskit 0.41.1/full",
    approxRawBytes: 8_080_104,
    approxBrotliBytes: 2_900_000,
    note: "WASM 원본 크기는 로컬 실측. Skottie 등 추가 모듈이 포함된 비교용 변형입니다.",
  },
];

/** 채택 판단 요약(한국어) — 숫자가 미측정이라는 사실을 항상 함께 낸다. */
export const CANVASKIT_ADOPTION_NOTE =
  "CanvasKit 0.41.1은 별도 lazy JS/WASM 자산으로 불러오며, 현재 Skia PathOps와 획→채움 경로 품질 공급자로 사용합니다. WASM 원본 크기는 실측했고 압축 수치는 참고치입니다.";
