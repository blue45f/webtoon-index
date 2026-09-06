import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  buildAvatarForgeHairParts,
  createAvatarForgeState,
} from "./studio-vrm-avatar-forge";
import {
  countDetectedVrmHairMeshes,
  createAvatarForgeHairGeometry,
  shouldHideAuthoredVrmHair,
} from "./StudioVrmAvatarForge";

import type { AvatarForgeHairPart, AvatarForgeHairStyle } from "./studio-vrm-avatar-forge";
import type { VRM } from "@pixiv/three-vrm";

function material(name: string) {
  const value = new THREE.MeshBasicMaterial();
  value.name = name;
  return value;
}

function mesh(name: string, materials: THREE.Material | THREE.Material[]) {
  const value = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), materials);
  value.name = name;
  return value;
}

function vrmWith(...objects: THREE.Object3D[]) {
  const scene = new THREE.Group();
  scene.add(...objects);
  return { scene } as unknown as VRM;
}

describe("countDetectedVrmHairMeshes", () => {
  it("detects explicitly separated hair meshes by node or material name", () => {
    const namedHair = mesh("Hair_Back", material("Material.001"));
    const materialHair = mesh("Node_001", material("N00_000_Hair_00_HAIR"));

    expect(countDetectedVrmHairMeshes(vrmWith(namedHair, materialHair))).toBe(2);
  });

  it("never treats a baked body mesh with skin and hair materials as replaceable", () => {
    const bakedBody = mesh("Body (merged).baked", [
      material("N00_000_00_Body_00_SKIN (Instance)"),
      material("N00_000_00_HairBack_00_HAIR (Instance)"),
    ]);

    expect(countDetectedVrmHairMeshes(vrmWith(bakedBody))).toBe(0);
  });

  it("rejects face meshes and ambiguous multi-material generic nodes", () => {
    const faceHair = mesh("Face_Hair_Combined", material("Hair"));
    const ambiguous = mesh("Node_002", [material("Hair_Back"), material("Material.002")]);

    expect(countDetectedVrmHairMeshes(vrmWith(faceHair, ambiguous))).toBe(0);
  });

  it("excludes generated forge descendants from subsequent detection passes", () => {
    const forge = new THREE.Group();
    forge.userData.toonSpectrumAvatarForge = true;
    forge.add(mesh("ToonSpectrumAvatarForgeHair_bang", material("Hair_Bang")));

    expect(countDetectedVrmHairMeshes(vrmWith(forge))).toBe(0);
  });
});

/* ── 계획 → 실제 지오메트리 (정점 수·좌표 수치 검증) ───────────────────── */

const ALL_STYLES: readonly AvatarForgeHairStyle[] = [
  "short", "bob", "long", "ponytail", "twintail", "bun",
  "wavy", "braid", "twin-braid", "hime", "wolf", "half-up", "pixie",
];

function planFor(style: AvatarForgeHairStyle, patch: Record<string, unknown> = {}) {
  const state = createAvatarForgeState();
  state.hair = { ...state.hair, style, ...patch } as typeof state.hair;
  return buildAvatarForgeHairParts(state);
}

function positionsOf(part: AvatarForgeHairPart) {
  const geometry = createAvatarForgeHairGeometry(part);
  const attribute = geometry.getAttribute("position") as THREE.BufferAttribute;
  const array = Float32Array.from(attribute.array as ArrayLike<number>);
  geometry.dispose();
  return { count: attribute.count, array };
}

describe("createAvatarForgeHairGeometry", () => {
  it("가닥은 19×7 front/back 그리드의 닫힌 authored clump로 구워진다", () => {
    const strand = planFor("long").find((part) => part.primitive === "tapered-capsule");
    expect(strand).toBeDefined();
    expect(positionsOf(strand!).count).toBe((18 + 1) * (6 + 1) * 2);
  });

  it("캡은 고밀도 authored shell, 번 파츠는 완전구로 구워진다", () => {
    const parts = planFor("bun");
    const cap = parts.find((part) => part.role === "cap");
    const bun = parts.find((part) => part.id === "bun");
    expect(positionsOf(cap!).count).toBe(29 * 19);
    expect(positionsOf(bun!).count).toBe(25 * 17);
  });

  it("모든 스타일의 모든 파츠가 유한한 정점과 색 속성을 만든다", () => {
    let partsChecked = 0;
    for (const style of ALL_STYLES) {
      for (const part of planFor(style, { ahoge: 0.6 })) {
        const geometry = createAvatarForgeHairGeometry(part);
        const position = geometry.getAttribute("position");
        const color = geometry.getAttribute("color");
        expect(position.count).toBeGreaterThan(0);
        expect(color?.count).toBe(position.count);
        for (let index = 0; index < position.count * 3; index += 1) {
          expect(Number.isFinite((position.array as ArrayLike<number>)[index])).toBe(true);
        }
        geometry.dispose();
        partsChecked += 1;
      }
    }
    expect(partsChecked).toBeGreaterThan(100);
  });

  it("wave가 없는 v1 계획은 정점 좌표가 웨이브 코드 도입 전과 완전히 동일하다", () => {
    // v1 스타일의 가닥에는 wave 키가 없어야 하고, 그때 좌표는 곡률(curl)만으로 결정된다.
    for (const style of ["short", "bob", "long", "ponytail", "twintail", "bun"] as const) {
      for (const part of planFor(style)) {
        expect(part.wave).toBeUndefined();
      }
    }

    // 웨이브 분기를 켜고 끈 두 계획을 같은 파츠에서 비교 — 0일 때는 완전 동일해야 한다.
    const straight = planFor("long").find((part) => part.id === "side-left")!;
    const zeroWave: AvatarForgeHairPart = { ...straight, wave: 0, waveFrequency: 2.4 };
    expect(positionsOf(zeroWave).array).toEqual(positionsOf(straight).array);
  });

  it("wave가 커지면 가닥이 실제로 좌우로 휜다", () => {
    const straight = planFor("long").find((part) => part.id === "side-left")!;
    const waved: AvatarForgeHairPart = { ...straight, wave: 0.8, waveFrequency: 2.4 };

    const before = positionsOf(straight);
    const after = positionsOf(waved);
    expect(after.count).toBe(before.count);

    const centrelineXs = (values: Float32Array) =>
      Array.from({ length: 19 }, (_, row) => values[(row * 7 + 3) * 3] ?? 0);
    const beforeCenters = centrelineXs(before.array);
    const afterCenters = centrelineXs(after.array);
    const maximumCenterlineShift = Math.max(
      ...afterCenters.map((value, index) => Math.abs(value - (beforeCenters[index] ?? 0))),
    );
    expect(maximumCenterlineShift).toBeGreaterThan(0.1);
  });
});


describe("Avatar Forge toon-clump geometry quality", () => {
  it("produces pointed, flattened toon clumps instead of constant-radius tubes", () => {
    const strand = planFor("long").find((part) => part.primitive === "tapered-capsule")!;
    const { array } = positionsOf(strand);
    const columns = 7;

    const spread = (row: number, axis: 0 | 2) => {
      let minimum = Number.POSITIVE_INFINITY;
      let maximum = Number.NEGATIVE_INFINITY;
      for (let column = 0; column < columns; column += 1) {
        const value = array[(row * columns + column) * 3 + axis]!;
        minimum = Math.min(minimum, value);
        maximum = Math.max(maximum, value);
      }
      return maximum - minimum;
    };

    const rootWidth = spread(1, 0);
    const rootDepth = spread(1, 2);
    const tipWidth = spread(18, 0);
    expect(rootDepth).toBeLessThan(rootWidth * 0.5);
    expect(tipWidth).toBeLessThan(rootWidth * 0.08);
  });
});

describe("shouldHideAuthoredVrmHair", () => {
  it("hides the model's own hair whenever the creator asked for it", () => {
    expect(shouldHideAuthoredVrmHair({ replaceOriginal: true })).toBe(true);
    expect(shouldHideAuthoredVrmHair({ replaceOriginal: false })).toBe(false);
  });

  it("keeps hiding it for the 'none' style, which is how a bald head is authored", () => {
    // The Character Shaper's 「헤어 없음」 card is exactly this combination, and its copy promises
    // the authored hair disappears. Excluding "none" here made that card apply with no visible
    // change — the dishonest state the slot catalog exists to prevent.
    const bald = createAvatarForgeState();
    bald.hair.style = "none";
    bald.hair.replaceOriginal = true;
    expect(shouldHideAuthoredVrmHair(bald.hair)).toBe(true);
  });

  it("restores the authored hair through the toggle rather than through a style", () => {
    const restored = createAvatarForgeState();
    restored.hair.style = "bob";
    restored.hair.replaceOriginal = false;
    expect(shouldHideAuthoredVrmHair(restored.hair)).toBe(false);
  });
});
