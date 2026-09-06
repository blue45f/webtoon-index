import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { COMPOSITE_PRESETS } from "./studio-background-3d-composites";
import { makeGeometry, PRIMITIVE_DEFS, type BgPrimitive, type BgPrimitiveKind } from "./studio-background-3d-primitives";
import {
  instantiateSceneTemplate,
  BG_SCENE_TEMPLATE_CATEGORIES,
  BG_SCENE_TEMPLATES,
  type BgSceneTemplate,
  type BgSceneTemplateCategory,
} from "./studio-background-3d-scene-templates";

const VALID_KINDS = new Set(Object.keys(PRIMITIVE_DEFS) as BgPrimitiveKind[]);
const VALID_PRESET_IDS = new Set(COMPOSITE_PRESETS.map((p) => p.id));

function isFiniteTriple(v: [number, number, number]): boolean {
  return v.length === 3 && v.every(Number.isFinite);
}

// ── 실측 기하 헬퍼(검증 패스에서 추가) ───────────────────────────────────────
// 아래 헬퍼들은 "좌표가 겹치는지"를 사람이 암산하는 대신, 실제 렌더러가 쓰는 것과 동일한
// makeGeometry() 지오메트리 + three.js Box3로 world-space 바운딩 박스를 계산한다. 이 방식으로
// 검증 패스에서 카페 테이블 반지름 버그(§cylinder 기본 반지름 0.3을 빠뜨림)와 교실 책상 상판이
// 몸통 위 4cm 허공에 뜨는 버그를 실제로 찾아냈다 — "반올림된 좌표가 겹치지 않는다"는 기존 가드는
// 두 버그 모두 통과시켰다(좌표 자체는 서로 다른 값이었으므로).

/** BgPrimitive 하나의 world-space AABB. makeGeometry가 실제 렌더링에 쓰는 것과 동일한 지오메트리라
 *  cylinder/sphere/cone처럼 "scale이 그대로 크기가 아닌" 도형도 정확하다. */
function worldBox(prim: BgPrimitive): THREE.Box3 {
  const geometry = makeGeometry(prim.kind);
  geometry.computeBoundingBox();
  const mesh = new THREE.Mesh(geometry);
  mesh.position.set(...prim.position);
  mesh.rotation.set(prim.rotation[0], prim.rotation[1], prim.rotation[2], "XYZ");
  mesh.scale.set(...prim.scale);
  mesh.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(mesh);
}

function boxVolume(box: THREE.Box3): number {
  const size = new THREE.Vector3();
  box.getSize(size);
  return Math.max(0, size.x) * Math.max(0, size.y) * Math.max(0, size.z);
}

/** instantiateSceneTemplate의 flat 출력을 "배치(placement) 하나 = BgPrimitive 1개 이상" 단위로
 *  되묶는다(composite 배치는 preset.parts.length개를 소비). 겹침/틈 검사는 같은 배치 내부(예: 벤치의
 *  좌석+등받이+다리2)가 아니라 서로 다른 배치 사이에서만 의미가 있으므로 이 그룹핑이 필요하다. */
function placementGroups(template: BgSceneTemplate, result: BgPrimitive[]): BgPrimitive[][] {
  const groups: BgPrimitive[][] = [];
  let cursor = 0;
  for (const placement of template.placements) {
    if (placement.type === "primitive") {
      groups.push([result[cursor]]);
      cursor += 1;
    } else {
      const preset = COMPOSITE_PRESETS.find((p) => p.id === placement.presetId);
      const n = preset?.parts.length ?? 0;
      groups.push(result.slice(cursor, cursor + n));
      cursor += n;
    }
  }
  return groups;
}

function isGroundPlane(placement: BgSceneTemplate["placements"][number]): boolean {
  return placement.type === "primitive" && placement.kind === "plane";
}

describe("studio-background-3d-scene-templates", () => {
  it("has at least 4 templates (design target: 4~6)", () => {
    expect(BG_SCENE_TEMPLATES.length).toBeGreaterThanOrEqual(4);
  });

  it("every template has a positive footprint and at least one placement", () => {
    for (const t of BG_SCENE_TEMPLATES) {
      expect(t.footprint.width).toBeGreaterThan(0);
      expect(t.footprint.depth).toBeGreaterThan(0);
      expect(t.placements.length).toBeGreaterThan(0);
    }
  });

  it("every primitive placement references a valid BgPrimitiveKind with finite transform", () => {
    for (const t of BG_SCENE_TEMPLATES) {
      for (const placement of t.placements) {
        if (placement.type !== "primitive") continue;
        expect(VALID_KINDS.has(placement.kind)).toBe(true);
        expect(isFiniteTriple(placement.position)).toBe(true);
        expect(isFiniteTriple(placement.rotation)).toBe(true);
        expect(isFiniteTriple(placement.scale)).toBe(true);
      }
    }
  });

  it("every composite placement references an existing COMPOSITE_PRESETS id", () => {
    for (const t of BG_SCENE_TEMPLATES) {
      for (const placement of t.placements) {
        if (placement.type !== "composite") continue;
        expect(VALID_PRESET_IDS.has(placement.presetId), `${t.id} has invalid presetId: ${placement.presetId}`).toBe(true);
        expect(isFiniteTriple(placement.anchor)).toBe(true);
        if (placement.yaw !== undefined) expect(Number.isFinite(placement.yaw)).toBe(true);
      }
    }
  });

  it("every category has at least one template, and labels cover exactly the category union", () => {
    for (const category of BG_SCENE_TEMPLATE_CATEGORIES) {
      expect(BG_SCENE_TEMPLATES.filter((t) => t.category === category).length).toBeGreaterThan(0);
    }
    const expected: BgSceneTemplateCategory[] = ["interior", "urban", "nature"];
    for (const category of expected) {
      expect(BG_SCENE_TEMPLATE_CATEGORIES).toContain(category);
    }
    for (const t of BG_SCENE_TEMPLATES) {
      expect(BG_SCENE_TEMPLATE_CATEGORIES).toContain(t.category);
    }
  });

  it("instantiateSceneTemplate produces one BgPrimitive per part/placement with unique, finite ids", () => {
    for (const t of BG_SCENE_TEMPLATES) {
      const result = instantiateSceneTemplate(t, 0);
      const expectedCount = t.placements.reduce((sum, p) => {
        if (p.type === "primitive") return sum + 1;
        const preset = COMPOSITE_PRESETS.find((preset) => preset.id === p.presetId);
        return sum + (preset?.parts.length ?? 0);
      }, 0);
      expect(result.length).toBe(expectedCount);

      const ids = new Set(result.map((p) => p.id));
      expect(ids.size).toBe(result.length);

      for (const prim of result) {
        expect(isFiniteTriple(prim.position)).toBe(true);
        expect(isFiniteTriple(prim.rotation)).toBe(true);
        expect(isFiniteTriple(prim.scale)).toBe(true);
        expect(VALID_KINDS.has(prim.kind)).toBe(true);
      }
    }
  });

  it("no two instantiated primitives in the same template share the exact same rounded position (coarse duplicate/overlap guard)", () => {
    for (const t of BG_SCENE_TEMPLATES) {
      const result = instantiateSceneTemplate(t, 0);
      const seen = new Set<string>();
      for (const prim of result) {
        const key = prim.position.map((n) => n.toFixed(2)).join(",");
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });

  it("existingCount=0 keeps the template at its authored origin (no shift)", () => {
    const t = BG_SCENE_TEMPLATES.find((t) => t.placements[0].type === "primitive")!;
    const result = instantiateSceneTemplate(t, 0);
    const firstPlacement = t.placements[0] as Extract<(typeof t.placements)[number], { type: "primitive" }>;
    expect(result[0].position).toEqual(firstPlacement.position);
  });

  it("anchorX grows monotonically with existingCount, scaled by footprint.width", () => {
    const t = BG_SCENE_TEMPLATES[0];
    const x0 = instantiateSceneTemplate(t, 0)[0].position[0];
    const x10 = instantiateSceneTemplate(t, 10)[0].position[0];
    const x20 = instantiateSceneTemplate(t, 20)[0].position[0];
    expect(x10).toBeCloseTo(x0 + 10 * (t.footprint.width / 6));
    expect(x20).toBeCloseTo(x0 + 20 * (t.footprint.width / 6));
    expect(x20).toBeGreaterThan(x10);
  });

  it("yaw=Math.PI on a composite placement flips its part offsets in X and Z (world-space 180° flip)", () => {
    const t = BG_SCENE_TEMPLATES.find((t) => t.placements.some((p) => p.type === "composite" && p.yaw === Math.PI))!;
    const placement = t.placements.find((p) => p.type === "composite" && p.yaw === Math.PI) as Extract<
      (typeof t.placements)[number],
      { type: "composite" }
    >;
    const preset = COMPOSITE_PRESETS.find((p) => p.id === placement.presetId)!;
    const result = instantiateSceneTemplate(t, 0);

    // 이 배치가 만든 파츠들만 골라 앵커 기준 오프셋을 역산해, 프리셋 원본 offset의 (x,z)가
    // 부호만 뒤집혀 있는지(180° 회전) 확인한다. y(높이)는 불변이어야 한다.
    let cursor = 0;
    for (const p of t.placements) {
      if (p === placement) break;
      cursor += p.type === "primitive" ? 1 : (COMPOSITE_PRESETS.find((preset) => preset.id === p.presetId)?.parts.length ?? 0);
    }
    const producedParts = result.slice(cursor, cursor + preset.parts.length);

    for (let i = 0; i < preset.parts.length; i++) {
      const original = preset.parts[i];
      const produced = producedParts[i];
      const impliedOffsetX = produced.position[0] - placement.anchor[0];
      const impliedOffsetY = produced.position[1] - placement.anchor[1];
      const impliedOffsetZ = produced.position[2] - placement.anchor[2];
      expect(impliedOffsetX).toBeCloseTo(-original.offset[0], 4);
      expect(impliedOffsetY).toBeCloseTo(original.offset[1], 4);
      expect(impliedOffsetZ).toBeCloseTo(-original.offset[2], 4);
    }
  });

  it("does not share array references across two instantiations (purity)", () => {
    const t = BG_SCENE_TEMPLATES[0];
    const first = instantiateSceneTemplate(t, 0);
    const second = instantiateSceneTemplate(t, 0);
    const originalPosition = [...second[0].position];
    first[0].position[0] = 9999;
    expect(second[0].position).toEqual(originalPosition);
  });

  it("unknown composite presetId is silently skipped, not thrown (documented typo-guard behavior)", () => {
    const bogus: BgSceneTemplate = {
      id: "bogus",
      category: "interior",
      label: "bogus",
      description: "test-only",
      footprint: { width: 1, depth: 1 },
      placements: [
        { type: "composite", presetId: "this_preset_id_does_not_exist", anchor: [0, 0, 0] },
        { type: "primitive", kind: "box", position: [0, 0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: "#fff" },
      ],
    };
    expect(() => instantiateSceneTemplate(bogus, 0)).not.toThrow();
    const result = instantiateSceneTemplate(bogus, 0);
    // only the valid primitive placement should have produced output; the bogus preset contributes nothing.
    expect(result.length).toBe(1);
    expect(result[0].kind).toBe("box");
  });

  // ── 실측 기하 회귀 테스트(검증 패스에서 추가) — "좌표가 정확히 겹치지 않는다"가 아니라 실제
  // 렌더 지오메트리의 world-space AABB를 three.js Box3로 계산해 비교한다. 아래 두 항목은 검증
  // 패스에서 실제로 발견해 고친 버그의 회귀 가드다.

  it("yaw handling matches an independent rigid-body Matrix4 decomposition for every composite part, across many angles (not just the ones the catalog happens to use)", () => {
    // instantiateSceneTemplate 내부 구현과 같은 공식을 여기서 다시 손으로 적어 비교하는 게 아니라,
    // "앵커에서 전체 파츠를 world Y축으로 yaw만큼 강체 회전시킨다"는 정의 자체를 Matrix4 합성으로
    // 처음부터 다시 만들어 비교한다 — instantiateSceneTemplate의 코드 경로를 전혀 거치지 않는
    // 독립적인 정답(ground truth)이다.
    const angles = [0, 0.3, Math.PI / 2, 1.2345, Math.PI, -Math.PI / 2, 2.1, -1.0];
    for (const preset of COMPOSITE_PRESETS) {
      for (const part of preset.parts) {
        for (const yaw of angles) {
          const localTransform = new THREE.Matrix4().compose(
            new THREE.Vector3(...part.offset),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(part.rotation[0], part.rotation[1], part.rotation[2], "XYZ")),
            new THREE.Vector3(1, 1, 1),
          );
          const trueTransform = new THREE.Matrix4().multiplyMatrices(new THREE.Matrix4().makeRotationY(yaw), localTransform);
          const truePosition = new THREE.Vector3();
          const trueQuaternion = new THREE.Quaternion();
          const trueScale = new THREE.Vector3();
          trueTransform.decompose(truePosition, trueQuaternion, trueScale);

          // 실제 템플릿을 앵커 (0,0,0), yaw만큼 회전시켜 instantiateSceneTemplate으로 전개하고,
          // 결과에서 이 파츠 하나만 골라 비교한다(= 실제 코드 경로).
          const probeTemplate: BgSceneTemplate = {
            id: "probe",
            category: "interior",
            label: "probe",
            description: "test-only",
            footprint: { width: 1, depth: 1 },
            placements: [{ type: "composite", presetId: preset.id, anchor: [0, 0, 0], yaw }],
          };
          const partIndex = preset.parts.indexOf(part);
          const produced = instantiateSceneTemplate(probeTemplate, 0)[partIndex];
          const producedPosition = new THREE.Vector3(...produced.position);
          const producedQuaternion = new THREE.Quaternion().setFromEuler(
            new THREE.Euler(produced.rotation[0], produced.rotation[1], produced.rotation[2], "XYZ"),
          );

          expect(producedPosition.distanceTo(truePosition)).toBeLessThan(1e-6);
          expect(trueQuaternion.angleTo(producedQuaternion)).toBeLessThan(1e-6);
        }
      }
    }
  });

  it("cafe table renders at a realistic radius (bigger than a chair's half-width) — regression guard for the cylinder-scale bug", () => {
    // makeGeometry("cylinder")의 기본 반지름은 0.3이라 실제 렌더 반지름은 0.3 * scale.x다(scale.x
    // 자체가 반지름이 아니다). 이 값을 잘못 계산하면(검증 패스에서 실제로 발견) 테이블이 의자보다
    // 작아지는 등 눈에 띄게 어색해진다.
    const cafe = BG_SCENE_TEMPLATES.find((t) => t.id === "cafe")!;
    const result = instantiateSceneTemplate(cafe, 0);
    const tabletops = result.filter((p) => p.kind === "cylinder" && Math.abs(p.scale[1] - 0.05) < 1e-9);
    const chairHalfWidth = 0.2; // cafeTable() 의자 scale.x=0.4의 절반 — box는 scale이 곧 실제 크기.
    expect(tabletops.length).toBeGreaterThan(0);
    for (const tabletop of tabletops) {
      const actualRadius = 0.3 * tabletop.scale[0];
      expect(actualRadius).toBeGreaterThan(chairHalfWidth);
      expect(actualRadius).toBeCloseTo(0.5, 1); // 의도한 실제 반지름(§cafeTable 주석)
    }
  });

  it("no two DIFFERENT placements in any template interpenetrate by more than 80% of the smaller one's volume (real geometry, not rounded-position equality)", () => {
    // 임계값 80%는 임의로 고른 게 아니라, 이 카탈로그의 알려진/의도된 최대 임베딩(창문이 벽에
    // 파묻히는 정도, 58.3%)보다 여유 있게 높게 잡아, "같은 오브젝트가 같은 자리에 중복 배치"류의
    // 진짜 버그만 잡고 기존의 의도된 소소한 임베딩은 통과시킨다.
    const OVERLAP_CEILING = 0.8;
    for (const t of BG_SCENE_TEMPLATES) {
      const result = instantiateSceneTemplate(t, 0);
      const groups = placementGroups(t, result);
      const groupBoxes = groups.map((g) => {
        const boxes = g.map(worldBox);
        const union = boxes[0].clone();
        for (const b of boxes.slice(1)) union.union(b);
        return { union, volume: boxVolume(union) };
      });

      for (let i = 0; i < groupBoxes.length; i++) {
        for (let j = i + 1; j < groupBoxes.length; j++) {
          const a = groupBoxes[i];
          const b = groupBoxes[j];
          if (!a.union.intersectsBox(b.union)) continue;
          const interVol = boxVolume(a.union.clone().intersect(b.union));
          const smaller = Math.min(a.volume, b.volume);
          if (smaller <= 0) continue;
          const frac = interVol / smaller;
          expect(frac, `${t.id}: placement#${i} vs placement#${j} overlap ${(frac * 100).toFixed(1)}% of smaller volume`).toBeLessThanOrEqual(
            OVERLAP_CEILING,
          );
        }
      }
    }
  });

  it("no non-ground-plane pair of placements has an unintended floating gap between vertically-stacked parts (real geometry)", () => {
    // "바닥/도로/광장 평면 위 몇 m 높이에 떠 있다"는 모든 오브젝트에 해당하는 정상 상태라 바닥
    // 평면(kind: "plane")과의 비교는 제외한다 — 대신 가구 부품처럼 서로 맞닿아야 하는 두 파츠
    // 사이의 뜻밖의 틈만 잡는다. 실제로 이 테스트가(정확히는 이 로직의 스크립트 버전이) 교실
    // 책상 상판-몸통 사이 4cm 틈을 찾아냈다.
    for (const t of BG_SCENE_TEMPLATES) {
      const result = instantiateSceneTemplate(t, 0);
      const groups = placementGroups(t, result);
      const boxes = groups.map((g) => {
        const bs = g.map(worldBox);
        const union = bs[0].clone();
        for (const b of bs.slice(1)) union.union(b);
        return union;
      });

      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          if (isGroundPlane(t.placements[i]) || isGroundPlane(t.placements[j])) continue;
          const a = boxes[i];
          const b = boxes[j];
          const xOverlap = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x);
          const zOverlap = Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z);
          if (xOverlap <= 0 || zOverlap <= 0) continue; // 수평으로 겹치지 않으면 애초에 "쌓인" 관계가 아님.
          const aFoot = (a.max.x - a.min.x) * (a.max.z - a.min.z);
          const bFoot = (b.max.x - b.min.x) * (b.max.z - b.min.z);
          const footprintOverlapFrac = (xOverlap * zOverlap) / Math.min(aFoot, bFoot);
          if (footprintOverlapFrac < 0.5) continue; // 우연히 근처에 있을 뿐, "쌓인" 관계로 보기엔 겹침이 작음.
          const yGap = a.max.y < b.min.y ? b.min.y - a.max.y : b.max.y < a.min.y ? a.min.y - b.max.y : -1;
          expect(yGap, `${t.id}: placement#${i} vs placement#${j} float gap ${yGap.toFixed(3)}m despite ${(footprintOverlapFrac * 100).toFixed(0)}% footprint overlap`).toBeLessThanOrEqual(
            0.005,
          );
        }
      }
    }
  });
});
