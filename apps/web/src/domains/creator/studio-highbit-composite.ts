/**
 * Studio High-Bit — 선형광 합성 코어.
 *
 * ── 왜 선형광인가 ────────────────────────────────────────────────────────
 * 빛은 선형으로 더해진다. 그런데 Canvas 2D 의 `source-over`/`globalAlpha`, Konva 필터,
 * WebGPU dab 합성은 전부 **감마 부호화된 값**을 그대로 가중평균한다. 결과는 물리적으로
 * 틀리고, 중간톤이 어둡게 뭉친다:
 *
 *   검정(#000) 위에 흰색(#fff) 을 알파 0.5 로
 *     감마 공간 합성 → 128 (Canvas 현행)
 *     선형광 합성    → 188  (= OETF(0.5))
 *   같은 색쌍에서 **60 코드** 차이. 그라데이션·에어브러시·반투명 겹침이 전부 이 오차를 탄다.
 *
 * ── 알파 규약 ────────────────────────────────────────────────────────────
 * 내부 연산은 전부 **프리멀티플라이드 선형광**이다. `over` 는 그때 비로소 정확·결합적이다:
 *     Cout = Cs + Cd·(1 − αs),  αout = αs + αd·(1 − αs)
 * 스트레이트 왕복(나눗셈→곱셈)을 매 연산마다 하면 알파가 낮은 픽셀에서 정밀도가 무너진다.
 *
 * ── 블렌드 모드 작업 공간 ────────────────────────────────────────────────
 * CSS Compositing Level 1 / Canvas 의 기본은 **부호화 값 위에서** B(Cb,Cs) 를 계산하는 것이고,
 * 포토샵의 "RGB 색상을 감마 1.0으로 혼합" 옵션은 선형에서 계산한다. 둘 다 정당한 규약이라
 * 여기서는 `space` 로 명시하게 하고 기본값만 `"linear"` 로 둔다(품질 우선).
 *
 * 순수·결정적. DOM/난수/시간 의존 없음.
 */

import {
  premultiplyStudioHighBitRgb,
  readStudioHighBitPremultiplied,
  unpremultiplyStudioHighBitRgb,
  writeStudioHighBitPremultiplied,
  type StudioHighBitRgba,
  type StudioHighBitSurface,
} from "./studio-highbit-buffer";
import {
  clampStudioHighBitUnit,
  studioHighBitLinearToSrgb,
  studioHighBitSrgbToLinear,
} from "./studio-highbit-transfer";

export type StudioHighBitBlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "linear-dodge";

export type StudioHighBitBlendSpace = "linear" | "encoded";

// ---------------------------------------------------------------------------
// 픽셀 단위 합성
// ---------------------------------------------------------------------------

/** 프리멀티플라이드 선형광 `over`. 입력·출력 모두 프리멀티플라이드. */
export function compositeStudioHighBitOverPixel(
  destination: StudioHighBitRgba,
  source: StudioHighBitRgba
): StudioHighBitRgba {
  const sourceAlpha = clampStudioHighBitUnit(source[3]);
  const keep = 1 - sourceAlpha;
  return [
    source[0] + destination[0] * keep,
    source[1] + destination[1] * keep,
    source[2] + destination[2] * keep,
    sourceAlpha + destination[3] * keep,
  ];
}

/** 프리멀티플라이드 `destination-out`(지우개). 색은 남은 알파 비율만큼 줄어든다. */
export function compositeStudioHighBitErasePixel(
  destination: StudioHighBitRgba,
  eraseAlpha: number
): StudioHighBitRgba {
  const keep = 1 - clampStudioHighBitUnit(eraseAlpha);
  return [
    destination[0] * keep,
    destination[1] * keep,
    destination[2] * keep,
    destination[3] * keep,
  ];
}

function separableBlend(mode: StudioHighBitBlendMode, backdrop: number, source: number): number {
  switch (mode) {
    case "normal":
      return source;
    case "multiply":
      return backdrop * source;
    case "screen":
      return backdrop + source - backdrop * source;
    case "overlay":
      return backdrop <= 0.5
        ? 2 * backdrop * source
        : 1 - 2 * (1 - backdrop) * (1 - source);
    case "linear-dodge":
      return Math.min(1, backdrop + source);
  }
}

function toBlendSpace(linear: number, space: StudioHighBitBlendSpace): number {
  return space === "linear" ? linear : studioHighBitLinearToSrgb(linear);
}

function fromBlendSpace(value: number, space: StudioHighBitBlendSpace): number {
  return space === "linear" ? value : studioHighBitSrgbToLinear(value);
}

export interface StudioHighBitBlendOptions {
  readonly mode?: StudioHighBitBlendMode;
  readonly opacity?: number;
  /** B(Cb,Cs) 를 계산할 공간. 기본 "linear"(품질), "encoded" 는 CSS/Canvas 호환. */
  readonly space?: StudioHighBitBlendSpace;
}

/**
 * CSS Compositing Level 1 의 분리형 블렌드 + source-over 를 **선형광 프리멀티플라이드**로
 * 수행한다. 입력·출력 모두 프리멀티플라이드 선형광 RGBA.
 */
export function blendStudioHighBitPixel(
  destination: StudioHighBitRgba,
  source: StudioHighBitRgba,
  options: StudioHighBitBlendOptions = {}
): StudioHighBitRgba {
  const mode = options.mode ?? "normal";
  const space = options.space ?? "linear";
  const opacity = clampStudioHighBitUnit(options.opacity ?? 1);
  const backdropAlpha = clampStudioHighBitUnit(destination[3]);
  const sourceAlpha = clampStudioHighBitUnit(source[3]) * opacity;
  if (sourceAlpha <= 0) return [destination[0], destination[1], destination[2], destination[3]];

  const sourceStraight = unpremultiplyStudioHighBitRgb(
    [source[0], source[1], source[2]],
    clampStudioHighBitUnit(source[3])
  );
  if (mode === "normal" || backdropAlpha <= 0) {
    const premultiplied = premultiplyStudioHighBitRgb(sourceStraight, sourceAlpha);
    return compositeStudioHighBitOverPixel(destination, [
      premultiplied[0],
      premultiplied[1],
      premultiplied[2],
      sourceAlpha,
    ]);
  }
  const backdropStraight = unpremultiplyStudioHighBitRgb(
    [destination[0], destination[1], destination[2]],
    backdropAlpha
  );

  const outAlpha = sourceAlpha + backdropAlpha * (1 - sourceAlpha);
  const weightSource = sourceAlpha * (1 - backdropAlpha);
  const weightBlend = sourceAlpha * backdropAlpha;
  const weightBackdrop = (1 - sourceAlpha) * backdropAlpha;
  const out: number[] = [0, 0, 0];
  for (let channel = 0; channel < 3; channel += 1) {
    const cs = sourceStraight[channel]!;
    const cb = backdropStraight[channel]!;
    const blended = fromBlendSpace(
      separableBlend(mode, toBlendSpace(cb, space), toBlendSpace(cs, space)),
      space
    );
    // 이미 프리멀티플라이드 형태(가중합)이므로 나눗셈 없이 그대로 저장한다.
    out[channel] = weightSource * cs + weightBlend * blended + weightBackdrop * cb;
  }
  return [out[0]!, out[1]!, out[2]!, outAlpha];
}

// ---------------------------------------------------------------------------
// 표면 단위 합성
// ---------------------------------------------------------------------------

/** 같은 크기·같은 개멋의 두 표면을 합성해 destination 을 제자리 갱신한다. */
export function compositeStudioHighBitSurface(
  destination: StudioHighBitSurface,
  source: StudioHighBitSurface,
  options: StudioHighBitBlendOptions = {}
): void {
  if (destination.width !== source.width || destination.height !== source.height) {
    throw new Error("고비트 합성: 두 표면의 크기가 같아야 합니다.");
  }
  if (destination.gamut !== source.gamut) {
    throw new Error("고비트 합성: 두 표면의 개멋이 같아야 합니다(선형 변환 후 합성하세요).");
  }
  for (let y = 0; y < destination.height; y += 1) {
    for (let x = 0; x < destination.width; x += 1) {
      const next = blendStudioHighBitPixel(
        readStudioHighBitPremultiplied(destination, x, y),
        readStudioHighBitPremultiplied(source, x, y),
        options
      );
      writeStudioHighBitPremultiplied(destination, x, y, next);
    }
  }
}

// ---------------------------------------------------------------------------
// 브러시 dab 누적 — 드리프트가 실제로 발생하는 지점
// ---------------------------------------------------------------------------

export interface StudioHighBitDab {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  /** dab 중심 도포량(0..1). `studio-brush-stamp-engine` 의 dab.alpha 와 같은 의미. */
  readonly alpha: number;
  /** 팁 경도(0..1): 1=선명, 0=최대 페더. */
  readonly hardness?: number;
  /** 스트레이트 **선형광** 색. sRGB 바이트라면 호출 측이 EOTF 로 디코드해서 넘긴다. */
  readonly color: readonly [number, number, number];
  readonly composite?: "paint" | "erase";
}

/** 원형 dab 의 해석적 커버리지. 경도 1 이어도 1px 폭 안티에일리어싱은 남긴다. */
export function studioHighBitDabCoverage(
  distance: number,
  radius: number,
  hardness: number
): number {
  if (!(radius > 0) || !Number.isFinite(distance) || distance >= radius) return 0;
  const inner = Math.min(
    radius - Math.min(1, radius * 0.5),
    radius * clampStudioHighBitUnit(hardness)
  );
  if (distance <= inner) return 1;
  const t = (distance - inner) / (radius - inner);
  return 1 - t * t * (3 - 2 * t);
}

/**
 * 고비트 표면에 dab 하나를 누적한다. 8비트 왕복이 없으므로 낮은 flow 에서도 값이 멈추지 않는다.
 * 좌표·반지름은 표면 픽셀 좌표계이며, 결정적이다(난수 없음).
 */
export function accumulateStudioHighBitDab(
  surface: StudioHighBitSurface,
  dab: StudioHighBitDab
): void {
  const radius = Number.isFinite(dab.radius) ? Math.max(0, dab.radius) : 0;
  if (radius <= 0) return;
  const alpha = clampStudioHighBitUnit(dab.alpha);
  if (alpha <= 0) return;
  const hardness = clampStudioHighBitUnit(dab.hardness ?? 1);
  const erase = dab.composite === "erase";
  const minX = Math.max(0, Math.floor(dab.x - radius));
  const maxX = Math.min(surface.width - 1, Math.ceil(dab.x + radius));
  const minY = Math.max(0, Math.floor(dab.y - radius));
  const maxY = Math.min(surface.height - 1, Math.ceil(dab.y + radius));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const distance = Math.hypot(x + 0.5 - dab.x, y + 0.5 - dab.y);
      const coverage = studioHighBitDabCoverage(distance, radius, hardness);
      if (coverage <= 0) continue;
      const effective = alpha * coverage;
      const current = readStudioHighBitPremultiplied(surface, x, y);
      const next = erase
        ? compositeStudioHighBitErasePixel(current, effective)
        : compositeStudioHighBitOverPixel(current, [
          dab.color[0] * effective,
          dab.color[1] * effective,
          dab.color[2] * effective,
          effective,
        ]);
      writeStudioHighBitPremultiplied(surface, x, y, next);
    }
  }
}

// ---------------------------------------------------------------------------
// 현행(8비트 · 감마 공간) 레퍼런스 — 개선폭을 수치로 증명하기 위한 대조군
// ---------------------------------------------------------------------------

/**
 * 현행 파이프라인과 동일한 8비트·감마 공간 `source-over` 한 픽셀.
 * `studio-extended-blend.ts` / Canvas 2D 와 같은 규약이며, 저장은 `Uint8ClampedArray`
 * (round-half-to-even)를 실제로 통과시킨다 — 드리프트 측정의 기준선이다.
 */
export function compositeStudioLegacy8BitOverPixel(
  destination: readonly [number, number, number, number],
  source: readonly [number, number, number, number],
  opacity = 1
): [number, number, number, number] {
  const out = new Uint8ClampedArray(4);
  const alphaBase = destination[3] / 255;
  const alphaTop = (source[3] / 255) * clampStudioHighBitUnit(opacity);
  if (alphaTop <= 0) {
    out.set([destination[0], destination[1], destination[2], destination[3]]);
    return [out[0]!, out[1]!, out[2]!, out[3]!];
  }
  const alphaOut = alphaTop + alphaBase * (1 - alphaTop);
  for (let channel = 0; channel < 3; channel += 1) {
    const top = source[channel]! / 255;
    const base = destination[channel]! / 255;
    const combined = (top * alphaTop + base * alphaBase * (1 - alphaTop)) / alphaOut;
    out[channel] = combined * 255;
  }
  out[3] = alphaOut * 255;
  return [out[0]!, out[1]!, out[2]!, out[3]!];
}
