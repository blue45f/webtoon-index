import { describe, expect, it } from "vitest";

import { createSculptIcosphere, createSculptPlaneGrid } from "./studio-sculpt-mesh";
import {
  SCULPT_HASH_MAX_PADDING_CELLS,
  SCULPT_QUERY_OVERFLOW,
  SCULPT_QUERY_STALE,
  bruteForceSculptSphere,
  buildSculptSpatialHash,
  findSculptNearestVertex,
  querySculptSphere,
  sculptSpatialHashShouldRebuild,
} from "./studio-sculpt-spatial-hash";

/** 시드 PRNG(mulberry32) — 테스트 픽스처 전용. 엔진 코드에는 난수가 없다. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomCloud(seed: number, count: number, spread = 4): Float32Array {
  const next = seededRandom(seed);
  const positions = new Float32Array(count * 3);
  for (let v = 0; v < count * 3; v += 1) positions[v] = (next() - 0.5) * spread;
  return positions;
}

function sortedQuery(out: Uint32Array, count: number): number[] {
  return Array.from(out.subarray(0, count)).sort((a, b) => a - b);
}

describe("sculpt spatial hash — 브루트포스 동치", () => {
  it("시드 랜덤 점군에서 해시 질의 결과가 브루트포스와 정확히 같다", () => {
    for (const seed of [1, 7, 42, 1337, 90210]) {
      const count = 900;
      const positions = randomCloud(seed, count);
      const hash = buildSculptSpatialHash(positions, count);
      const hashOut = new Uint32Array(count);
      const bruteOut = new Uint32Array(count);
      const next = seededRandom(seed ^ 0x5bf03635);
      let totalHits = 0;
      for (let trial = 0; trial < 40; trial += 1) {
        const cx = (next() - 0.5) * 5;
        const cy = (next() - 0.5) * 5;
        const cz = (next() - 0.5) * 5;
        const radius = 0.05 + next() * 1.4;
        const hashCount = querySculptSphere(hash, positions, cx, cy, cz, radius, 0, hashOut);
        const bruteCount = bruteForceSculptSphere(positions, count, cx, cy, cz, radius, bruteOut);
        expect(hashCount).toBeGreaterThanOrEqual(0);
        expect(sortedQuery(hashOut, hashCount)).toEqual(sortedQuery(bruteOut, bruteCount));
        totalHits += bruteCount;
      }
      // 전부 0 히트였다면 위 동치는 의미가 없다 — 실제로 뭔가 잡혔는지 확인한다.
      expect(totalHits).toBeGreaterThan(100);
    }
  });

  it("빌드 이후 정점이 움직여도 padding 을 정직하게 넘기면 브루트포스와 같다", () => {
    const count = 700;
    const positions = randomCloud(2026, count);
    const hash = buildSculptSpatialHash(positions, count);
    const slack = hash.cellSize * 0.5;
    const next = seededRandom(31337);
    let maxMoved = 0;
    for (let v = 0; v < count; v += 1) {
      const base = v * 3;
      for (let c = 0; c < 3; c += 1) positions[base + c] += (next() - 0.5) * slack;
      // 실제 이동량을 재서 padding 상한이 진짜로 상한인지 확인한다.
      maxMoved = Math.max(maxMoved, (slack * Math.sqrt(3)) / 2);
    }
    expect(maxMoved).toBeLessThanOrEqual(hash.cellSize * SCULPT_HASH_MAX_PADDING_CELLS);

    const hashOut = new Uint32Array(count);
    const bruteOut = new Uint32Array(count);
    for (let trial = 0; trial < 30; trial += 1) {
      const cx = (next() - 0.5) * 4;
      const cy = (next() - 0.5) * 4;
      const cz = (next() - 0.5) * 4;
      const radius = 0.2 + next() * 1.2;
      const hashCount = querySculptSphere(
        hash,
        positions,
        cx,
        cy,
        cz,
        radius,
        maxMoved,
        hashOut,
      );
      const bruteCount = bruteForceSculptSphere(positions, count, cx, cy, cz, radius, bruteOut);
      expect(sortedQuery(hashOut, hashCount)).toEqual(sortedQuery(bruteOut, bruteCount));
    }
  });

  it("퇴화 바운딩박스(평면 메시)에서도 브루트포스와 같다", () => {
    const mesh = createSculptPlaneGrid(24, 24, 4);
    const hash = buildSculptSpatialHash(mesh.positions, mesh.vertexCount);
    expect(hash.dimY).toBe(1);
    const hashOut = new Uint32Array(mesh.vertexCount);
    const bruteOut = new Uint32Array(mesh.vertexCount);
    const next = seededRandom(77);
    for (let trial = 0; trial < 25; trial += 1) {
      const cx = (next() - 0.5) * 5;
      const cz = (next() - 0.5) * 5;
      const radius = 0.1 + next() * 1.0;
      const hashCount = querySculptSphere(hash, mesh.positions, cx, 0, cz, radius, 0, hashOut);
      const bruteCount = bruteForceSculptSphere(
        mesh.positions,
        mesh.vertexCount,
        cx,
        0,
        cz,
        radius,
        bruteOut,
      );
      expect(sortedQuery(hashOut, hashCount)).toEqual(sortedQuery(bruteOut, bruteCount));
    }
  });
});

describe("sculpt spatial hash — fail-closed 계약", () => {
  it("padding 이 허용 범위를 넘으면 조용히 놓치지 않고 STALE 을 반환한다", () => {
    const positions = randomCloud(5, 300);
    const hash = buildSculptSpatialHash(positions, 300);
    const tooMuch = hash.cellSize * (SCULPT_HASH_MAX_PADDING_CELLS + 0.001);
    expect(sculptSpatialHashShouldRebuild(hash, tooMuch)).toBe(true);
    expect(sculptSpatialHashShouldRebuild(hash, hash.cellSize)).toBe(false);
    const out = new Uint32Array(300);
    expect(querySculptSphere(hash, positions, 0, 0, 0, 1, tooMuch, out)).toBe(SCULPT_QUERY_STALE);
    expect(querySculptSphere(hash, positions, 0, 0, 0, 1, Number.NaN, out)).toBe(
      SCULPT_QUERY_STALE,
    );
  });

  it("out 버퍼가 모자라면 절단하지 않고 OVERFLOW 를 반환한다", () => {
    const mesh = createSculptIcosphere(3, 1);
    const hash = buildSculptSpatialHash(mesh.positions, mesh.vertexCount);
    const tiny = new Uint32Array(4);
    expect(querySculptSphere(hash, mesh.positions, 0, 0, 0, 10, 0, tiny)).toBe(
      SCULPT_QUERY_OVERFLOW,
    );
    const roomy = new Uint32Array(mesh.vertexCount);
    expect(querySculptSphere(hash, mesh.positions, 0, 0, 0, 10, 0, roomy)).toBe(mesh.vertexCount);
  });

  it("반경이 0 이하거나 유한하지 않으면 0 개를 반환한다", () => {
    const positions = randomCloud(9, 50);
    const hash = buildSculptSpatialHash(positions, 50);
    const out = new Uint32Array(50);
    expect(querySculptSphere(hash, positions, 0, 0, 0, 0, 0, out)).toBe(0);
    expect(querySculptSphere(hash, positions, 0, 0, 0, Number.NaN, 0, out)).toBe(0);
  });

  it("셀 예산을 넘기지 않도록 셀 크기를 키운다", () => {
    const positions = randomCloud(11, 200, 1000);
    const hash = buildSculptSpatialHash(positions, 200, { cellSize: 0.001, maxCells: 4096 });
    expect(hash.dimX * hash.dimY * hash.dimZ).toBeLessThanOrEqual(4096);
    expect(hash.cellSize).toBeGreaterThan(0.001);
    const hashOut = new Uint32Array(200);
    const bruteOut = new Uint32Array(200);
    const hashCount = querySculptSphere(hash, positions, 0, 0, 0, 120, 0, hashOut);
    const bruteCount = bruteForceSculptSphere(positions, 200, 0, 0, 0, 120, bruteOut);
    expect(sortedQuery(hashOut, hashCount)).toEqual(sortedQuery(bruteOut, bruteCount));
  });
});

describe("sculpt spatial hash — 최근접 조회", () => {
  it("반경 안의 가장 가까운 정점을 찾고, 밖이면 -1 을 준다", () => {
    const mesh = createSculptIcosphere(2, 1);
    const hash = buildSculptSpatialHash(mesh.positions, mesh.vertexCount);
    for (const target of [0, 17, 99, mesh.vertexCount - 1]) {
      const base = target * 3;
      const found = findSculptNearestVertex(
        hash,
        mesh.positions,
        mesh.positions[base],
        mesh.positions[base + 1],
        mesh.positions[base + 2],
        1e-6,
      );
      expect(found).toBe(target);
    }
    expect(findSculptNearestVertex(hash, mesh.positions, 100, 100, 100, 1)).toBe(-1);
  });
});
