import { describe, expect, it } from "vitest";

import {
  STUDIO_PATHTRACE_DEFAULT_TILE_SIZE,
  planStudioPathtraceTiles,
  renderStudioPathtraceFrame,
  renderStudioPathtraceProgressive,
  renderStudioPathtraceTile,
} from "./studio-pathtrace-cpu-renderer";
import { createStudioPathtraceFilm, resolveStudioPathtraceFilm } from "./studio-pathtrace-film";
import { createStudioPathtraceContext } from "./studio-pathtrace-integrator";
import { createAreaLightScene, createFurnaceQuadScene } from "./studio-pathtrace-test-scenes";

import type { StudioPathtraceIntegratorOptions } from "./studio-pathtrace-integrator";

const RENDER_OPTIONS: Partial<StudioPathtraceIntegratorOptions> = {
  mode: "nee-mis",
  maxBounces: 3,
  russianRoulette: true,
  rrStartBounce: 2,
  seed: 20260724,
  samplesPerPixel: 9,
};

function makeContext(width: number, height: number) {
  const { scene, bvh } = createAreaLightScene();
  return createStudioPathtraceContext({ scene, bvh, width, height, options: RENDER_OPTIONS });
}

describe("planStudioPathtraceTiles", () => {
  it("타일이 모든 픽셀을 정확히 한 번씩 덮는다", () => {
    for (const [w, h, size] of [
      [64, 64, 32],
      [37, 21, 8],
      [1, 1, 32],
      [100, 3, 16],
    ]) {
      const tiles = planStudioPathtraceTiles(w, h, size);
      const cover = new Uint8Array(w * h);
      for (const tile of tiles) {
        expect(tile.width).toBeGreaterThan(0);
        expect(tile.height).toBeGreaterThan(0);
        for (let y = tile.y; y < tile.y + tile.height; y += 1) {
          for (let x = tile.x; x < tile.x + tile.width; x += 1) {
            expect(x).toBeLessThan(w);
            expect(y).toBeLessThan(h);
            expect(cover[y * w + x]).toBe(0);
            cover[y * w + x] = 1;
          }
        }
      }
      for (let i = 0; i < cover.length; i += 1) expect(cover[i]).toBe(1);
    }
  });

  it("타일 순번은 행 우선으로 0..n-1 이다", () => {
    const tiles = planStudioPathtraceTiles(96, 64, 32);
    expect(tiles.length).toBe(3 * 2);
    tiles.forEach((tile, i) => expect(tile.index).toBe(i));
    expect(tiles[0]).toMatchObject({ x: 0, y: 0 });
    expect(tiles[1]).toMatchObject({ x: 32, y: 0 });
    expect(tiles[3]).toMatchObject({ x: 0, y: 32 });
  });

  it("기본 타일 크기와 비정상 크기 방어", () => {
    expect(STUDIO_PATHTRACE_DEFAULT_TILE_SIZE).toBe(32);
    expect(planStudioPathtraceTiles(8, 8, 0).length).toBe(64);
    expect(planStudioPathtraceTiles(8, 8, -5).length).toBe(64);
  });
});

describe("결정성 — 타일 분할과 무관하게 바이트 동일", () => {
  it("같은 시드로 두 번 렌더하면 필름이 바이트 단위로 같다", () => {
    const ctx = makeContext(24, 16);
    const a = createStudioPathtraceFilm(24, 16);
    const b = createStudioPathtraceFilm(24, 16);
    renderStudioPathtraceProgressive(ctx, a, 9);
    renderStudioPathtraceProgressive(ctx, b, 9);
    expect(new Uint8Array(a.accum.buffer)).toEqual(new Uint8Array(b.accum.buffer));
    expect(new Uint8Array(a.sampleCount.buffer)).toEqual(new Uint8Array(b.sampleCount.buffer));
    // 실제로 뭔가 그려졌는지 확인(공허한 통과 방지).
    let nonZero = 0;
    for (let i = 0; i < a.accum.length; i += 1) if (a.accum[i] > 0) nonZero += 1;
    expect(nonZero).toBeGreaterThan(100);
  });

  it("타일 순서를 뒤집어도 필름이 바이트 단위로 같다", () => {
    const ctx = makeContext(24, 16);
    const forward = createStudioPathtraceFilm(24, 16);
    const reversed = createStudioPathtraceFilm(24, 16);
    const tiles = planStudioPathtraceTiles(24, 16, 8);
    const flipped = [...tiles].reverse();
    for (let s = 0; s < 9; s += 1) {
      renderStudioPathtraceFrame(ctx, forward, s, tiles);
      renderStudioPathtraceFrame(ctx, reversed, s, flipped);
    }
    expect(new Uint8Array(reversed.accum.buffer)).toEqual(new Uint8Array(forward.accum.buffer));
  });

  it("타일 크기를 바꿔도 필름이 바이트 단위로 같다", () => {
    const ctx = makeContext(24, 16);
    const small = createStudioPathtraceFilm(24, 16);
    const large = createStudioPathtraceFilm(24, 16);
    renderStudioPathtraceProgressive(ctx, small, 9, planStudioPathtraceTiles(24, 16, 4));
    renderStudioPathtraceProgressive(ctx, large, 9, planStudioPathtraceTiles(24, 16, 64));
    expect(new Uint8Array(large.accum.buffer)).toEqual(new Uint8Array(small.accum.buffer));
  });

  it("타일 단위로 spp 를 다 도는 순서도 프레임 단위와 같은 결과를 준다", () => {
    const ctx = makeContext(16, 16);
    const frameMajor = createStudioPathtraceFilm(16, 16);
    const tileMajor = createStudioPathtraceFilm(16, 16);
    const tiles = planStudioPathtraceTiles(16, 16, 8);
    renderStudioPathtraceProgressive(ctx, frameMajor, 9, tiles);
    for (const tile of tiles) {
      for (let s = 0; s < 9; s += 1) renderStudioPathtraceTile(ctx, tileMajor, tile, s);
    }
    expect(new Uint8Array(tileMajor.accum.buffer)).toEqual(new Uint8Array(frameMajor.accum.buffer));
  });

  it("RGBA8 해상 결과도 동일하다", () => {
    const ctx = makeContext(16, 12);
    const a = createStudioPathtraceFilm(16, 12);
    const b = createStudioPathtraceFilm(16, 12);
    renderStudioPathtraceProgressive(ctx, a, 9, planStudioPathtraceTiles(16, 12, 5));
    renderStudioPathtraceProgressive(ctx, b, 9, planStudioPathtraceTiles(16, 12, 16));
    const ra = resolveStudioPathtraceFilm(a, { exposure: 1.2, toneMap: "aces" });
    const rb = resolveStudioPathtraceFilm(b, { exposure: 1.2, toneMap: "aces" });
    expect(rb).toEqual(ra);
    expect(ra.some((v, i) => i % 4 !== 3 && v > 0)).toBe(true);
  });
});

describe("수렴 — 실제 이미지 값", () => {
  it("furnace 씬은 모든 픽셀이 sRGB 255 로 해상된다", () => {
    const { scene, bvh } = createFurnaceQuadScene(1, 1);
    const ctx = createStudioPathtraceContext({
      scene,
      bvh,
      width: 16,
      height: 16,
      options: { ...RENDER_OPTIONS, samplesPerPixel: 4 },
    });
    const film = createStudioPathtraceFilm(16, 16);
    renderStudioPathtraceProgressive(ctx, film, 4);
    const rgba = resolveStudioPathtraceFilm(film, { toneMap: "none" });
    for (let p = 0; p < 256; p += 1) {
      expect(film.sampleCount[p]).toBe(4);
      expect(rgba[p * 4]).toBe(255);
      expect(rgba[p * 4 + 3]).toBe(255);
    }
  });

  it("샘플을 더 쌓으면 픽셀 분산이 줄어든다", () => {
    const ctx = makeContext(12, 12);
    const few = createStudioPathtraceFilm(12, 12);
    const many = createStudioPathtraceFilm(12, 12);
    renderStudioPathtraceProgressive(ctx, few, 4);
    renderStudioPathtraceProgressive(ctx, many, 100);

    function neighbourRoughness(film: ReturnType<typeof createStudioPathtraceFilm>): number {
      let sum = 0;
      let count = 0;
      for (let y = 0; y < 12; y += 1) {
        for (let x = 1; x < 12; x += 1) {
          const a = film.accum[(y * 12 + x) * 3] / film.sampleCount[y * 12 + x];
          const b = film.accum[(y * 12 + x - 1) * 3] / film.sampleCount[y * 12 + x - 1];
          sum += (a - b) * (a - b);
          count += 1;
        }
      }
      return sum / count;
    }

    expect(neighbourRoughness(many)).toBeLessThan(neighbourRoughness(few));
  });
});
