// 스케치 선화 정리(라인아트 클린업) — 100% 브라우저(클라이언트) 실행, 서버·토큰 비용 0원.
// 흐릿한 연필 스캔/스케치를 또렷한 흑백 잉크 선으로 정리한다. 새 알고리즘을 짜는 대신
// 이미 검증된 3개의 순수 픽셀 함수(그레이스케일→대비 스트레치→언샤프→임계 이진화 순서)를 합성한다:
//   1) 그레이스케일 — 색 얼룩/연필 색조를 지운다(이 파일의 유일한 신규 로직, ~7줄).
//   2) applyAutoAdjust(contrast) — 휘도 히스토그램 양끝 0.5% 클립 후 0..255 로 스트레치.
//      옅은 연필선(예: 회색 200)과 종이(회색 235)를 미리 벌려 놓아야 다음 단계 이진화가 선을
//      살릴 수 있다 — 이 순서가 알고리즘의 핵심.
//   3) applySharpen — 3x3 언샤프 마스크로 선 가장자리를 또렷하게. 이진화 *전에* 걸어야 의미가
//      있다(이미 흑/백뿐인 이미지를 샤픈해봐야 바뀔 게 없다).
//   4) applyInkThreshold — 휘도 임계로 순흑/순백 이진화. threshold=0 이면 이 함수가 자체적으로
//      no-op 하므로 "이진화 없이 정리만" 옵션이 자연스럽게 성립한다.
// 다운샘플링은 하지 않는다 — 3x3 컨볼루션 1회 + 선형 스캔 몇 번은 웹툰 스캔 해상도(수천 px)에서도
// 가볍고(형제 파일들과 동일한 전체 해상도 처리 관례), 다운샘플하면 얇은 연필선이 소실될 위험이 더 크다.
import { applyAutoAdjust } from "./studio-auto-adjust";
import { applyInkThreshold, applySharpen, type StudioImageDataLike } from "./studio-filters";

export type LineArtCleanupOptions = {
  /** 잉크 임계값 0..1(applyInkThreshold와 동일 스케일). 0 = 이진화 생략(그레이 소프트 클린업만). */
  threshold: number;
  /** 언샤프 마스크 강도 0..1(applySharpen과 동일 스케일). */
  strength: number;
};

// 먹선 프리셋(0.55, studio-filters.ts)보다 살짝 높게 잡는다 — 대비 스트레치를 거쳐도 옅은 연필선은
// 여전히 순검정보다는 중간 회색에 가까워서, 컷라인을 약간 더 후하게 잡아야 흰색으로 날아가지 않는다.
export const DEFAULT_LINE_ART_CLEANUP: LineArtCleanupOptions = { threshold: 0.6, strength: 0.5 };

// 슬라이더 범위 — IMAGE_ADJUSTMENT_RANGES.inkThreshold/.sharpen과 동일한 폭으로 맞춰 일관성 유지.
export const LINE_ART_CLEANUP_RANGES = {
  threshold: { min: 0, max: 1, step: 0.02 },
  strength: { min: 0, max: 1, step: 0.05 },
} as const;

function finiteUnitInterval(raw: unknown, fallback: number): number {
  return typeof raw === "number" && Number.isFinite(raw)
    ? Math.min(1, Math.max(0, raw))
    : fallback;
}

/** Stored/Worker inputs are normalized once so malformed documents cannot amplify the kernels. */
export function normalizeLineArtCleanup(
  options?: Partial<LineArtCleanupOptions> | null,
): LineArtCleanupOptions {
  const source = options && typeof options === "object" ? options : {};
  return {
    threshold: finiteUnitInterval(
      source.threshold,
      DEFAULT_LINE_ART_CLEANUP.threshold,
    ),
    strength: finiteUnitInterval(
      source.strength,
      DEFAULT_LINE_ART_CLEANUP.strength,
    ),
  };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("이미지를 불러오지 못했습니다."));
    img.src = src;
  });
}

// 휘도 기반 제자리 그레이스케일 — 색 얼룩을 지워 다음 단계(대비/임계)가 밝기만으로 판단하게 한다.
// 알파는 보존(투명 배경 위 스케치도 그대로 동작).
function toGrayscale(img: StudioImageDataLike): void {
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
    data[i] = lum;
    data[i + 1] = lum;
    data[i + 2] = lum;
  }
}

/**
 * Pure ImageData line-cleanup engine shared by Konva, the module Worker, page-composite filters,
 * and the legacy one-shot image action. The operation order is intentional:
 * grayscale → auto contrast → sharpen → optional binary threshold.
 */
export function applyLineArtCleanup(
  imageData: StudioImageDataLike,
  options?: Partial<LineArtCleanupOptions> | null,
): void {
  if (
    !Number.isSafeInteger(imageData.width)
    || !Number.isSafeInteger(imageData.height)
    || imageData.width <= 0
    || imageData.height <= 0
    || imageData.data.length !== imageData.width * imageData.height * 4
  ) {
    return;
  }
  const normalized = normalizeLineArtCleanup(options);
  toGrayscale(imageData);
  applyAutoAdjust(imageData, { mode: "contrast", strength: 100 });
  if (normalized.strength > 0) applySharpen(imageData, normalized.strength);
  applyInkThreshold(imageData, normalized.threshold);
}

/** Konva/Worker adapter. Missing attrs are a fail-closed no-op, not an implicit default effect. */
export function lineArtCleanupKonvaFilter(
  this: { attrs?: Record<string, unknown> },
  imageData: StudioImageDataLike,
): void {
  const attrs = this.attrs;
  if (!attrs) return;
  applyLineArtCleanup(imageData, {
    threshold: attrs.lineCleanupThreshold as number | undefined,
    strength: attrs.lineCleanupStrength as number | undefined,
  });
}

/**
 * 선화 정리 — src(데이터 URL 등)의 흐릿한 스케치를 또렷한 흑백 선으로 정리한 PNG data URL 을 반환한다.
 * @param opts.threshold 잉크 임계값 0..1, 기본 0.6. 0 이면 이진화 없이 그레이 클린업만 수행.
 * @param opts.strength 언샤프 마스크 강도 0..1, 기본 0.5. 0 이면 샤픈 생략.
 */
export async function cleanupLineArt(
  src: string,
  opts: Partial<LineArtCleanupOptions> = {},
): Promise<string> {
  const img = await loadImage(src);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) throw new Error("이미지 크기를 확인할 수 없습니다.");

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("캔버스를 만들 수 없습니다.");
  ctx.drawImage(img, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);

  applyLineArtCleanup(imageData, opts);

  ctx.putImageData(imageData, 0, 0);
  // Async PNG encode keeps large line-art cleanup off the synchronous toDataURL path.
  const { encodeStudioPixelEditCanvasPng } = await import("./studio-pixel-edit-async");
  return encodeStudioPixelEditCanvasPng(canvas);
}
