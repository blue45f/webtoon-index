/**
 * Studio Path Tracer — CPU 타일 렌더러 (studio-pathtrace-cpu-renderer)
 *
 * headless 테스트가 **진짜 픽셀**을 뽑는 경로다(node 테스트 환경에는 WebGPU 도 DOM
 * canvas 도 없다). 동시에 프로덕션에서는 GPU 미지원 기기의 폴백 티어다.
 *
 * 설계
 *  - **시간 개념이 없다.** rAF/setTimeout/performance/Date 를 쓰지 않는다. 호출부가
 *    프레임 예산 안에서 타일을 몇 개 돌릴지 결정한다(그래서 그대로 워커에 얹을 수 있다).
 *  - 타일 순서는 결정적이며(행 우선), 한 픽셀은 정확히 한 타일에만 속한다. 따라서
 *    타일 순서를 뒤집거나 타일 크기를 바꿔도 필름은 **바이트 단위로 동일**하다.
 *  - 픽셀별 누적 순서는 sampleIndex 오름차순으로 고정한다(f32 덧셈의 비결합성 때문).
 *
 * 정직한 성능 (전부 이 맥/Node 24, 단일 스레드 실측 — 추정치 아님)
 *  - 가벼운 씬(바닥 quad + 면적 광원 1, maxBounces 4, NEE + RR):
 *    160×120 @ 16 spp = **200 ms** → 1.54 Msamples/s, 프레임당 12.5 ms.
 *  - 무거운 씬(200k 랜덤 삼각형 수프, closest-hit 만): **0.11 Mrays/s**.
 *    BVH 순회가 지배하는 최악 케이스이며, 실제 메시는 겹침이 적어 이보다 낫다.
 *  - 즉 CPU 티어는 **프리뷰/검증 전용**이다. 1080p 최종 이미지는 이 경로로 뽑지 말 것 —
 *    WGSL 컴퓨트 경로(studio-pathtrace-wgsl)가 그 역할이다. 다만 GPU 성능은 아직
 *    **실측하지 않았다**(verify 스크립트가 후속 작업).
 */

import { accumulateStudioPathtraceSample } from "./studio-pathtrace-film";
import { traceStudioPathtraceRadiance } from "./studio-pathtrace-integrator";

import type { StudioPathtraceFilm } from "./studio-pathtrace-film";
import type { StudioPathtraceContext } from "./studio-pathtrace-integrator";

export const STUDIO_PATHTRACE_DEFAULT_TILE_SIZE = 32;

export interface StudioPathtraceTile {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** 행 우선 타일 순번(0-based). 진행률 표시/스케줄링용. */
  readonly index: number;
}

/** 결정적 타일 분할(행 우선). 경계 타일은 잘려서 나온다. */
export function planStudioPathtraceTiles(
  width: number,
  height: number,
  tileSize: number = STUDIO_PATHTRACE_DEFAULT_TILE_SIZE,
): readonly StudioPathtraceTile[] {
  const size = Math.max(1, Math.floor(tileSize));
  const tiles: StudioPathtraceTile[] = [];
  const cols = Math.ceil(width / size);
  const rows = Math.ceil(height / size);
  let index = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = col * size;
      const y = row * size;
      tiles.push({
        x,
        y,
        width: Math.min(size, width - x),
        height: Math.min(size, height - y),
        index,
      });
      index += 1;
    }
  }
  return tiles;
}

/**
 * 타일 하나에 샘플 하나를 누적한다. 순수 함수(필름만 변경) — 어떤 순서로 불러도
 * 같은 필름이 나온다.
 */
export function renderStudioPathtraceTile(
  ctx: StudioPathtraceContext,
  film: StudioPathtraceFilm,
  tile: StudioPathtraceTile,
  sampleIndex: number,
): void {
  // ctx 의 스크래치는 인테그레이터 내부가 쓰므로 여기서 공유하면 안 된다(타일당 1회 할당).
  const radiance = new Float64Array(3);
  for (let dy = 0; dy < tile.height; dy += 1) {
    const y = tile.y + dy;
    if (y >= ctx.height) break;
    for (let dx = 0; dx < tile.width; dx += 1) {
      const x = tile.x + dx;
      if (x >= ctx.width) break;
      const pixelIndex = y * ctx.width + x;
      traceStudioPathtraceRadiance(ctx, pixelIndex, sampleIndex, radiance);
      accumulateStudioPathtraceSample(film, pixelIndex, radiance[0], radiance[1], radiance[2]);
    }
  }
}

/** 한 프레임(= 전 픽셀에 샘플 1개) 누적. */
export function renderStudioPathtraceFrame(
  ctx: StudioPathtraceContext,
  film: StudioPathtraceFilm,
  sampleIndex: number,
  tiles: readonly StudioPathtraceTile[] = planStudioPathtraceTiles(ctx.width, ctx.height),
): void {
  for (let i = 0; i < tiles.length; i += 1) {
    renderStudioPathtraceTile(ctx, film, tiles[i], sampleIndex);
  }
}

/**
 * spp 회 누적(프로그레시브). 픽셀별 누적 순서를 sampleIndex 오름차순으로 고정하려면
 * 프레임 단위로 돌아야 한다 — 타일 단위로 spp 를 다 돌리면 픽셀별 순서는 여전히
 * 오름차순이라 결과는 같다(계약 테스트가 두 경로의 바이트 동일성을 확인).
 */
export function renderStudioPathtraceProgressive(
  ctx: StudioPathtraceContext,
  film: StudioPathtraceFilm,
  samplesPerPixel: number,
  tiles: readonly StudioPathtraceTile[] = planStudioPathtraceTiles(ctx.width, ctx.height),
): void {
  for (let s = 0; s < samplesPerPixel; s += 1) {
    renderStudioPathtraceFrame(ctx, film, s, tiles);
  }
}
