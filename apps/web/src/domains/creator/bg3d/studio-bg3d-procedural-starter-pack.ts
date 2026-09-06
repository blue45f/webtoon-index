/**
 * ToonSpectrum-authored, file-free starter geometry for the BG3D primitive runtime.
 *
 * The catalog deliberately contains no URL, thumbnail, binary model, texture, or marketplace
 * identity. Every asset expands into the engine-neutral `BgPrimitive[]` contract already consumed
 * by StudioBackground3D, so both WebGL2 and WebGPU renderers can use the same scene document.
 */

import type {
  BgPrimitive,
  BgPrimitiveKind,
} from "../studio-background-3d-metadata";
import type { StudioBg3dComplexityBudget } from "./studio-bg3d-scene-document";

export const STUDIO_BG3D_PROCEDURAL_STARTER_PACK_ID =
  "toonspectrum-bg3d-procedural-starter-v1" as const;
export const STUDIO_BG3D_PROCEDURAL_STARTER_PACK_VERSION = 1 as const;

export const STUDIO_BG3D_PRIMITIVE_TRIANGLE_COUNTS = Object.freeze({
  box: 12,
  cylinder: 64,
  plane: 2,
  sphere: 720,
  hemisphere: 552,
  cone: 48,
  pyramid: 8,
  triangularPrism: 12,
  hexPrism: 24,
  torus: 576,
  tube: 48,
  ring: 64,
  capsule: 544,
} satisfies Record<BgPrimitiveKind, number>);

export type StudioBg3dProceduralStarterCategory =
  | "architecture"
  | "opening"
  | "furniture"
  | "street"
  | "nature";

export const STUDIO_BG3D_PROCEDURAL_STARTER_CATEGORY_LABELS = Object.freeze({
  architecture: "건축 모듈",
  opening: "문·창호",
  furniture: "가구",
  street: "거리",
  nature: "자연",
} satisfies Record<StudioBg3dProceduralStarterCategory, string>);

export interface StudioBg3dProceduralProvenance {
  readonly origin: "original-procedural";
  readonly sourceMethod: "authored-mathematical-primitives";
  readonly author: "ToonSpectrum";
  readonly license: {
    readonly spdx: "CC0-1.0";
    readonly label: "CC0 1.0";
    readonly attributionRequired: false;
    readonly commercialUse: true;
    readonly modificationAllowed: true;
    readonly redistributionAllowed: true;
  };
  readonly derivativeSource: false;
  readonly externalFiles: false;
  readonly externalTextures: false;
}

export interface StudioBg3dProceduralCompatibility {
  readonly renderBackends: readonly ["webgl2", "webgpu"];
  readonly textures: 0;
  readonly externalResources: 0;
  readonly requiresExtensions: false;
  readonly requiresCompute: false;
}

export interface StudioBg3dProceduralBudgetUsage {
  readonly nodes: number;
  readonly triangles: number;
  readonly drawCalls: number;
  readonly materials: number;
  /** Existing scenes may contain imported-model textures; this starter pack always adds zero. */
  readonly textures: number;
}

export interface StudioBg3dProceduralStarterPart {
  readonly id: string;
  readonly name: string;
  readonly kind: BgPrimitiveKind;
  readonly offset: readonly [number, number, number];
  /**
   * All starter parts are authored with X/Z rotation at zero. This lets the lightweight runtime
   * apply an asset yaw by adding it to Euler Y without importing Three.js for quaternion math.
   */
  readonly rotation: readonly [0, number, 0];
  readonly scale: readonly [number, number, number];
  readonly color: string;
}

export interface StudioBg3dProceduralStarterAsset {
  readonly id: string;
  readonly category: StudioBg3dProceduralStarterCategory;
  readonly label: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly bounds: {
    readonly width: number;
    readonly height: number;
    readonly depth: number;
  };
  readonly provenance: StudioBg3dProceduralProvenance;
  readonly compatibility: StudioBg3dProceduralCompatibility;
  readonly budget: StudioBg3dProceduralBudgetUsage;
  readonly parts: readonly StudioBg3dProceduralStarterPart[];
}

interface StarterAssetInput
  extends Omit<
    StudioBg3dProceduralStarterAsset,
    "provenance" | "compatibility" | "budget" | "parts"
  > {
  readonly parts: readonly StudioBg3dProceduralStarterPart[];
}

const PROVENANCE: StudioBg3dProceduralProvenance = Object.freeze({
  origin: "original-procedural",
  sourceMethod: "authored-mathematical-primitives",
  author: "ToonSpectrum",
  license: Object.freeze({
    spdx: "CC0-1.0",
    label: "CC0 1.0",
    attributionRequired: false,
    commercialUse: true,
    modificationAllowed: true,
    redistributionAllowed: true,
  }),
  derivativeSource: false,
  externalFiles: false,
  externalTextures: false,
});

const COMPATIBILITY: StudioBg3dProceduralCompatibility = Object.freeze({
  renderBackends: Object.freeze(["webgl2", "webgpu"] as const),
  textures: 0,
  externalResources: 0,
  requiresExtensions: false,
  requiresCompute: false,
});

function starterPart(
  id: string,
  name: string,
  kind: BgPrimitiveKind,
  offset: readonly [number, number, number],
  scale: readonly [number, number, number],
  color: string,
  yaw = 0,
): StudioBg3dProceduralStarterPart {
  return Object.freeze({
    id,
    name,
    kind,
    offset: Object.freeze([...offset]) as readonly [number, number, number],
    rotation: Object.freeze([0, yaw, 0]) as readonly [0, number, 0],
    scale: Object.freeze([...scale]) as readonly [number, number, number],
    color,
  });
}

export function estimateStudioBg3dProceduralParts(
  parts: readonly Pick<StudioBg3dProceduralStarterPart, "kind">[],
): StudioBg3dProceduralBudgetUsage {
  const primitiveCount = parts.length;
  return Object.freeze({
    nodes: primitiveCount,
    triangles: parts.reduce(
      (total, part) => total + STUDIO_BG3D_PRIMITIVE_TRIANGLE_COUNTS[part.kind],
      0,
    ),
    // The current BG3D viewport renders one shaded mesh plus one line overlay per primitive.
    drawCalls: primitiveCount * 2,
    materials: primitiveCount * 2,
    textures: 0,
  });
}

function defineStarterAsset(input: StarterAssetInput): StudioBg3dProceduralStarterAsset {
  const parts = Object.freeze([...input.parts]);
  return Object.freeze({
    ...input,
    tags: Object.freeze([...input.tags]),
    bounds: Object.freeze({ ...input.bounds }),
    provenance: PROVENANCE,
    compatibility: COMPATIBILITY,
    budget: estimateStudioBg3dProceduralParts(parts),
    parts,
  });
}

function buildStraightStairParts(): readonly StudioBg3dProceduralStarterPart[] {
  return Array.from({ length: 8 }, (_, index) => {
    const height = (index + 1) * 0.2;
    return starterPart(
      `step-${index + 1}`,
      `디딤단 ${index + 1}`,
      "box",
      [0, height / 2, 1.225 - index * 0.35],
      [1.6, height, 0.36],
      "#c8c2b8",
    );
  });
}

function buildCrosswalkParts(): readonly StudioBg3dProceduralStarterPart[] {
  const base = [
    starterPart("road", "차도", "box", [0, -0.06, 0], [5.6, 0.12, 6], "#4a4e54"),
    starterPart("sidewalk-left", "왼쪽 보도", "box", [-3.1, 0.03, 0], [0.6, 0.18, 6], "#aaa59d"),
    starterPart("sidewalk-right", "오른쪽 보도", "box", [3.1, 0.03, 0], [0.6, 0.18, 6], "#aaa59d"),
    starterPart("curb-left", "왼쪽 경계석", "box", [-2.76, 0.08, 0], [0.12, 0.22, 6], "#d8d3ca"),
    starterPart("curb-right", "오른쪽 경계석", "box", [2.76, 0.08, 0], [0.12, 0.22, 6], "#d8d3ca"),
  ];
  const stripes = Array.from({ length: 6 }, (_, index) =>
    starterPart(
      `stripe-${index + 1}`,
      `횡단보도 선 ${index + 1}`,
      "box",
      [0, 0.012, -1.25 + index * 0.5],
      [4.7, 0.025, 0.22],
      "#f2efe6",
    ),
  );
  return [...base, ...stripes];
}

export const STUDIO_BG3D_PROCEDURAL_STARTER_ASSETS = Object.freeze([
  defineStarterAsset({
    id: "ts3d-room-shell-v1",
    category: "architecture",
    label: "오픈 룸 셸",
    description: "카메라 쪽 벽을 비운 바닥·3면 벽 블록아웃",
    tags: ["room", "interior", "open-wall", "방", "실내"],
    bounds: { width: 6, height: 2.8, depth: 5 },
    parts: [
      starterPart("floor", "바닥", "box", [0, -0.08, 0], [6, 0.16, 5], "#b9b1a4"),
      starterPart("back-wall", "뒷벽", "box", [0, 1.4, -2.45], [6, 2.8, 0.1], "#ded8ce"),
      starterPart("left-wall", "왼벽", "box", [-2.95, 1.4, 0], [0.1, 2.8, 5], "#d6d0c7"),
      starterPart("right-wall", "오른벽", "box", [2.95, 1.4, 0], [0.1, 2.8, 5], "#d6d0c7"),
    ],
  }),
  defineStarterAsset({
    id: "ts3d-corridor-module-v1",
    category: "architecture",
    label: "복도 모듈",
    description: "앞뒤로 이어 붙일 수 있는 바닥·천장·양면 벽 모듈",
    tags: ["corridor", "hallway", "modular", "복도", "실내"],
    bounds: { width: 3, height: 2.8, depth: 5 },
    parts: [
      starterPart("floor", "복도 바닥", "box", [0, -0.06, 0], [3, 0.12, 5], "#aaa49a"),
      starterPart("ceiling", "복도 천장", "box", [0, 2.74, 0], [3, 0.12, 5], "#e6e2da"),
      starterPart("left-wall", "왼쪽 벽", "box", [-1.47, 1.35, 0], [0.06, 2.7, 5], "#d8d3ca"),
      starterPart("right-wall", "오른쪽 벽", "box", [1.47, 1.35, 0], [0.06, 2.7, 5], "#d8d3ca"),
      starterPart("left-trim", "왼쪽 걸레받이", "box", [-1.42, 0.1, 0], [0.08, 0.2, 5], "#77736d"),
      starterPart("right-trim", "오른쪽 걸레받이", "box", [1.42, 0.1, 0], [0.08, 0.2, 5], "#77736d"),
    ],
  }),
  defineStarterAsset({
    id: "ts3d-straight-stairs-v1",
    category: "architecture",
    label: "직선 계단",
    description: "8단으로 구성한 저비용 실내 계단 블록아웃",
    tags: ["stairs", "steps", "architecture", "계단", "실내"],
    bounds: { width: 1.6, height: 1.6, depth: 2.8 },
    parts: buildStraightStairParts(),
  }),
  defineStarterAsset({
    id: "ts3d-window-module-v1",
    category: "opening",
    label: "분할 창문",
    description: "프레임·십자 살·불투명 유리판으로 만든 양면 창호",
    tags: ["window", "frame", "opening", "창문", "창호"],
    bounds: { width: 2.2, height: 2.1, depth: 0.1 },
    parts: [
      starterPart("glass", "유리판", "box", [0, 1.25, 0], [1.8, 1.3, 0.025], "#b8d7df"),
      starterPart("frame-left", "왼쪽 프레임", "box", [-1, 1.25, 0], [0.14, 1.6, 0.1], "#565b5f"),
      starterPart("frame-right", "오른쪽 프레임", "box", [1, 1.25, 0], [0.14, 1.6, 0.1], "#565b5f"),
      starterPart("frame-bottom", "아래 프레임", "box", [0, 0.45, 0], [2.14, 0.14, 0.1], "#565b5f"),
      starterPart("frame-top", "위 프레임", "box", [0, 2.05, 0], [2.14, 0.14, 0.1], "#565b5f"),
      starterPart("mullion-vertical", "세로 창살", "box", [0, 1.25, 0.055], [0.08, 1.5, 0.06], "#6a7074"),
      starterPart("mullion-horizontal", "가로 창살", "box", [0, 1.25, 0.055], [1.92, 0.08, 0.06], "#6a7074"),
    ],
  }),
  defineStarterAsset({
    id: "ts3d-door-module-v1",
    category: "opening",
    label: "기본 여닫이문",
    description: "문짝·문틀·손잡이를 독립 파츠로 편집하는 문 모듈",
    tags: ["door", "frame", "opening", "문", "문틀"],
    bounds: { width: 1.2, height: 2.35, depth: 0.14 },
    parts: [
      starterPart("door", "문짝", "box", [0, 1.05, 0], [0.9, 2.1, 0.07], "#896a4d"),
      starterPart("frame-left", "왼쪽 문틀", "box", [-0.53, 1.15, 0], [0.12, 2.3, 0.14], "#4e4135"),
      starterPart("frame-right", "오른쪽 문틀", "box", [0.53, 1.15, 0], [0.12, 2.3, 0.14], "#4e4135"),
      starterPart("frame-top", "위 문틀", "box", [0, 2.27, 0], [1.18, 0.12, 0.14], "#4e4135"),
      starterPart("handle", "문손잡이", "box", [0.32, 1.05, 0.08], [0.16, 0.07, 0.08], "#c8b26a"),
    ],
  }),
  defineStarterAsset({
    id: "ts3d-writing-desk-v1",
    category: "furniture",
    label: "작업 책상",
    description: "상판·다리·가림판을 각각 조절할 수 있는 기본 책상",
    tags: ["desk", "workstation", "furniture", "책상", "가구"],
    bounds: { width: 1.6, height: 0.78, depth: 0.75 },
    parts: [
      starterPart("top", "책상 상판", "box", [0, 0.74, 0], [1.6, 0.08, 0.75], "#a97c52"),
      starterPart("leg-front-left", "앞 왼쪽 다리", "box", [-0.7, 0.36, 0.28], [0.08, 0.72, 0.08], "#4c4b49"),
      starterPart("leg-front-right", "앞 오른쪽 다리", "box", [0.7, 0.36, 0.28], [0.08, 0.72, 0.08], "#4c4b49"),
      starterPart("leg-back-left", "뒤 왼쪽 다리", "box", [-0.7, 0.36, -0.28], [0.08, 0.72, 0.08], "#4c4b49"),
      starterPart("leg-back-right", "뒤 오른쪽 다리", "box", [0.7, 0.36, -0.28], [0.08, 0.72, 0.08], "#4c4b49"),
      starterPart("modesty", "가림판", "box", [0, 0.42, -0.31], [1.34, 0.48, 0.05], "#886443"),
    ],
  }),
  defineStarterAsset({
    id: "ts3d-basic-chair-v1",
    category: "furniture",
    label: "기본 의자",
    description: "좌판·등받이·네 다리로 구성한 가벼운 의자",
    tags: ["chair", "seat", "furniture", "의자", "가구"],
    bounds: { width: 0.55, height: 1, depth: 0.55 },
    parts: [
      starterPart("seat", "좌판", "box", [0, 0.46, 0], [0.55, 0.08, 0.55], "#a97c52"),
      starterPart("leg-front-left", "앞 왼쪽 다리", "box", [-0.22, 0.22, 0.2], [0.06, 0.44, 0.06], "#4c4b49"),
      starterPart("leg-front-right", "앞 오른쪽 다리", "box", [0.22, 0.22, 0.2], [0.06, 0.44, 0.06], "#4c4b49"),
      starterPart("leg-back-left", "뒤 왼쪽 다리", "box", [-0.22, 0.22, -0.2], [0.06, 0.44, 0.06], "#4c4b49"),
      starterPart("leg-back-right", "뒤 오른쪽 다리", "box", [0.22, 0.22, -0.2], [0.06, 0.44, 0.06], "#4c4b49"),
      starterPart("back", "등받이", "box", [0, 0.78, -0.25], [0.55, 0.55, 0.07], "#98704b"),
    ],
  }),
  defineStarterAsset({
    id: "ts3d-shelving-unit-v1",
    category: "furniture",
    label: "오픈 선반",
    description: "등판과 3개 중간 선반을 가진 수납 모듈",
    tags: ["shelf", "storage", "furniture", "선반", "수납"],
    bounds: { width: 1.2, height: 2, depth: 0.4 },
    parts: [
      starterPart("side-left", "왼쪽 옆판", "box", [-0.56, 1, 0], [0.08, 2, 0.4], "#8a694c"),
      starterPart("side-right", "오른쪽 옆판", "box", [0.56, 1, 0], [0.08, 2, 0.4], "#8a694c"),
      starterPart("bottom", "바닥 선반", "box", [0, 0.05, 0], [1.04, 0.1, 0.4], "#9a7655"),
      starterPart("shelf-1", "중간 선반 1", "box", [0, 0.52, 0], [1.04, 0.08, 0.4], "#9a7655"),
      starterPart("shelf-2", "중간 선반 2", "box", [0, 1, 0], [1.04, 0.08, 0.4], "#9a7655"),
      starterPart("shelf-3", "중간 선반 3", "box", [0, 1.48, 0], [1.04, 0.08, 0.4], "#9a7655"),
      starterPart("top", "윗판", "box", [0, 1.95, 0], [1.04, 0.1, 0.4], "#9a7655"),
      starterPart("back", "등판", "box", [0, 1, -0.19], [1.04, 1.9, 0.03], "#795c43"),
    ],
  }),
  defineStarterAsset({
    id: "ts3d-lounge-sofa-v1",
    category: "furniture",
    label: "라운지 소파",
    description: "Blender 가구 팩 디자인을 파츠 편집형으로 재구성한 2인 소파",
    tags: ["sofa", "lounge", "furniture", "소파", "카페", "가구"],
    bounds: { width: 1.8, height: 1.05, depth: 0.82 },
    parts: [
      starterPart("base", "소파 베이스", "box", [0, 0.28, 0], [1.8, 0.28, 0.75], "#206c70"),
      starterPart("back", "등받이", "box", [0, 0.72, -0.3], [1.8, 0.7, 0.18], "#247b7d"),
      starterPart("arm-left", "왼쪽 팔걸이", "box", [-0.82, 0.5, 0], [0.18, 0.52, 0.75], "#1b5b60"),
      starterPart("arm-right", "오른쪽 팔걸이", "box", [0.82, 0.5, 0], [0.18, 0.52, 0.75], "#1b5b60"),
      starterPart("seat-left", "왼쪽 쿠션", "box", [-0.4, 0.51, 0], [0.74, 0.16, 0.62], "#49a2a0"),
      starterPart("seat-right", "오른쪽 쿠션", "box", [0.4, 0.51, 0], [0.74, 0.16, 0.62], "#49a2a0"),
      starterPart("leg-left", "왼쪽 다리", "box", [-0.66, 0.08, 0], [0.11, 0.16, 0.11], "#5a2d17"),
      starterPart("leg-right", "오른쪽 다리", "box", [0.66, 0.08, 0], [0.11, 0.16, 0.11], "#5a2d17"),
    ],
  }),
  defineStarterAsset({
    id: "ts3d-cafe-round-table-v1",
    category: "furniture",
    label: "카페 원형 테이블",
    description: "원형 상판·중앙 기둥·바닥 받침으로 나눈 카페 테이블",
    tags: ["round table", "cafe", "furniture", "원형 테이블", "카페", "가구"],
    bounds: { width: 1.1, height: 0.76, depth: 1.1 },
    parts: [
      starterPart("top", "원형 상판", "cylinder", [0, 0.73, 0], [1.1, 0.06, 1.1], "#a9683c"),
      starterPart("pedestal", "중앙 기둥", "cylinder", [0, 0.37, 0], [0.15, 0.68, 0.15], "#4e545b"),
      starterPart("base", "원형 받침", "cylinder", [0, 0.04, 0], [0.58, 0.08, 0.58], "#626970"),
    ],
  }),
  defineStarterAsset({
    id: "ts3d-magic-rune-altar-v1",
    category: "architecture",
    label: "마법 룬 제단",
    description: "판타지 장면용 계단형 제단과 발광색 룬 코어 블록아웃",
    tags: ["magic", "rune", "altar", "fantasy", "마법", "룬", "제단", "판타지"],
    bounds: { width: 2.6, height: 1.65, depth: 2.6 },
    parts: [
      starterPart("step-low", "아래 제단", "cylinder", [0, 0.14, 0], [2.6, 0.28, 2.6], "#413b52"),
      starterPart("step-mid", "중간 제단", "cylinder", [0, 0.38, 0], [2.05, 0.24, 2.05], "#514966"),
      starterPart("step-top", "위 제단", "cylinder", [0, 0.6, 0], [1.5, 0.22, 1.5], "#64597a"),
      starterPart("core", "룬 코어", "sphere", [0, 1.12, 0], [0.6, 0.6, 0.6], "#4fd6d9"),
      starterPart("pillar-left", "왼쪽 룬 기둥", "hexPrism", [-0.92, 1.04, 0], [0.26, 0.92, 0.26], "#8d744d"),
      starterPart("pillar-right", "오른쪽 룬 기둥", "hexPrism", [0.92, 1.04, 0], [0.26, 0.92, 0.26], "#8d744d"),
    ],
  }),
  defineStarterAsset({
    id: "ts3d-scifi-control-console-v1",
    category: "furniture",
    label: "SF 제어 콘솔",
    description: "우주선·연구소 장면에 쓰는 패널형 제어 콘솔",
    tags: ["scifi", "console", "spaceship", "control", "SF", "우주선", "콘솔", "가구"],
    bounds: { width: 1.8, height: 1.3, depth: 0.82 },
    parts: [
      starterPart("base", "콘솔 하부", "box", [0, 0.36, 0], [1.65, 0.72, 0.72], "#242b35"),
      starterPart("panel", "경사 제어판", "box", [0, 0.88, -0.08], [1.8, 0.12, 0.7], "#3b4552", 0),
      starterPart("screen-main", "메인 화면", "box", [0, 1.13, -0.31], [0.94, 0.48, 0.06], "#42c7c8"),
      starterPart("screen-left", "왼쪽 화면", "box", [-0.64, 1.03, -0.3], [0.3, 0.28, 0.05], "#ef9e36"),
      starterPart("screen-right", "오른쪽 화면", "box", [0.64, 1.03, -0.3], [0.3, 0.28, 0.05], "#69a9ed"),
      starterPart("key-row", "조작 키", "box", [0, 0.92, -0.45], [1.15, 0.06, 0.18], "#cbd2d8"),
    ],
  }),
  defineStarterAsset({
    id: "ts3d-subway-platform-bench-v1",
    category: "street",
    label: "지하철 승강장 벤치",
    description: "금속 좌석과 안내 표지판을 결합한 도시 교통 소품",
    tags: ["subway", "platform", "bench", "station", "지하철", "승강장", "벤치", "거리"],
    bounds: { width: 2.4, height: 1.75, depth: 0.7 },
    parts: [
      starterPart("seat", "벤치 좌석", "box", [0, 0.48, 0], [2.1, 0.1, 0.55], "#437b92"),
      starterPart("back", "벤치 등받이", "box", [0, 0.84, -0.23], [2.1, 0.55, 0.08], "#35677c"),
      starterPart("leg-left", "왼쪽 받침", "box", [-0.78, 0.24, 0], [0.12, 0.48, 0.45], "#4c5258"),
      starterPart("leg-right", "오른쪽 받침", "box", [0.78, 0.24, 0], [0.12, 0.48, 0.45], "#4c5258"),
      starterPart("sign-post", "안내판 기둥", "box", [1.14, 0.88, -0.2], [0.08, 1.75, 0.08], "#555c62"),
      starterPart("sign", "승강장 안내판", "box", [1.14, 1.46, -0.2], [0.52, 0.34, 0.08], "#e6b346"),
    ],
  }),
  defineStarterAsset({
    id: "ts3d-crosswalk-street-v1",
    category: "street",
    label: "횡단보도 거리",
    description: "차도·보도·경계석·횡단보도를 묶은 반복 배치용 거리 모듈",
    tags: ["street", "road", "crosswalk", "거리", "횡단보도"],
    bounds: { width: 6.4, height: 0.2, depth: 6 },
    parts: buildCrosswalkParts(),
  }),
  defineStarterAsset({
    id: "ts3d-archway-v1",
    category: "architecture",
    label: "사각 아치 통로",
    description: "기둥·인방·키스톤으로 만든 출입구 블록아웃",
    tags: ["archway", "entrance", "architecture", "아치", "통로"],
    bounds: { width: 3, height: 3.1, depth: 0.55 },
    parts: [
      starterPart("pillar-left", "왼쪽 기둥", "box", [-1.22, 1.3, 0], [0.55, 2.6, 0.55], "#b7aa96"),
      starterPart("pillar-right", "오른쪽 기둥", "box", [1.22, 1.3, 0], [0.55, 2.6, 0.55], "#b7aa96"),
      starterPart("lintel", "인방", "box", [0, 2.75, 0], [3, 0.55, 0.55], "#c3b7a4"),
      starterPart("keystone", "키스톤", "pyramid", [0, 2.72, 0.3], [0.45, 0.55, 0.22], "#968875", Math.PI),
    ],
  }),
  defineStarterAsset({
    id: "ts3d-faceted-tree-v1",
    category: "nature",
    label: "각진 레이어 나무",
    description: "육각 줄기와 3단 원뿔 수관으로 만든 저폴리 나무",
    tags: ["tree", "low-poly", "nature", "나무", "식생"],
    bounds: { width: 2.2, height: 3.4, depth: 2.2 },
    parts: [
      starterPart("trunk", "나무 줄기", "hexPrism", [0, 0.75, 0], [0.42, 1.5, 0.42], "#755039"),
      starterPart("canopy-low", "아래 수관", "cone", [0, 1.55, 0], [2.2, 1.2, 2.2], "#416f4a"),
      starterPart("canopy-mid", "중간 수관", "cone", [0, 2.15, 0], [1.75, 1.25, 1.75], "#4b7d53"),
      starterPart("canopy-top", "위 수관", "cone", [0, 2.75, 0], [1.25, 1.3, 1.25], "#56885b"),
    ],
  }),
  defineStarterAsset({
    id: "ts3d-faceted-rocks-v1",
    category: "nature",
    label: "각진 바위 군집",
    description: "각뿔과 육각기둥을 비대칭으로 배치한 저폴리 바위 묶음",
    tags: ["rock", "low-poly", "nature", "바위", "지형"],
    bounds: { width: 2.4, height: 1.2, depth: 1.8 },
    parts: [
      starterPart("rock-main", "큰 바위", "hexPrism", [0, 0.45, 0], [1.5, 0.9, 1.2], "#777873", 0.23),
      starterPart("rock-left", "왼쪽 바위", "pyramid", [-0.85, 0.32, 0.28], [0.85, 0.64, 0.75], "#888983", -0.35),
      starterPart("rock-right", "오른쪽 바위", "pyramid", [0.82, 0.28, -0.2], [0.72, 0.56, 0.68], "#676965", 0.52),
      starterPart("rock-front", "앞쪽 자갈", "hexPrism", [0.32, 0.18, 0.72], [0.5, 0.36, 0.55], "#96968f", 0.11),
    ],
  }),
] satisfies readonly StudioBg3dProceduralStarterAsset[]);

const ASSET_BY_ID = new Map(
  STUDIO_BG3D_PROCEDURAL_STARTER_ASSETS.map((asset) => [asset.id, asset] as const),
);

const PACK_BUDGET = STUDIO_BG3D_PROCEDURAL_STARTER_ASSETS.reduce(
  (total, asset) => ({
    nodes: total.nodes + asset.budget.nodes,
    triangles: total.triangles + asset.budget.triangles,
    drawCalls: total.drawCalls + asset.budget.drawCalls,
    materials: total.materials + asset.budget.materials,
    textures: 0 as const,
  }),
  { nodes: 0, triangles: 0, drawCalls: 0, materials: 0, textures: 0 as const },
);

export const STUDIO_BG3D_PROCEDURAL_STARTER_PACK = Object.freeze({
  id: STUDIO_BG3D_PROCEDURAL_STARTER_PACK_ID,
  version: STUDIO_BG3D_PROCEDURAL_STARTER_PACK_VERSION,
  label: "절차형 3D 무료 스타터",
  description: "외부 파일 없이 BG3D 기본 도형만으로 생성되는 오리지널 CC0 모듈",
  provenance: PROVENANCE,
  compatibility: COMPATIBILITY,
  budget: Object.freeze(PACK_BUDGET),
  assets: STUDIO_BG3D_PROCEDURAL_STARTER_ASSETS,
});

export function getStudioBg3dProceduralStarterAsset(
  assetId: string,
): StudioBg3dProceduralStarterAsset | null {
  return ASSET_BY_ID.get(assetId) ?? null;
}

const INSTANCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,47}$/u;
const NODE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,79}$/u;
const MAX_INSTANCE_ATTEMPTS = 9_999;
const MAX_ABSOLUTE_POSITION = 100_000;

function isFinitePosition(
  value: readonly [number, number, number],
): value is readonly [number, number, number] {
  return value.every(
    (component) =>
      Number.isFinite(component) && Math.abs(component) <= MAX_ABSOLUTE_POSITION,
  );
}

function normalizedYaw(value: number): number {
  const twoPi = Math.PI * 2;
  const wrapped = ((value + Math.PI) % twoPi + twoPi) % twoPi - Math.PI;
  return Object.is(wrapped, -0) ? 0 : wrapped;
}

function instanceNodeIds(
  asset: StudioBg3dProceduralStarterAsset,
  instanceId: string,
): readonly string[] | null {
  if (!INSTANCE_ID_PATTERN.test(instanceId)) return null;
  const ids = asset.parts.map((part) => `${instanceId}.${part.id}`);
  return ids.every((id) => NODE_ID_PATTERN.test(id)) ? ids : null;
}

export function resolveStudioBg3dProceduralInstanceId(
  assetId: string,
  occupiedNodeIds: readonly string[],
): string | null {
  const asset = getStudioBg3dProceduralStarterAsset(assetId);
  if (!asset) return null;
  const occupied = new Set(occupiedNodeIds);
  for (let suffix = 1; suffix <= MAX_INSTANCE_ATTEMPTS; suffix += 1) {
    const candidate = `${asset.id}-${suffix}`;
    const ids = instanceNodeIds(asset, candidate);
    if (ids && ids.every((id) => !occupied.has(id))) return candidate;
  }
  return null;
}

function validUsage(value: StudioBg3dProceduralBudgetUsage): boolean {
  return (
    Number.isSafeInteger(value.nodes) &&
    value.nodes >= 0 &&
    Number.isSafeInteger(value.triangles) &&
    value.triangles >= 0 &&
    Number.isSafeInteger(value.drawCalls) &&
    value.drawCalls >= 0 &&
    Number.isSafeInteger(value.materials) &&
    value.materials >= 0 &&
    Number.isSafeInteger(value.textures) &&
    value.textures >= 0
  );
}

function validLimits(
  value: Pick<
    StudioBg3dComplexityBudget,
    "maxNodes" | "maxTriangles" | "maxDrawCalls" | "maxMaterials"
  >,
): boolean {
  return Object.values(value).every(
    (limit) => Number.isSafeInteger(limit) && limit >= 0,
  );
}

export type StudioBg3dProceduralInsertionFailureReason =
  | "unknown-asset"
  | "invalid-instance-id"
  | "instance-id-exhausted"
  | "node-id-collision"
  | "invalid-transform"
  | "invalid-budget"
  | "node-budget-exceeded"
  | "triangle-budget-exceeded"
  | "draw-call-budget-exceeded"
  | "material-budget-exceeded";

export interface StudioBg3dProceduralInsertionRequest {
  readonly assetId: string;
  readonly occupiedNodeIds: readonly string[];
  /** Includes primitives and custom models already admitted to the scene. */
  readonly currentUsage: StudioBg3dProceduralBudgetUsage;
  readonly limits: Pick<
    StudioBg3dComplexityBudget,
    "maxNodes" | "maxTriangles" | "maxDrawCalls" | "maxMaterials"
  >;
  readonly instanceId?: string;
  readonly origin?: readonly [number, number, number];
  readonly yawRadians?: number;
}

export type StudioBg3dProceduralInsertionPlan =
  | {
      readonly ok: true;
      readonly asset: StudioBg3dProceduralStarterAsset;
      readonly instanceId: string;
      readonly primitives: readonly BgPrimitive[];
      readonly nextUsage: StudioBg3dProceduralBudgetUsage;
    }
  | {
      readonly ok: false;
      readonly reason: StudioBg3dProceduralInsertionFailureReason;
    };

/**
 * Fail-closed runtime leaf for adding the starter geometry to a real BG3D scene.
 *
 * Callers supply complete current scene usage (including custom models) and occupied node IDs. The
 * function does not mutate the scene, allocate a renderer object, or silently discard parts.
 */
export function planStudioBg3dProceduralStarterInsertion(
  request: StudioBg3dProceduralInsertionRequest,
): StudioBg3dProceduralInsertionPlan {
  const asset = getStudioBg3dProceduralStarterAsset(request.assetId);
  if (!asset) return { ok: false, reason: "unknown-asset" };
  if (!validUsage(request.currentUsage) || !validLimits(request.limits)) {
    return { ok: false, reason: "invalid-budget" };
  }

  const origin = request.origin ?? [0, 0, 0];
  const yaw = request.yawRadians ?? 0;
  if (!isFinitePosition(origin) || !Number.isFinite(yaw)) {
    return { ok: false, reason: "invalid-transform" };
  }

  const instanceId =
    request.instanceId ??
    resolveStudioBg3dProceduralInstanceId(asset.id, request.occupiedNodeIds);
  if (!instanceId) return { ok: false, reason: "instance-id-exhausted" };
  const nodeIds = instanceNodeIds(asset, instanceId);
  if (!nodeIds) return { ok: false, reason: "invalid-instance-id" };
  const occupied = new Set(request.occupiedNodeIds);
  if (nodeIds.some((id) => occupied.has(id))) {
    return { ok: false, reason: "node-id-collision" };
  }

  const nextUsage: StudioBg3dProceduralBudgetUsage = Object.freeze({
    nodes: request.currentUsage.nodes + asset.budget.nodes,
    triangles: request.currentUsage.triangles + asset.budget.triangles,
    drawCalls: request.currentUsage.drawCalls + asset.budget.drawCalls,
    materials: request.currentUsage.materials + asset.budget.materials,
    textures: request.currentUsage.textures,
  });
  if (!validUsage(nextUsage)) return { ok: false, reason: "invalid-budget" };
  if (nextUsage.nodes > request.limits.maxNodes) {
    return { ok: false, reason: "node-budget-exceeded" };
  }
  if (nextUsage.triangles > request.limits.maxTriangles) {
    return { ok: false, reason: "triangle-budget-exceeded" };
  }
  if (nextUsage.drawCalls > request.limits.maxDrawCalls) {
    return { ok: false, reason: "draw-call-budget-exceeded" };
  }
  if (nextUsage.materials > request.limits.maxMaterials) {
    return { ok: false, reason: "material-budget-exceeded" };
  }

  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const primitives = asset.parts.map((part, index): BgPrimitive => {
    const localX = part.offset[0];
    const localZ = part.offset[2];
    return {
      id: nodeIds[index],
      kind: part.kind,
      position: [
        origin[0] + cos * localX + sin * localZ,
        origin[1] + part.offset[1],
        origin[2] - sin * localX + cos * localZ,
      ],
      rotation: [0, normalizedYaw(part.rotation[1] + yaw), 0],
      scale: [...part.scale],
      color: part.color,
      name: `${asset.label} · ${part.name}`,
      visible: true,
      locked: false,
    };
  });

  return Object.freeze({
    ok: true,
    asset,
    instanceId,
    primitives: Object.freeze(primitives),
    nextUsage,
  });
}
