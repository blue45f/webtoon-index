import { describe, expect, it } from "vitest";

import {
  createSculptIcosphere,
  createSculptPlaneGrid,
  createSculptUvSphere,
} from "./studio-sculpt-mesh";
import {
  buildSculptSymmetryMap,
  normalizeSculptSymmetryAxis,
  sculptSymmetryAuthoritySign,
  sculptSymmetryAxisComponent,
  sculptSymmetryIsAuthorityVertex,
  sculptSymmetryIsExact,
  snapSculptSymmetryPlane,
} from "./studio-sculpt-symmetry";

describe("sculpt symmetry — 페어맵", () => {
  it("대칭 생성기 메시는 짝 없는 정점이 0 이고 미러 불변식이 비트 정확하다", () => {
    for (const mesh of [
      createSculptIcosphere(3),
      createSculptUvSphere(16, 10),
      createSculptPlaneGrid(6, 6, 2),
    ]) {
      const map = buildSculptSymmetryMap(mesh.positions, mesh.vertexCount, { axis: "x" });
      expect(map.unpairedCount).toBe(0);
      expect(map.planarCount).toBeGreaterThan(0);
      expect(map.pairCount * 2 + map.planarCount).toBe(mesh.vertexCount);
      expect(sculptSymmetryIsExact(mesh.positions, map)).toBe(true);
    }
  });

  it("짝 관계가 상호적이다(partner[partner[i]] === i)", () => {
    const mesh = createSculptIcosphere(2);
    const map = buildSculptSymmetryMap(mesh.positions, mesh.vertexCount);
    for (let i = 0; i < mesh.vertexCount; i += 1) {
      const j = map.partner[i];
      expect(j).toBeGreaterThanOrEqual(0);
      expect(map.partner[j]).toBe(i);
    }
  });

  it("비대칭 메시에서는 짝 없음을 조용히 넘기지 않고 보고한다", () => {
    const mesh = createSculptIcosphere(2);
    // 평면 위가 아닌 정점 하나를 크게 밀어 짝을 깬다.
    let victim = -1;
    for (let v = 0; v < mesh.vertexCount; v += 1) {
      if (mesh.positions[v * 3] > 0.3) {
        victim = v;
        break;
      }
    }
    expect(victim).toBeGreaterThanOrEqual(0);
    mesh.positions[victim * 3 + 1] += 0.37;
    const map = buildSculptSymmetryMap(mesh.positions, mesh.vertexCount, { axis: "x" });
    // 밀린 정점과 그 짝, 둘 다 짝을 잃는다.
    expect(map.unpairedCount).toBe(2);
    expect(map.partner[victim]).toBe(-1);
    // 짝 없는 정점은 대칭 검사에서 제외되므로 나머지 관계는 여전히 정확하다.
    expect(sculptSymmetryIsExact(mesh.positions, map)).toBe(true);
  });

  it("아이코스피어는 x·y·z 세 축 모두에서 비트 정확하다", () => {
    const mesh = createSculptIcosphere(3);
    for (const axis of ["x", "y", "z"] as const) {
      const map = buildSculptSymmetryMap(mesh.positions, mesh.vertexCount, { axis });
      expect(map.component).toBe(sculptSymmetryAxisComponent(axis));
      expect({ axis, unpaired: map.unpairedCount }).toEqual({ axis, unpaired: 0 });
      expect(sculptSymmetryIsExact(mesh.positions, map)).toBe(true);
    }
  });

  it("UV 구는 x·z 는 비트 정확하지만 y(위도)는 아니다 — 한계를 그대로 못 박는다", () => {
    const mesh = createSculptUvSphere(16, 12);
    for (const axis of ["x", "z"] as const) {
      const map = buildSculptSymmetryMap(mesh.positions, mesh.vertexCount, { axis });
      expect(sculptSymmetryIsExact(mesh.positions, map)).toBe(true);
    }
    // 위도는 Math.cos(π i / rings) 로 만든다. cos(π − t) 가 −cos(t) 와 비트 동일하지 않으므로
    // y 미러는 근사일 뿐이다(짝은 epsilon 안에서 찾아지지만 좌표가 정확히 반사는 아니다).
    const yMap = buildSculptSymmetryMap(mesh.positions, mesh.vertexCount, { axis: "y" });
    expect(yMap.unpairedCount).toBe(0);
    expect(sculptSymmetryIsExact(mesh.positions, yMap)).toBe(false);
  });
});

describe("sculpt symmetry — 평면 스냅", () => {
  it("평면 위 정점의 축 성분을 정확히 0 으로 만들어 불변식을 복구한다", () => {
    const mesh = createSculptPlaneGrid(6, 6, 2);
    const map = buildSculptSymmetryMap(mesh.positions, mesh.vertexCount, {
      axis: "x",
      epsilon: 0.05,
    });
    // 평면 위 정점을 epsilon 안에서 살짝 흔들어 불변식을 깬다.
    let planarVertex = -1;
    for (let v = 0; v < mesh.vertexCount; v += 1) {
      if (map.partner[v] === v) {
        planarVertex = v;
        break;
      }
    }
    expect(planarVertex).toBeGreaterThanOrEqual(0);
    mesh.positions[planarVertex * 3] = 0.01;
    expect(sculptSymmetryIsExact(mesh.positions, map)).toBe(false);

    const changed = snapSculptSymmetryPlane(mesh.positions, map);
    expect(changed).toBe(1);
    expect(mesh.positions[planarVertex * 3]).toBe(0);
    expect(sculptSymmetryIsExact(mesh.positions, map)).toBe(true);
  });
});

describe("sculpt symmetry — 미러 복사 불변식", () => {
  it("권위 쪽 변위를 축 성분만 반전해 짝에 더하면 대칭이 비트 정확하게 유지된다", () => {
    const mesh = createSculptIcosphere(3);
    const map = buildSculptSymmetryMap(mesh.positions, mesh.vertexCount, { axis: "x" });
    const authoritySign = sculptSymmetryAuthoritySign(0.5);
    expect(authoritySign).toBe(1);
    expect(sculptSymmetryAuthoritySign(-0.5)).toBe(-1);
    expect(sculptSymmetryAuthoritySign(0)).toBe(1);

    let applied = 0;
    for (let v = 0; v < mesh.vertexCount; v += 1) {
      if (!sculptSymmetryIsAuthorityVertex(mesh.positions, map, v, authoritySign)) continue;
      const dx = ((v % 5) - 2) * 0.013;
      const dy = ((v % 7) - 3) * 0.017;
      const dz = ((v % 11) - 5) * 0.011;
      const partner = map.partner[v];
      if (partner === v) {
        // 평면 위 — 축 성분을 0 으로.
        mesh.positions[v * 3 + 1] += dy;
        mesh.positions[v * 3 + 2] += dz;
        applied += 1;
        continue;
      }
      mesh.positions[v * 3] += dx;
      mesh.positions[v * 3 + 1] += dy;
      mesh.positions[v * 3 + 2] += dz;
      mesh.positions[partner * 3] += -dx;
      mesh.positions[partner * 3 + 1] += dy;
      mesh.positions[partner * 3 + 2] += dz;
      applied += 1;
    }
    expect(applied).toBeGreaterThan(mesh.vertexCount / 3);
    expect(sculptSymmetryIsExact(mesh.positions, map)).toBe(true);
  });

  it("권위 판정이 x 부호와 평면 여부로 정확히 갈린다", () => {
    const mesh = createSculptIcosphere(2);
    const map = buildSculptSymmetryMap(mesh.positions, mesh.vertexCount, { axis: "x" });
    let positive = 0;
    let negative = 0;
    let planar = 0;
    for (let v = 0; v < mesh.vertexCount; v += 1) {
      const isAuthority = sculptSymmetryIsAuthorityVertex(mesh.positions, map, v, 1);
      if (map.partner[v] === v) {
        expect(isAuthority).toBe(true);
        planar += 1;
      } else if (mesh.positions[v * 3] > 0) {
        expect(isAuthority).toBe(true);
        positive += 1;
      } else {
        expect(isAuthority).toBe(false);
        negative += 1;
      }
    }
    expect(positive).toBe(negative);
    expect(planar + positive + negative).toBe(mesh.vertexCount);
  });
});

describe("sculpt symmetry — 정규화", () => {
  it("알 수 없는 축은 x 로 폴백한다", () => {
    expect(normalizeSculptSymmetryAxis("z")).toBe("z");
    expect(normalizeSculptSymmetryAxis("w")).toBe("x");
    expect(normalizeSculptSymmetryAxis(undefined)).toBe("x");
    expect(sculptSymmetryAxisComponent("x")).toBe(0);
    expect(sculptSymmetryAxisComponent("y")).toBe(1);
    expect(sculptSymmetryAxisComponent("z")).toBe(2);
  });
});
