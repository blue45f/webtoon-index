/**
 * Incremental live-ink overlay (canvas2d).
 *
 * 라이브 획을 매 프레임 전체 폴리라인으로 다시 그리는 대신(스트로크가 길어질수록 프레임당
 * O(N)) 새로 확정된 세그먼트만 뷰포트 크기 표면에 누적한다 — 포인트당 O(1). 라이브 프리뷰
 * 백킹은 커밋 Konva surface와 같은 DPR을 써 handoff AA coverage를 일치시킨다.
 *
 * 픽셀 규약은 Konva Default(pen/marker)와 WebGPU가 공유하는 causal round-dab 계획을 쓴다.
 * 새 샘플은 과거 픽셀을 다시 쓰지 않고 직전 권위 점에서 현재 점까지 즉시 도달한다. 보통은
 * 기기 DPR을 그대로 쓴다. 16M backing pixel을 넘는 초대형 화면은 해상도를 몰래 낮추지
 * 않고 시작을 거부해 정확한 retained 초안으로 넘긴다. 지우개
 * (destination-out)와 라쏘 필(내부 채움 미리보기)은
 * 이 오버레이 대상이 아니다 — 각각 메인 레이어/Konva 초안 경로가 담당한다.
 *
 * 커밋 지연 파이프라인과 짝을 이룬다: end() 된 획은 settled 목록으로 넘어가 React 동기화가
 * 일어날 때까지 표면에 남고(replay 포함), 동기화가 커밋을 마치면
 * releaseSettledPrefix()/clearSettled() 로 원자적으로 정리된다. 정리 시 backing canvas 를
 * 비운 뒤 아직 커밋되지 않은 settled 획과 현재 active 획을 즉시 재생하므로, 연속 입력 중에도
 * 새 잉크를 지우거나 이미 버린 잉크 픽셀을 고아로 남기지 않는다.
 */

import {
  resolveStudioInkPressure,
  studioInkUsesResidualDabSpacing,
  type StudioInkPressureModel,
} from "../brush/studio-ink-pressure-model";
import {
  advanceStudioResidualInk,
  planStudioCausalInkDabs,
  selectStudioCausalInkSamples,
  shouldAppendStudioCausalInkSample,
  startStudioResidualInk,
  STUDIO_CAUSAL_INK_MAX_DABS,
  type StudioCausalInkDab,
  type StudioCausalInkSample,
  type StudioResidualInkState,
} from "../studio-causal-ink";
import {
  acquireStudioLowLatencyCanvas2dContext,
  decideStudioNativeLiveSurfaceResolution,
  type StudioNativeLiveSurfaceResolutionDecision,
} from "../studio-low-latency-canvas";

import type { StudioStrokePaintModel } from "../brush/studio-stroke-paint-model";
import type {
  StudioPredictedInkSample,
  StudioPredictedInkSurfaceUpdate,
} from "../studio-predicted-ink-tail";

export interface StudioLiveInkSurface {
  /** 스케일된 문서 안에서 표면의 CSS 배치(px). planStudioWebGpuViewportSurface.surface 와 동일. */
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  /** 문서 픽셀 → CSS 픽셀 배율(effScale). */
  readonly documentScale: number;
  /** 좌우 반전 시 문서 x 재사상에 필요한 문서 논리 폭. */
  readonly documentWidth: number;
  readonly flipX: boolean;
}

export interface StudioLiveInkStrokeStyle {
  readonly color: string;
  /** 문서 픽셀 기준 기본 획 굵기. */
  readonly strokeWidthDoc: number;
  /** Omitted strokes retain the legacy 0.3 + 1.4p diameter contract. */
  readonly pressureModel?: StudioInkPressureModel;
  /**
   * Versioned stroke-level compositor semantics. The incremental surfaces reject every present
   * model until they own an isolated stroke-local coverage buffer.
   */
  readonly paintModel?: StudioStrokePaintModel;
  readonly opacity: number;
  /** 입력 sampler와 동일한 thinning 최소 간격(문서 px). */
  readonly minDistanceDoc: number;
}

/**
 * The fast append/prediction canvases paint dabs directly into their destination. They cannot
 * represent a contract that accumulates coverage first and applies color/stroke alpha once, so a
 * versioned paint model must stay on the canonical Konva compound-path renderer.
 */
export function studioLiveInkFastOverlaySupportsStyle(
  style: StudioLiveInkStrokeStyle
): boolean {
  return style.paintModel === undefined;
}

export type StudioLiveInkPointTailUpdate =
  | { readonly kind: "keep" }
  | { readonly kind: "clear" }
  | {
      readonly kind: "replace";
      readonly anchor: { readonly x: number; readonly y: number } | null;
      readonly startSampleIndex: number;
      readonly points: readonly number[];
    };

interface SettledLiveInkStroke {
  readonly style: StudioLiveInkStrokeStyle;
  readonly xs: readonly number[];
  readonly ys: readonly number[];
  readonly ps: readonly number[];
}

function liveInkStyleMatches(
  left: StudioLiveInkStrokeStyle,
  right: StudioLiveInkStrokeStyle
): boolean {
  return left.color === right.color
    && left.strokeWidthDoc === right.strokeWidthDoc
    && left.pressureModel === right.pressureModel
    && left.paintModel === right.paintModel
    && left.opacity === right.opacity
    && left.minDistanceDoc === right.minDistanceDoc;
}

function liveInkNumberArraysEqual(
  left: readonly number[],
  right: readonly number[]
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (!Object.is(left[index], right[index])) return false;
  }
  return true;
}

/** True when reauthor would paint the same settled samples already on the overlay. */
function liveInkSettledStrokeMatches(
  stroke: SettledLiveInkStroke,
  style: StudioLiveInkStrokeStyle,
  xs: readonly number[],
  ys: readonly number[],
  ps: readonly number[]
): boolean {
  return liveInkStyleMatches(stroke.style, style)
    && liveInkNumberArraysEqual(stroke.xs, xs)
    && liveInkNumberArraysEqual(stroke.ys, ys)
    && liveInkNumberArraysEqual(stroke.ps, ps);
}

function liveInkSurfaceResolution(
  surface: StudioLiveInkSurface
): StudioNativeLiveSurfaceResolutionDecision {
  return decideStudioNativeLiveSurfaceResolution({
    cssWidth: surface.width,
    cssHeight: surface.height,
    devicePixelRatio: typeof globalThis.devicePixelRatio === "number"
      ? globalThis.devicePixelRatio
      : 1,
  });
}

export class StudioLiveInkOverlayRenderer {
  private canvas: HTMLCanvasElement | null = null;
  private context: CanvasRenderingContext2D | null = null;
  private surface: StudioLiveInkSurface | null = null;
  private dpr = 1;
  private resolutionDecision: StudioNativeLiveSurfaceResolutionDecision | null = null;
  private style: StudioLiveInkStrokeStyle | null = null;
  /** thinning 을 통과해 유지된 문서 좌표 점들(재생용). */
  private keptX: number[] = [];
  private keptY: number[] = [];
  private keptP: number[] = [];
  /**
   * 가장 최근에 소비한 원본 샘플. 라이브 thinning 에서 너무 가까워 건너뛴 점도 pointerup
   * 끝점일 수 있으므로 별도로 기억했다가 end() 에서 최종 kept 점으로 승격한다.
   */
  private latestSourceX = 0;
  private latestSourceY = 0;
  private latestSourceP = 0.5;
  /** 원본 draft.points 에서 이미 소비한 포인트 수(중복 append 방지). */
  private consumedSourcePoints = 0;
  /** Exact cross-segment spacing cursor for new versioned ink; legacy strokes keep pair planning. */
  private residualInkState: StudioResidualInkState | null = null;
  private residualDabCount = 0;
  private active = false;
  /** 펜을 뗐지만 React 커밋 동기화 전이라 표면에 유지 중인 획들. */
  private settled: SettledLiveInkStroke[] = [];
  /** Canonical-drawn prefix retained solely for FIFO accounting and therefore not repainted. */
  private suppressedSettledPrefixCount = 0;
  attach(canvas: HTMLCanvasElement | null): void {
    this.canvas = canvas;
    this.context = canvas ? acquireStudioLowLatencyCanvas2dContext(canvas) : null;
    this.applySurface();
    if (this.active || this.settled.length > 0) this.replay();
  }

  setSurface(surface: StudioLiveInkSurface | null): void {
    const previous = this.surface;
    this.surface = surface;
    const changed =
      !previous || !surface ||
      previous.left !== surface.left || previous.top !== surface.top ||
      previous.width !== surface.width || previous.height !== surface.height ||
      previous.documentScale !== surface.documentScale ||
      previous.documentWidth !== surface.documentWidth ||
      previous.flipX !== surface.flipX;
    if (!changed) return;
    this.applySurface();
    if (this.active || this.settled.length > 0) this.replay();
  }

  get isActive(): boolean {
    return this.active;
  }

  get hasSettledStrokes(): boolean {
    return this.settled.length > 0;
  }

  get settledStrokeCount(): number {
    return this.settled.length;
  }

  /** False means the exact retained draft must remain visible for the current surface. */
  get isNativeSurfaceReady(): boolean {
    return this.context !== null
      && this.surface !== null
      && this.resolutionDecision?.ok === true;
  }

  get surfaceResolutionDecision(): StudioNativeLiveSurfaceResolutionDecision | null {
    return this.resolutionDecision;
  }

  begin(style: StudioLiveInkStrokeStyle, x: number, y: number, pressure: number): boolean {
    if (
      !this.context || !this.surface ||
      !this.isNativeSurfaceReady ||
      !studioLiveInkFastOverlaySupportsStyle(style)
    ) return false;
    const resolvedPressure = resolveStudioInkPressure(pressure, style.pressureModel);
    this.style = style;
    this.keptX = [x];
    this.keptY = [y];
    this.keptP = [resolvedPressure];
    this.latestSourceX = x;
    this.latestSourceY = y;
    this.latestSourceP = resolvedPressure;
    this.consumedSourcePoints = 1;
    this.active = true;
    // settled 잉크는 유지한다 — 커밋 동기화 전의 연속 스트로크가 서로를 지우지 않는다.
    this.drawFirstPoint(style, x, y, resolvedPressure);
    return true;
  }

  /** Starts an append-only corrected head whose first pixels will arrive in a later settled span. */
  beginDeferred(style: StudioLiveInkStrokeStyle): boolean {
    if (
      !this.context || !this.surface ||
      !this.isNativeSurfaceReady ||
      !studioLiveInkFastOverlaySupportsStyle(style)
    ) return false;
    this.style = style;
    this.keptX = [];
    this.keptY = [];
    this.keptP = [];
    this.latestSourceX = 0;
    this.latestSourceY = 0;
    this.latestSourceP = 0.5;
    this.consumedSourcePoints = 0;
    this.residualInkState = null;
    this.residualDabCount = 0;
    this.active = true;
    return true;
  }

  /** Appends a causal post-correction span without ever revisiting the retained head. */
  appendSettledSpan(
    points: readonly number[],
    pressures: readonly number[] | undefined,
    startSampleIndex: number
  ): void {
    if (!this.active || !this.context || !this.style) return;
    const sampleCount = Math.floor(points.length / 2);
    for (let localIndex = 0; localIndex < sampleCount; localIndex += 1) {
      const x = points[localIndex * 2]!;
      const y = points[localIndex * 2 + 1]!;
      const pressure = resolveStudioInkPressure(
        pressures?.[startSampleIndex + localIndex],
        this.style.pressureModel
      );
      this.latestSourceX = x;
      this.latestSourceY = y;
      this.latestSourceP = pressure;
      if (this.keptX.length === 0) {
        this.keptX.push(x);
        this.keptY.push(y);
        this.keptP.push(pressure);
        this.drawFirstPoint(this.style, x, y, pressure);
      } else {
        this.appendPoint(x, y, pressure);
      }
    }
    this.consumedSourcePoints += sampleCount;
  }

  /**
   * draft 의 원본 points/pressures 에서 아직 소비하지 않은 접미사만 증분으로 그린다.
   * 호출 측은 델타를 계산할 필요가 없다 — 렌더러가 소비 오프셋을 기억한다.
   */
  appendFrom(points: readonly number[], pressures: readonly number[] | undefined): void {
    if (!this.active || !this.context || !this.style) return;
    const total = Math.floor(points.length / 2);
    for (let index = this.consumedSourcePoints; index < total; index += 1) {
      const x = points[index * 2]!;
      const y = points[index * 2 + 1]!;
      const pressure = resolveStudioInkPressure(pressures?.[index], this.style.pressureModel);
      this.latestSourceX = x;
      this.latestSourceY = y;
      this.latestSourceP = pressure;
      this.appendPoint(x, y, pressure);
    }
    this.consumedSourcePoints = Math.max(this.consumedSourcePoints, total);
  }

  /** 획 종료 — 잉크와 재생 데이터는 커밋 draw receipt 뒤의 settled release까지 유지된다. */
  end(): void {
    if (this.active && this.style && this.keptX.length > 0) {
      const lastIndex = this.keptX.length - 1;
      // processFreehandPoints 와 같은 "마지막 원본 점은 항상 보존" 계약. 마지막 포인터 샘플이
      // thinning 간격보다 가까워 appendPoint 에서 생략됐더라도 펜을 놓은 정확한 곳까지 채운다.
      if (
        this.keptX[lastIndex] !== this.latestSourceX ||
        this.keptY[lastIndex] !== this.latestSourceY
      ) {
        this.keptX.push(this.latestSourceX);
        this.keptY.push(this.latestSourceY);
        this.keptP.push(this.latestSourceP);
        this.drawLatestPiece();
      }
      this.settled.push({
        style: this.style,
        xs: this.keptX,
        ys: this.keptY,
        ps: this.keptP,
      });
    }
    this.resetActiveState();
  }

  /**
   * Replace the newest settled stroke with the document-authoritative sample sequence (same as
   * Konva/committed causal planning) and re-rasterize. Call after end() once the release planner
   * freezes geometry so the overlay→committed handoff does not pop/flicker from residual thinning
   * drift or incomplete last-sample promotion.
   *
   * Callers must pass live-boundary pressures (brush-alias mapped) — the same channel
   * `appendFrom` / Konva causal dabs use — not raw DrawEl.pressures. When the sealed samples
   * already match the settled footprint, skip clearRect/replay so pointerup cannot flash an
   * empty overlay for a frame.
   */
  reauthorLastSettledFromDocumentPoints(input: {
    readonly style: StudioLiveInkStrokeStyle;
    readonly points: readonly number[];
    readonly pressures?: readonly number[];
  }): boolean {
    if (this.settled.length === 0) return false;
    if (!studioLiveInkFastOverlaySupportsStyle(input.style)) return false;
    const samples = selectStudioCausalInkSamples({
      points: input.points,
      pressures: input.pressures,
      pressureModel: input.style.pressureModel,
      minDistance: input.style.minDistanceDoc,
      sealEndpoint: true,
    });
    if (samples.length === 0) return false;
    const xs = samples.map((sample) => sample.x);
    const ys = samples.map((sample) => sample.y);
    const ps = samples.map((sample) => sample.pressure);
    const previous = this.settled[this.settled.length - 1]!;
    if (liveInkSettledStrokeMatches(previous, input.style, xs, ys, ps)) {
      return true;
    }
    this.settled[this.settled.length - 1] = {
      style: input.style,
      xs,
      ys,
      ps,
    };
    this.replay();
    return true;
  }

  /**
   * FIFO 커밋이 실제 메인 표면에 그려진 settled 획 수만큼 앞에서 제거한다.
   *
   * backing canvas 를 같은 호출 안에서 지우고 남은 settled/active 획을 재생한다. 따라서 호출자가
   * 별도 rAF clear 를 예약할 필요가 없고, 그 사이 시작된 새 active 획이 늦은 clear 에 지워지는
   * 세대 경합도 생기지 않는다. 반환값은 실제로 제거된 획 수다.
   */
  releaseSettledPrefix(count: number): number {
    const requested = count === Number.POSITIVE_INFINITY
      ? this.settled.length
      : Number.isFinite(count)
        ? Math.max(0, Math.floor(count))
        : 0;
    const released = Math.min(requested, this.settled.length);
    if (released === 0) return 0;
    this.settled = this.settled.slice(released);
    this.suppressedSettledPrefixCount = Math.max(
      0,
      this.suppressedSettledPrefixCount - released,
    );
    this.replay();
    return released;
  }

  /**
   * Stops presenting an exact canonical-drawn prefix while keeping its release accounting intact.
   * Repeated retained-retry passes are idempotent, and any newer settled or active ink remains
   * visible because replay skips only the proven FIFO prefix.
   */
  suppressSettledPrefix(count: number): number {
    const requested = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    const suppressed = Math.min(requested, this.settled.length);
    if (suppressed <= this.suppressedSettledPrefixCount) {
      return this.suppressedSettledPrefixCount;
    }
    this.suppressedSettledPrefixCount = suppressed;
    this.replay();
    return suppressed;
  }

  /** 모든 settled 획을 원자적으로 제거하고, 존재하는 active 획만 backing 에 다시 그린다. */
  clearSettled(): number {
    return this.releaseSettledPrefix(this.settled.length);
  }

  /**
   * @deprecated clearSettled() 또는 releaseSettledPrefix()를 사용한다.
   * 과거처럼 재생 데이터만 버리지 않고 픽셀까지 같은 호출에서 안전하게 정리한다.
   */
  dropSettled(): void {
    this.clearSettled();
  }

  /**
   * 현재 active 획만 취소한다. 이미 끝난 settled 획은 보존하고 backing 에 즉시 재생한다.
   * 새 도구/입력 세션을 시작할 때 clear() 대신 사용하면 커밋 대기 중인 이전 획이 사라지지 않는다.
   */
  resetActive(): boolean {
    if (!this.active) return false;
    this.resetActiveState();
    this.replay();
    return true;
  }

  clear(): void {
    this.resetActiveState();
    this.settled = [];
    this.suppressedSettledPrefixCount = 0;
    this.clearRect();
  }

  private resetActiveState(): void {
    this.active = false;
    this.style = null;
    this.keptX = [];
    this.keptY = [];
    this.keptP = [];
    this.latestSourceX = 0;
    this.latestSourceY = 0;
    this.latestSourceP = 0.5;
    this.consumedSourcePoints = 0;
    this.residualInkState = null;
    this.residualDabCount = 0;
  }

  private appendPoint(x: number, y: number, pressure: number): void {
    const n = this.keptX.length;
    const lastX = this.keptX[n - 1]!;
    const lastY = this.keptY[n - 1]!;
    const lastPressure = this.keptP[n - 1]!;
    // Match selectStudioCausalInkSamples / shouldAppendStudioCausalInkSample so live residual V3
    // keeps stationary pressure changes and the same min-distance gate as committed Konva dabs.
    if (
      !shouldAppendStudioCausalInkSample({
        lastX,
        lastY,
        lastPressure,
        nextX: x,
        nextY: y,
        nextPressure: pressure,
        minDistance: this.style?.minDistanceDoc ?? 0,
        pressureModel: this.style?.pressureModel,
      })
    ) {
      return;
    }
    this.keptX.push(x);
    this.keptY.push(y);
    this.keptP.push(pressure);
    this.drawLatestPiece();
  }

  /** 마지막으로 추가된 점까지 이어지는 round-dab 접미사만 그린다 — 증분의 핵심. */
  private drawLatestPiece(): void {
    const style = this.style;
    if (!style) return;
    const n = this.keptX.length;
    if (!style || n < 2) return;
    const samples: readonly StudioCausalInkSample[] = [
      {
        x: this.keptX[n - 2]!,
        y: this.keptY[n - 2]!,
        pressure: this.keptP[n - 2]!,
        sourceIndex: n - 2,
      },
      {
        x: this.keptX[n - 1]!,
        y: this.keptY[n - 1]!,
        pressure: this.keptP[n - 1]!,
        sourceIndex: n - 1,
      },
    ];
    if (studioInkUsesResidualDabSpacing(style.pressureModel)) {
      const state = this.residualInkState;
      if (!state || !style.pressureModel) return;
      if (this.residualDabCount >= STUDIO_CAUSAL_INK_MAX_DABS) return;
      const advanced = advanceStudioResidualInk(
        state,
        samples[1]!,
        style.strokeWidthDoc,
        style.pressureModel,
        STUDIO_CAUSAL_INK_MAX_DABS - this.residualDabCount
      );
      this.residualInkState = advanced.state;
      this.residualDabCount += advanced.dabs.length;
      this.drawDabs(style, advanced.dabs);
      return;
    }
    // The previous endpoint was already painted. The legacy shared planner includes it as its
    // initial dab, so only the newly planned suffix is appended.
    this.drawDabs(style, planStudioCausalInkDabs({
      samples,
      size: style.strokeWidthDoc,
      pressureModel: style.pressureModel,
    }).dabs.slice(1));
  }

  private drawFirstPoint(
    style: StudioLiveInkStrokeStyle,
    x: number,
    y: number,
    pressure: number
  ): void {
    if (studioInkUsesResidualDabSpacing(style.pressureModel) && style.pressureModel) {
      const started = startStudioResidualInk(
        { x, y, pressure, sourceIndex: 0 },
        style.strokeWidthDoc,
        style.pressureModel
      );
      this.residualInkState = started.state;
      this.residualDabCount = started.dabs.length;
      this.drawDabs(style, started.dabs);
      return;
    }
    this.residualInkState = null;
    this.residualDabCount = 0;
    this.drawDot(style, x, y, pressure);
  }

  private drawDot(style: StudioLiveInkStrokeStyle, x: number, y: number, pressure: number): void {
    this.drawDabs(style, planStudioCausalInkDabs({
      samples: [{ x, y, pressure, sourceIndex: 0 }],
      size: style.strokeWidthDoc,
      pressureModel: style.pressureModel,
    }).dabs);
  }

  private drawStrokePath(
    style: StudioLiveInkStrokeStyle,
    xs: readonly number[],
    ys: readonly number[],
    ps: readonly number[]
  ): void {
    if (xs.length === 0) return;
    const samples: StudioCausalInkSample[] = xs.map((x, sourceIndex) => ({
      x,
      y: ys[sourceIndex]!,
      pressure: resolveStudioInkPressure(ps[sourceIndex], style.pressureModel),
      sourceIndex,
    }));
    this.drawDabs(style, planStudioCausalInkDabs({
      samples,
      size: style.strokeWidthDoc,
      pressureModel: style.pressureModel,
    }).dabs);
  }

  private drawDabs(style: StudioLiveInkStrokeStyle, dabs: readonly StudioCausalInkDab[]): void {
    if (dabs.length === 0) return;
    this.paintDabs(style, dabs);
  }

  private paintDabs(style: StudioLiveInkStrokeStyle, dabs: readonly StudioCausalInkDab[]): void {
    if (dabs.length === 0) return;
    const context = this.prepared(style);
    if (!context) return;
    context.fillStyle = style.color;
    for (const dab of dabs) {
      context.beginPath();
      context.arc(dab.x, dab.y, dab.radius, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  /** 뷰포트 이동/줌/반전 등 표면 변화 시에만 전체 재생한다(빈도 낮음). */
  private replay(): void {
    this.clearRect();
    for (const stroke of this.settled.slice(this.suppressedSettledPrefixCount)) {
      this.drawStrokePath(stroke.style, stroke.xs, stroke.ys, stroke.ps);
    }
    const style = this.style;
    if (!this.active || !style) return;
    this.drawStrokePath(style, this.keptX, this.keptY, this.keptP);
  }

  /** save + 문서좌표 변환 + 공통 스트로크 상태를 세팅한 컨텍스트를 돌려준다(restore 는 호출측). */
  private prepared(style: StudioLiveInkStrokeStyle): CanvasRenderingContext2D | null {
    const context = this.context;
    const surface = this.surface;
    if (!context || !surface || !this.isNativeSurfaceReady) return null;
    const k = this.dpr * surface.documentScale;
    context.save();
    if (surface.flipX) {
      context.setTransform(
        -k,
        0,
        0,
        k,
        (surface.documentWidth * surface.documentScale - surface.left) * this.dpr,
        -surface.top * this.dpr
      );
    } else {
      context.setTransform(k, 0, 0, k, -surface.left * this.dpr, -surface.top * this.dpr);
    }
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = style.color;
    context.globalAlpha = Math.min(1, Math.max(0, style.opacity));
    return context;
  }

  private applySurface(): void {
    const canvas = this.canvas;
    const surface = this.surface;
    if (!canvas || !surface) {
      this.resolutionDecision = null;
      return;
    }
    const decision = liveInkSurfaceResolution(surface);
    this.resolutionDecision = decision;
    if (!decision.ok) {
      this.dpr = 1;
      // Never leave a reduced-resolution viewport looking authoritative. Resizing also releases
      // the oversized backing allocation and clears any stale pixels from an earlier surface.
      if (canvas.width !== 1) canvas.width = 1;
      if (canvas.height !== 1) canvas.height = 1;
      this.resetActiveState();
      return;
    }
    this.dpr = decision.devicePixelRatio;
    if (canvas.width !== decision.backingWidth) canvas.width = decision.backingWidth;
    if (canvas.height !== decision.backingHeight) canvas.height = decision.backingHeight;
  }

  private clearRect(): void {
    const context = this.context;
    const canvas = this.canvas;
    if (!context || !canvas) return;
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.restore();
  }
}

interface StudioLiveInkDirtyRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

interface StudioLiveInkPredictionTail {
  readonly anchor: StudioPredictedInkSample | null;
  readonly samples: readonly StudioPredictedInkSample[];
}

/**
 * Replaceable pointer-prediction surface.
 *
 * This renderer deliberately owns a different canvas from `StudioLiveInkOverlayRenderer`. A new
 * browser estimate clears only the previous tail's small dirty rectangle and redraws the latest
 * route; it can never clear or repaint an already-authoritative pixel on the append-only surface.
 */
export class StudioLiveInkPredictionRenderer {
  private canvas: HTMLCanvasElement | null = null;
  private context: CanvasRenderingContext2D | null = null;
  private surface: StudioLiveInkSurface | null = null;
  private dpr = 1;
  private resolutionDecision: StudioNativeLiveSurfaceResolutionDecision | null = null;
  private style: StudioLiveInkStrokeStyle | null = null;
  private tail: StudioLiveInkPredictionTail | null = null;
  private dirtyRect: StudioLiveInkDirtyRect | null = null;

  attach(canvas: HTMLCanvasElement | null): void {
    this.canvas = canvas;
    this.context = canvas ? acquireStudioLowLatencyCanvas2dContext(canvas) : null;
    this.dirtyRect = null;
    this.applySurface();
    this.replay();
  }

  setSurface(surface: StudioLiveInkSurface | null): void {
    const previous = this.surface;
    const changed =
      !previous || !surface ||
      previous.left !== surface.left || previous.top !== surface.top ||
      previous.width !== surface.width || previous.height !== surface.height ||
      previous.documentScale !== surface.documentScale ||
      previous.documentWidth !== surface.documentWidth ||
      previous.flipX !== surface.flipX;
    if (!changed) return;
    this.clearAll();
    this.surface = surface;
    this.applySurface();
    this.replay();
  }

  /** Prediction never substitutes a lower-density surface for the authoritative retained draft. */
  get isNativeSurfaceReady(): boolean {
    return this.context !== null
      && this.surface !== null
      && this.resolutionDecision?.ok === true;
  }

  get surfaceResolutionDecision(): StudioNativeLiveSurfaceResolutionDecision | null {
    return this.resolutionDecision;
  }

  /** Applies only the transient-surface half of the pure prediction state transition. */
  apply(update: StudioPredictedInkSurfaceUpdate, style: StudioLiveInkStrokeStyle): void {
    if (!this.isNativeSurfaceReady || !studioLiveInkFastOverlaySupportsStyle(style)) {
      this.clear();
      return;
    }
    if (update.kind === "keep") return;
    this.clearDirty();
    if (update.kind === "clear") {
      this.style = null;
      this.tail = null;
      return;
    }
    this.style = style;
    this.tail = { anchor: update.anchor, samples: update.samples };
    this.drawTail();
  }

  /** Applies a bounded corrected-point tail while keeping pressure aligned to source indices. */
  applyPointTail(
    update: StudioLiveInkPointTailUpdate,
    style: StudioLiveInkStrokeStyle,
    pressures: readonly number[] | undefined
  ): void {
    if (!this.isNativeSurfaceReady || !studioLiveInkFastOverlaySupportsStyle(style)) {
      this.clear();
      return;
    }
    if (update.kind === "keep") return;
    this.clearDirty();
    if (update.kind === "clear") {
      this.style = null;
      this.tail = null;
      return;
    }
    const samples: StudioPredictedInkSample[] = [];
    for (let localIndex = 0; localIndex * 2 + 1 < update.points.length; localIndex += 1) {
      const x = update.points[localIndex * 2];
      const y = update.points[localIndex * 2 + 1];
      if (!Number.isFinite(x) || !Number.isFinite(y)) break;
      const rawPressure = pressures?.[update.startSampleIndex + localIndex];
      samples.push({
        x: x!,
        y: y!,
        pressure: resolveStudioInkPressure(rawPressure, style.pressureModel),
      });
    }
    if (samples.length === 0) {
      this.style = null;
      this.tail = null;
      return;
    }
    const anchorPressure = pressures?.[Math.max(0, update.startSampleIndex - 1)];
    this.style = style;
    this.tail = {
      anchor: update.anchor
        ? {
            ...update.anchor,
            pressure: resolveStudioInkPressure(anchorPressure, style.pressureModel),
          }
        : null,
      samples,
    };
    this.drawTail();
  }

  clear(): void {
    this.clearDirty();
    this.style = null;
    this.tail = null;
  }

  private replay(): void {
    if (!this.style || !this.tail) return;
    this.drawTail();
  }

  private drawTail(): void {
    const context = this.context;
    const surface = this.surface;
    const style = this.style;
    const tail = this.tail;
    if (
      !context || !surface || !this.isNativeSurfaceReady ||
      !style || !tail || tail.samples.length === 0
    ) return;

    const samples: StudioCausalInkSample[] = [
      ...(tail.anchor ? [tail.anchor] : []),
      ...tail.samples,
    ].map(
      (sample, sourceIndex) => ({ ...sample, sourceIndex })
    );
    // The anchor already exists on the authoritative surface. Keep it only as the interpolation
    // origin and omit the planner's initial dab so even opaque overlap is minimized.
    const dabs = planStudioCausalInkDabs({
      samples,
      size: style.strokeWidthDoc,
      pressureModel: style.pressureModel,
    }).dabs.slice(tail.anchor ? 1 : 0);
    if (dabs.length === 0) return;

    const k = this.dpr * surface.documentScale;
    context.save();
    if (surface.flipX) {
      context.setTransform(
        -k,
        0,
        0,
        k,
        (surface.documentWidth * surface.documentScale - surface.left) * this.dpr,
        -surface.top * this.dpr
      );
    } else {
      context.setTransform(k, 0, 0, k, -surface.left * this.dpr, -surface.top * this.dpr);
    }
    context.fillStyle = style.color;
    context.globalAlpha = Math.min(1, Math.max(0, style.opacity));
    for (const dab of dabs) {
      context.beginPath();
      context.arc(dab.x, dab.y, dab.radius, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
    this.dirtyRect = this.dirtyRectForDabs(dabs, surface);
  }

  private dirtyRectForDabs(
    dabs: readonly StudioCausalInkDab[],
    surface: StudioLiveInkSurface
  ): StudioLiveInkDirtyRect | null {
    if (dabs.length === 0) return null;
    let left = Number.POSITIVE_INFINITY;
    let top = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;
    // Two backing pixels cover canvas antialiasing at either DPR without clearing the viewport.
    const pad = 2;
    for (const dab of dabs) {
      const xCss = surface.flipX
        ? (surface.documentWidth - dab.x) * surface.documentScale - surface.left
        : dab.x * surface.documentScale - surface.left;
      const yCss = dab.y * surface.documentScale - surface.top;
      const x = xCss * this.dpr;
      const y = yCss * this.dpr;
      const radius = dab.radius * surface.documentScale * this.dpr;
      left = Math.min(left, x - radius - pad);
      top = Math.min(top, y - radius - pad);
      right = Math.max(right, x + radius + pad);
      bottom = Math.max(bottom, y + radius + pad);
    }
    if (![left, top, right, bottom].every(Number.isFinite)) return null;
    return {
      left: Math.floor(left),
      top: Math.floor(top),
      right: Math.ceil(right),
      bottom: Math.ceil(bottom),
    };
  }

  private applySurface(): void {
    const canvas = this.canvas;
    const surface = this.surface;
    if (!canvas || !surface) {
      this.resolutionDecision = null;
      return;
    }
    const decision = liveInkSurfaceResolution(surface);
    this.resolutionDecision = decision;
    if (!decision.ok) {
      this.dpr = 1;
      if (canvas.width !== 1) canvas.width = 1;
      if (canvas.height !== 1) canvas.height = 1;
      this.style = null;
      this.tail = null;
      this.dirtyRect = null;
      return;
    }
    this.dpr = decision.devicePixelRatio;
    if (canvas.width !== decision.backingWidth) canvas.width = decision.backingWidth;
    if (canvas.height !== decision.backingHeight) canvas.height = decision.backingHeight;
    this.dirtyRect = null;
  }

  private clearDirty(): void {
    const context = this.context;
    const dirty = this.dirtyRect;
    if (!context || !dirty) return;
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(
      dirty.left,
      dirty.top,
      Math.max(0, dirty.right - dirty.left),
      Math.max(0, dirty.bottom - dirty.top)
    );
    context.restore();
    this.dirtyRect = null;
  }

  private clearAll(): void {
    const context = this.context;
    const canvas = this.canvas;
    if (!context || !canvas) return;
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.restore();
    this.dirtyRect = null;
  }
}
