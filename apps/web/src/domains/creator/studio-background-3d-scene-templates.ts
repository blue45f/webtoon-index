// "3D 배경" 블록아웃 도구의 "씬 템플릿" 카탈로그 — 기존 BgPrimitive 낱개 도형과
// BgCompositePreset(건물 한 채, 나무 한 그루 등 "물체 하나")을 여러 개 미리 정해둔 좌표에 한꺼번에
// 배치해 "교실", "거리", "카페"처럼 이미 완성된 공간을 한 번의 클릭으로 만든다.
//
// 배경(§사용자 피드백): 기존 studio-background-3d-composites.ts는 건물/나무/차량/소품을 "하나씩"
// 배치하는 도구라 반복해서 여러 번 눌러야 겨우 공간처럼 보였다("사실 3d 배경이라곤 하지만 실제로는
// 주변 오브젝트만 추가하는것 같다"). 이 파일은 그 위에 한 겹을 더 얹어 "여러 개의 기존 프리셋/도형을
// 사람이 봐도 자연스러운 배치로 조합한 큰 뭉치"를 정의한다 — 새 지오메트리나 새 프리셋을 만들지
// 않고, PRIMITIVE_DEFS/COMPOSITE_PRESETS를 좌표만 다르게 재사용한다(라이선스/번들크기 영향 없음).
import * as THREE from "three";

import { COMPOSITE_PRESETS } from "./studio-background-3d-composites";
import { uid, type BgPrimitive, type BgPrimitiveKind } from "./studio-background-3d-primitives";

export type BgSceneTemplateCategory = "interior" | "urban" | "nature";

// 이름 앞에 BG_를 붙인 이유: 이 저장소에는 이미 studio-scene-templates.ts(2D 패널-구성 기능, "물체
// 종류"가 아니라 "칸 연출 종류")가 같은 디렉터리에서 정확히 같은 이름(SCENE_TEMPLATES,
// SCENE_TEMPLATE_CATEGORIES)을 export한다 — 지금은 어느 파일도 둘 다 import하지 않아 컴파일이
// 통과하지만, 후속 통합 패스가 StudioBackground3D.tsx에 이 모듈을 들여오다 2D 기능(studio-comipo-*가
// 이미 그 이름들을 쓴다)과 한 파일에서 마주치면 그 즉시 "중복 식별자" 컴파일 에러가 난다. 미리
// 접두사로 구분해 그 지뢰를 없앤다.
export const BG_SCENE_TEMPLATE_CATEGORY_LABELS: Record<BgSceneTemplateCategory, string> = {
  interior: "실내",
  urban: "거리·골목",
  nature: "자연",
};
export const BG_SCENE_TEMPLATE_CATEGORIES = Object.keys(BG_SCENE_TEMPLATE_CATEGORY_LABELS) as BgSceneTemplateCategory[];

// ── 배치 타입 ─────────────────────────────────────────────────────────────
// 씬 템플릿은 두 종류의 "배치 항목"으로 구성된다:
//  - primitive: 벽·바닥·책상 상판처럼 복합 프리셋으로 존재하지 않는 낱개 도형을 절대 좌표로 직접 배치.
//  - composite: 기존 COMPOSITE_PRESETS(건물/나무/차량/소품) 중 하나를 앵커 좌표 + (선택)요(yaw) 회전으로
//    통째로 배치. 프리셋 정의(parts[].offset/rotation)는 그대로 재사용하고 앵커만 더해 세계좌표로 바꾼다.

interface ScenePrimitivePlacement {
  type: "primitive";
  kind: BgPrimitiveKind;
  /** 템플릿-로컬 절대 좌표(앵커 개념 없음 — instantiateSceneTemplate이 필요 시 X만 일괄 이동시킨다). */
  position: [number, number, number];
  rotation: [number, number, number]; // Euler XYZ, 라디안
  scale: [number, number, number];
  color: string;
}

interface SceneCompositePlacement {
  type: "composite";
  /** COMPOSITE_PRESETS[].id 참조. 존재하지 않는 id는 instantiateSceneTemplate이 조용히 건너뛴다
   *  (템플릿 정의 오타 방어 — 형제 프리셋 파일이 리네임돼도 전체 템플릿이 깨지지 않도록). */
  presetId: string;
  /** 프리셋 parts[].offset의 기준이 되는 템플릿-로컬 좌표. */
  anchor: [number, number, number];
  /**
   * 프리셋 전체를 앵커 위치에서 world Y축으로 추가 회전(라디안). 기본 0. 건물처럼 "정면"이 있는
   * 프리셋을 도로 반대편에 놓을 때 앵커 좌우가 아니라 이 필드로 180°(Math.PI) 돌려 정면을 맞춘다.
   * 단순 덧셈이 아니라 THREE.Quaternion 합성을 거친다(§instantiateSceneTemplate 참고) — 지붕처럼
   * 이미 X/Z 축까지 튼 파츠(예: building_house의 triangularPrism)를 회전 합성 없이 rotation[1]에
   * 그냥 더하면 결과가 틀어진다는 걸 node+three.js로 직접 확인했다(아래 rotateComposite 주석 참고).
   */
  yaw?: number;
}

type ScenePlacement = ScenePrimitivePlacement | SceneCompositePlacement;

export interface BgSceneTemplate {
  id: string;
  category: BgSceneTemplateCategory;
  label: string;
  description: string;
  /**
   * 대략적인 바닥 폭(X)·깊이(Z), 미터. 실제 바운딩 계산이 아니라 instantiateSceneTemplate의
   * 반복-추가 간격 계산에만 쓰이는 근사치다(교실 8×7 vs 공원 14×14처럼 템플릿마다 한 자릿수 차이가
   * 나므로, 복합 프리셋의 고정 계수를 그대로 쓰면 큰 템플릿끼리 겹친다).
   */
  footprint: { width: number; depth: number };
  placements: ScenePlacement[];
}

// ── 회전 헬퍼 ─────────────────────────────────────────────────────────────
// composite placement에 yaw가 있을 때만 쓰인다(yaw=0이면 instantiateSceneTemplate이 이 함수들을
// 건너뛰고 원본 offset/rotation을 그대로 복사한다 — 대부분의 배치가 yaw 없이 앵커 이동만 쓴다).

/** offset 벡터를 world Y축 기준 yaw만큼 회전(수평 이동만 바뀌고 높이 y는 불변). */
function rotateOffsetYaw(offset: [number, number, number], yaw: number): [number, number, number] {
  const v = new THREE.Vector3(offset[0], offset[1], offset[2]);
  v.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  return [v.x, v.y, v.z];
}

// 파츠의 기존 rotation(Euler XYZ)에 world yaw를 "그 회전 다음에 적용"하는 순서로 합성한다.
// building_house의 지붕(rotation=[-π/2, 0, π/2])으로 node+three.js에서 직접 검증함:
// yaw=π를 rotation[1]에 단순히 더하면(대안이었던 방법) ry=π가 되지만, 실제 쿼터니언 합성 결과는
// ry=0·rz가 부호만 뒤집힌 (-π/2, 0, -π/2)이었다 — 즉 "그냥 더하기"는 이 파츠에서 명백히 틀린 결과를
// 낳는다. premultiply(qYaw)는 "원래 회전을 적용한 다음 world yaw를 적용"하는 순서와 동일하다(먼저
// 프리셋 저자가 의도한 로컬 자세를 만들고, 그 다음 완성된 오브젝트 전체를 세워둔 자리에서 회전시킨다는
// 뜻) — 그래서 postmultiply가 아니라 premultiply를 쓴다.
function rotateEulerYaw(rotation: [number, number, number], yaw: number): [number, number, number] {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2], "XYZ"));
  const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  q.premultiply(qYaw);
  const out = new THREE.Euler().setFromQuaternion(q, "XYZ");
  return [out.x, out.y, out.z];
}

// ── 반복 유닛 생성 헬퍼(교실 책상열/카페 테이블) ───────────────────────────
// 격자/반복 배치는 하드코딩된 27~30개 항목을 손으로 나열하는 대신 좌표만 받는 작은 팩토리로 만든다
// (교실 3×3=9세트, 카페 테이블 3세트) — 오타로 인한 겹침 위험을 줄이기 위한 선택.

/**
 * 교실 책상 한 세트(상판+몸통+의자). x=열 중심, z=책상 중심(의자는 z보다 뒤쪽 +0.38m).
 * 몸통(body) 높이는 바닥(y=0)에서 상판 밑면까지 정확히 닿도록 역산한 값이다: 상판은 y=0.53 중심·
 * 두께 0.06 → 밑면 y=0.50. 몸통이 여기서 살짝(0.02m) 파묻히도록 높이를 0.52로 잡으면(중심
 * y=0.26) 몸통이 [0, 0.52]를 채워 바닥에 닿고 상판 밑면과도 맞닿는다 — 이 파일의 다른 파츠(창문이
 * 벽에 박히는 정도)와 같은 크기의 임베딩이다. 원래 몸통 높이 0.46(중심 0.23)은 상판 밑면(0.50)에
 * 0.04m 못 미쳐 상판이 허공에 떠 보이는 버그였다(node+three.js Box3로 실측 확인 — §검증 스크립트).
 */
function classroomDesk(x: number, z: number): ScenePrimitivePlacement[] {
  return [
    { type: "primitive", kind: "box", position: [x, 0.53, z], rotation: [0, 0, 0], scale: [0.62, 0.06, 0.42], color: "#c9a876" },
    { type: "primitive", kind: "box", position: [x, 0.26, z - 0.02], rotation: [0, 0, 0], scale: [0.52, 0.52, 0.32], color: "#a9835c" },
    { type: "primitive", kind: "box", position: [x, 0.21, z + 0.38], rotation: [0, 0, 0], scale: [0.36, 0.42, 0.36], color: "#6b4a37" },
  ];
}

/**
 * 카페 원형 테이블 한 세트(상판+다리+의자2). 의자는 chairAxis가 "z"면 앞뒤로, "x"면 좌우로 마주보게.
 *
 * 상판(kind: "cylinder") scale.x/z는 실제 반지름이 아니다 — makeGeometry("cylinder")의 기본
 * 지오메트리가 이미 반지름 0.3(CylinderGeometry(0.3, 0.3, 1, 16))이라, 렌더링되는 실제 반지름은
 * `0.3 * scale.x`다. 의도한 테이블 반지름 0.5m를 얻으려면 scale.x/z = 0.5 / 0.3 ≈ 1.6667이어야
 * 하는데, 원래 값 0.5를 그대로 써서 실제 반지름이 0.15m(지름 30cm)로 렌더링되는 버그가 있었다 —
 * 의자 반폭(0.2m)보다도 작은 "장난감 크기" 테이블이 되고, 아래 chairOffset 계산이 가정한 반지름
 * (0.5)과 실제 렌더 반지름(0.15)이 어긋나 의자가 테이블 가장자리에서 0.35m 떨어져 뜨는 결과였다
 * (node+three.js Box3로 실측 확인 — §검증 스크립트). prop_trashcan 등 이 저장소의 다른 cylinder
 * 파츠는 이미 이 0.3배율을 감안해 값을 골랐다(예: scale.x=0.9 → 실제 반지름 0.27m).
 */
function cafeTable(x: number, z: number, chairAxis: "x" | "z"): ScenePrimitivePlacement[] {
  const tableRadius = 0.5;
  const tableTopScale = tableRadius / 0.3; // cylinder 기본 반지름(0.3)을 역보정 — 위 함수 주석 참고.
  const chairOffset = 0.65; // 테이블 반지름(0.5) + 의자 반폭(0.2) - 0.05(맞닿아 앉은 것처럼 살짝 겹침)
  const chairA: [number, number, number] = chairAxis === "z" ? [x, 0.225, z - chairOffset] : [x - chairOffset, 0.225, z];
  const chairB: [number, number, number] = chairAxis === "z" ? [x, 0.225, z + chairOffset] : [x + chairOffset, 0.225, z];
  return [
    { type: "primitive", kind: "cylinder", position: [x, 0.75, z], rotation: [0, 0, 0], scale: [tableTopScale, 0.05, tableTopScale], color: "#caa876" },
    { type: "primitive", kind: "cylinder", position: [x, 0.375, z], rotation: [0, 0, 0], scale: [0.08, 0.75, 0.08], color: "#3a3a3a" },
    { type: "primitive", kind: "box", position: chairA, rotation: [0, 0, 0], scale: [0.4, 0.45, 0.4], color: "#5c4632" },
    { type: "primitive", kind: "box", position: chairB, rotation: [0, 0, 0], scale: [0.4, 0.45, 0.4], color: "#5c4632" },
  ];
}

// ── 템플릿 카탈로그 ───────────────────────────────────────────────────────

export const BG_SCENE_TEMPLATES: BgSceneTemplate[] = [
  // ── interior ──────────────────────────────────────────────
  {
    id: "classroom",
    category: "interior",
    label: "교실",
    description: "칠판 앞 책상 3×3 · 창문 있는 4면 벽",
    footprint: { width: 8, depth: 7 },
    placements: [
      { type: "primitive", kind: "plane", position: [0, 0, 0], rotation: [-Math.PI / 2, 0, 0], scale: [8, 7, 1], color: "#d9c9a3" },
      { type: "primitive", kind: "box", position: [0, 1.5, -3.5], rotation: [0, 0, 0], scale: [8, 3, 0.15], color: "#f2ead8" },
      { type: "primitive", kind: "box", position: [0, 1.6, -3.42], rotation: [0, 0, 0], scale: [3.4, 1.4, 0.05], color: "#25462c" },
      { type: "primitive", kind: "box", position: [0, 0.28, -2.6], rotation: [0, 0, 0], scale: [1.3, 0.56, 0.6], color: "#8a6b4a" },
      { type: "primitive", kind: "box", position: [-4, 1.5, 0], rotation: [0, 0, 0], scale: [0.15, 3, 7], color: "#f2ead8" },
      { type: "primitive", kind: "box", position: [4, 1.5, 0], rotation: [0, 0, 0], scale: [0.15, 3, 7], color: "#f2ead8" },
      { type: "primitive", kind: "box", position: [3.93, 1.6, -2.2], rotation: [0, 0, 0], scale: [0.06, 1.0, 1.6], color: "#a8cbe0" },
      { type: "primitive", kind: "box", position: [3.93, 1.6, 0], rotation: [0, 0, 0], scale: [0.06, 1.0, 1.6], color: "#a8cbe0" },
      { type: "primitive", kind: "box", position: [3.93, 1.6, 2.2], rotation: [0, 0, 0], scale: [0.06, 1.0, 1.6], color: "#a8cbe0" },
      { type: "primitive", kind: "box", position: [-3.93, 1.6, -2.2], rotation: [0, 0, 0], scale: [0.06, 1.0, 1.6], color: "#a8cbe0" },
      { type: "primitive", kind: "box", position: [-3.93, 1.6, 0], rotation: [0, 0, 0], scale: [0.06, 1.0, 1.6], color: "#a8cbe0" },
      { type: "primitive", kind: "box", position: [-3.93, 1.6, 2.2], rotation: [0, 0, 0], scale: [0.06, 1.0, 1.6], color: "#a8cbe0" },
      ...[-1.8, 0, 1.8].flatMap((x) => [-1.0, 0.4, 1.8].flatMap((z) => classroomDesk(x, z))),
    ],
  },
  {
    id: "cafe",
    category: "interior",
    label: "카페",
    description: "원형 테이블 3개 · 창가 좌석 · 카운터",
    footprint: { width: 6, depth: 5 },
    placements: [
      { type: "primitive", kind: "plane", position: [0, 0, 0], rotation: [-Math.PI / 2, 0, 0], scale: [6, 5, 1], color: "#c9b28a" },
      { type: "primitive", kind: "box", position: [0, 1.4, -2.5], rotation: [0, 0, 0], scale: [6, 2.8, 0.15], color: "#e8dcc8" },
      { type: "primitive", kind: "box", position: [-3, 1.4, 0], rotation: [0, 0, 0], scale: [0.15, 2.8, 5], color: "#e8dcc8" },
      { type: "primitive", kind: "box", position: [-2.93, 1.5, 0], rotation: [0, 0, 0], scale: [0.06, 1.3, 3.0], color: "#bcd9e0" },
      { type: "primitive", kind: "box", position: [1.8, 0.55, -2.2], rotation: [0, 0, 0], scale: [1.6, 1.1, 0.6], color: "#7a5a3c" },
      { type: "primitive", kind: "box", position: [1.8, 1.12, -2.2], rotation: [0, 0, 0], scale: [1.7, 0.06, 0.7], color: "#4a372a" },
      ...cafeTable(-1.7, -1.3, "z"),
      ...cafeTable(-1.7, 0.8, "z"),
      ...cafeTable(0.4, 1.6, "x"),
      { type: "composite", presetId: "bush_round", anchor: [2.3, 0, 2.1] },
    ],
  },

  // ── urban ─────────────────────────────────────────────────
  {
    id: "street_avenue",
    category: "urban",
    label: "거리",
    description: "왕복 도로 · 양옆 건물 4채 · 가로수·가로등·벤치·주차 차량",
    footprint: { width: 14, depth: 13 },
    placements: [
      { type: "primitive", kind: "plane", position: [0, 0, 0], rotation: [-Math.PI / 2, 0, 0], scale: [14, 13, 1], color: "#b9b2a0" },
      { type: "primitive", kind: "plane", position: [0, 0.01, 0], rotation: [-Math.PI / 2, 0, 0], scale: [14, 4, 1], color: "#3f3f3f" },
      { type: "primitive", kind: "box", position: [0, 0.02, 0], rotation: [0, 0, 0], scale: [14, 0.01, 0.12], color: "#e0c840" },
      // 북쪽 열(z=+4.8) — 도로를 바라보도록 정면(+Z 기본향)을 180° 돌려 -Z(도로 쪽)로 맞춘다.
      { type: "composite", presetId: "building_low_shop", anchor: [-4.5, 0, 4.8], yaw: Math.PI },
      { type: "composite", presetId: "building_house", anchor: [2.5, 0, 4.8], yaw: Math.PI },
      // 남쪽 열(z=-4.8) — 기본 정면(+Z)이 이미 도로(북쪽) 방향이라 회전 불필요.
      { type: "composite", presetId: "building_highrise", anchor: [-2, 0, -4.8] },
      { type: "composite", presetId: "building_low_shop", anchor: [4.6, 0, -4.8] },
      // 북쪽 보도(z=2.6)
      { type: "composite", presetId: "prop_streetlamp", anchor: [-4, 0, 2.6] },
      { type: "composite", presetId: "tree_round", anchor: [0, 0, 2.6] },
      { type: "composite", presetId: "prop_streetlamp", anchor: [4, 0, 2.6] },
      // 남쪽 보도(z=-2.6)
      { type: "composite", presetId: "tree_conifer", anchor: [-4, 0, -2.6] },
      { type: "composite", presetId: "prop_streetlamp", anchor: [0, 0, -2.6] },
      { type: "composite", presetId: "prop_bench", anchor: [4, 0, -2.6] },
      // 도로 위 평행 주차 차량 — 기본 정면(+Z, 차체 길이축)을 90° 돌려 도로 방향(X)에 맞춘다.
      { type: "composite", presetId: "vehicle_sedan", anchor: [-1.5, 0, 1.0], yaw: Math.PI / 2 },
    ],
  },
  {
    id: "residential_alley",
    category: "urban",
    label: "골목길",
    description: "좁은 보행로 양옆 주택 4채 · 화단·가로등·쓰레기통",
    footprint: { width: 11, depth: 10 },
    placements: [
      { type: "primitive", kind: "plane", position: [0, 0, 0], rotation: [-Math.PI / 2, 0, 0], scale: [11, 10, 1], color: "#8fae7a" },
      { type: "primitive", kind: "plane", position: [0, 0.01, 0], rotation: [-Math.PI / 2, 0, 0], scale: [11, 2.4, 1], color: "#b0aa9c" },
      // 북쪽 열(z=+3.3) — 골목을 바라보도록 180° 회전.
      { type: "composite", presetId: "building_house", anchor: [-3.5, 0, 3.3], yaw: Math.PI },
      { type: "composite", presetId: "building_low_shop", anchor: [3.0, 0, 3.3], yaw: Math.PI },
      // 남쪽 열(z=-3.3) — 기본 정면이 이미 골목 방향.
      { type: "composite", presetId: "building_house", anchor: [-3.0, 0, -3.3] },
      { type: "composite", presetId: "building_house", anchor: [3.5, 0, -3.3] },
      // 북쪽 화단대(z=1.7)
      { type: "composite", presetId: "bush_round", anchor: [-1.5, 0, 1.7] },
      { type: "composite", presetId: "bush_round", anchor: [1.5, 0, 1.7] },
      { type: "composite", presetId: "prop_streetlamp", anchor: [-4.0, 0, 1.7] },
      { type: "composite", presetId: "prop_trashcan", anchor: [4.0, 0, 1.7] },
      // 남쪽 화단대(z=-1.7)
      { type: "composite", presetId: "bush_round", anchor: [-1.5, 0, -1.7] },
      { type: "composite", presetId: "bush_round", anchor: [1.5, 0, -1.7] },
      { type: "composite", presetId: "prop_trashcan", anchor: [-4.0, 0, -1.7] },
      { type: "composite", presetId: "prop_streetlamp", anchor: [4.0, 0, -1.7] },
    ],
  },

  // ── nature ────────────────────────────────────────────────
  {
    id: "park_plaza",
    category: "nature",
    label: "공원",
    description: "포장 광장 · 나무 6그루 · 벤치·가로등·화단",
    footprint: { width: 14, depth: 14 },
    placements: [
      { type: "primitive", kind: "plane", position: [0, 0, 0], rotation: [-Math.PI / 2, 0, 0], scale: [14, 14, 1], color: "#7fae63" },
      { type: "primitive", kind: "plane", position: [0, 0.01, 0], rotation: [-Math.PI / 2, 0, 0], scale: [6, 6, 1], color: "#c9bfa0" },
      // 나무 6그루 — 사각 링(모서리 4 + 좌우 변 중앙 2), 벤치가 놓일 남/북 변 중앙은 비워둔다.
      { type: "composite", presetId: "tree_round", anchor: [5, 0, 5] },
      { type: "composite", presetId: "tree_conifer", anchor: [-5, 0, 5] },
      { type: "composite", presetId: "tree_round", anchor: [5, 0, -5] },
      { type: "composite", presetId: "tree_conifer", anchor: [-5, 0, -5] },
      { type: "composite", presetId: "tree_conifer", anchor: [5, 0, 0] },
      { type: "composite", presetId: "tree_round", anchor: [-5, 0, 0] },
      // 벤치 — 광장을 바라보도록 배치(북쪽 벤치는 180° 돌려 -Z를 향하게, 남쪽은 기본 +Z가 이미 광장 향).
      { type: "composite", presetId: "prop_bench", anchor: [0, 0, 3.8], yaw: Math.PI },
      { type: "composite", presetId: "prop_bench", anchor: [0, 0, -3.8] },
      // 벤치 옆 화단
      { type: "composite", presetId: "bush_round", anchor: [1.8, 0, 3.2] },
      { type: "composite", presetId: "bush_round", anchor: [-1.8, 0, 3.2] },
      { type: "composite", presetId: "bush_round", anchor: [1.8, 0, -3.2] },
      { type: "composite", presetId: "bush_round", anchor: [-1.8, 0, -3.2] },
      // 광장 모서리 가로등
      { type: "composite", presetId: "prop_streetlamp", anchor: [3.5, 0, 3.5] },
      { type: "composite", presetId: "prop_streetlamp", anchor: [-3.5, 0, 3.5] },
      { type: "composite", presetId: "prop_streetlamp", anchor: [3.5, 0, -3.5] },
      { type: "composite", presetId: "prop_streetlamp", anchor: [-3.5, 0, -3.5] },
    ],
  },
  {
    id: "backyard_garden",
    category: "nature",
    label: "정원",
    description: "잔디 마당 · 화단 경계 · 나무 1그루 · 벤치",
    footprint: { width: 7, depth: 6.5 },
    placements: [
      { type: "primitive", kind: "plane", position: [0, 0, 0], rotation: [-Math.PI / 2, 0, 0], scale: [7, 6.5, 1], color: "#7fae63" },
      { type: "composite", presetId: "tree_round", anchor: [-2.4, 0, -2.0] },
      // 뒤쪽(-Z) 화단 경계
      { type: "composite", presetId: "bush_round", anchor: [-1, 0, -2.3] },
      { type: "composite", presetId: "bush_round", anchor: [0.5, 0, -2.3] },
      { type: "composite", presetId: "bush_round", anchor: [2, 0, -2.3] },
      // 오른쪽(+X) 화단 경계
      { type: "composite", presetId: "bush_round", anchor: [2.8, 0, -1.5] },
      { type: "composite", presetId: "bush_round", anchor: [2.8, 0, 0] },
      { type: "composite", presetId: "bush_round", anchor: [2.8, 0, 1.5] },
      // 마당 안쪽을 바라보는 벤치(-Z 향, 화단 쪽) + 가로등
      { type: "composite", presetId: "prop_bench", anchor: [0, 0, 1.8], yaw: Math.PI },
      { type: "composite", presetId: "prop_streetlamp", anchor: [-2.8, 0, 1.8] },
    ],
  },

  // ── interior (확장) ───────────────────────────────────────
  {
    id: "office",
    category: "interior",
    label: "오피스",
    description: "회의 테이블 · 책상 열 · 창가 뷰",
    footprint: { width: 9, depth: 7 },
    placements: [
      { type: "primitive", kind: "plane", position: [0, 0, 0], rotation: [-Math.PI / 2, 0, 0], scale: [9, 7, 1], color: "#c8c2b4" },
      { type: "primitive", kind: "box", position: [0, 1.5, -3.5], rotation: [0, 0, 0], scale: [9, 3, 0.15], color: "#e8e4dc" },
      { type: "primitive", kind: "box", position: [-4.5, 1.5, 0], rotation: [0, 0, 0], scale: [0.15, 3, 7], color: "#e8e4dc" },
      { type: "primitive", kind: "box", position: [4.5, 1.5, 0], rotation: [0, 0, 0], scale: [0.15, 3, 7], color: "#e8e4dc" },
      { type: "primitive", kind: "box", position: [4.42, 1.6, 0], rotation: [0, 0, 0], scale: [0.06, 1.4, 4.5], color: "#a8cbe0" },
      // 중앙 회의 테이블 (상판 밑면 y=0.71, 다리는 바닥~상판 밀착)
      { type: "primitive", kind: "box", position: [0, 0.75, 0], rotation: [0, 0, 0], scale: [2.4, 0.08, 1.2], color: "#6b5340" },
      { type: "primitive", kind: "box", position: [0, 0.355, 0], rotation: [0, 0, 0], scale: [0.15, 0.71, 0.15], color: "#3a3a3a" },
      { type: "primitive", kind: "box", position: [-0.9, 0.4, 0.95], rotation: [0, 0, 0], scale: [0.45, 0.8, 0.45], color: "#2b3a5e" },
      { type: "primitive", kind: "box", position: [0.9, 0.4, 0.95], rotation: [0, 0, 0], scale: [0.45, 0.8, 0.45], color: "#2b3a5e" },
      { type: "primitive", kind: "box", position: [-0.9, 0.4, -0.95], rotation: [0, 0, 0], scale: [0.45, 0.8, 0.45], color: "#2b3a5e" },
      { type: "primitive", kind: "box", position: [0.9, 0.4, -0.95], rotation: [0, 0, 0], scale: [0.45, 0.8, 0.45], color: "#2b3a5e" },
      // 옆 책상
      { type: "primitive", kind: "box", position: [-3.2, 0.72, 1.5], rotation: [0, 0, 0], scale: [1.4, 0.08, 0.7], color: "#8a7a68" },
      { type: "primitive", kind: "box", position: [-3.2, 0.72, -1.5], rotation: [0, 0, 0], scale: [1.4, 0.08, 0.7], color: "#8a7a68" },
      { type: "composite", presetId: "prop_vending", anchor: [3.6, 0, -2.8] },
      { type: "composite", presetId: "flower_pot", anchor: [3.5, 0, 2.5] },
    ],
  },
  {
    id: "bedroom",
    category: "interior",
    label: "침실",
    description: "침대 · 책상 · 창문 있는 방",
    footprint: { width: 5.5, depth: 5 },
    placements: [
      { type: "primitive", kind: "plane", position: [0, 0, 0], rotation: [-Math.PI / 2, 0, 0], scale: [5.5, 5, 1], color: "#d4c4a8" },
      { type: "primitive", kind: "box", position: [0, 1.4, -2.5], rotation: [0, 0, 0], scale: [5.5, 2.8, 0.12], color: "#f0e6d8" },
      { type: "primitive", kind: "box", position: [-2.75, 1.4, 0], rotation: [0, 0, 0], scale: [0.12, 2.8, 5], color: "#f0e6d8" },
      { type: "primitive", kind: "box", position: [2.75, 1.4, 0], rotation: [0, 0, 0], scale: [0.12, 2.8, 5], color: "#f0e6d8" },
      { type: "primitive", kind: "box", position: [2.68, 1.5, -1.0], rotation: [0, 0, 0], scale: [0.05, 1.2, 1.4], color: "#a8cbe0" },
      // 침대 (프레임·매트리스·헤드보드가 서로 닿도록 높이 정렬)
      { type: "primitive", kind: "box", position: [-1.2, 0.28, 0.4], rotation: [0, 0, 0], scale: [1.8, 0.35, 2.2], color: "#6b4a6a" },
      { type: "primitive", kind: "box", position: [-1.2, 0.52, 0.4], rotation: [0, 0, 0], scale: [1.7, 0.18, 2.1], color: "#e8dce8" },
      // 헤드보드: 프레임 상단(y≈0.455)에 얹히도록 중심 y=0.73 (높이 0.55 → 밑면 0.455)
      { type: "primitive", kind: "box", position: [-1.2, 0.73, -0.72], rotation: [0, 0, 0], scale: [1.7, 0.55, 0.18], color: "#5a3a5a" },
      // 책상
      { type: "primitive", kind: "box", position: [1.5, 0.72, -1.8], rotation: [0, 0, 0], scale: [1.2, 0.08, 0.55], color: "#8a6b4a" },
      { type: "primitive", kind: "box", position: [1.5, 0.36, -1.8], rotation: [0, 0, 0], scale: [0.12, 0.7, 0.12], color: "#5a4632" },
      { type: "primitive", kind: "box", position: [1.5, 0.4, -1.2], rotation: [0, 0, 0], scale: [0.4, 0.8, 0.4], color: "#4a3a2a" },
      { type: "composite", presetId: "flower_pot", anchor: [2.0, 0, 1.8] },
    ],
  },
  {
    id: "hospital_room",
    category: "interior",
    label: "병실",
    description: "병상 · 사이드 테이블 · 커튼 라인",
    footprint: { width: 6, depth: 5 },
    placements: [
      { type: "primitive", kind: "plane", position: [0, 0, 0], rotation: [-Math.PI / 2, 0, 0], scale: [6, 5, 1], color: "#d8e0e4" },
      { type: "primitive", kind: "box", position: [0, 1.4, -2.5], rotation: [0, 0, 0], scale: [6, 2.8, 0.12], color: "#eef4f6" },
      { type: "primitive", kind: "box", position: [-3, 1.4, 0], rotation: [0, 0, 0], scale: [0.12, 2.8, 5], color: "#eef4f6" },
      { type: "primitive", kind: "box", position: [3, 1.4, 0], rotation: [0, 0, 0], scale: [0.12, 2.8, 5], color: "#eef4f6" },
      { type: "primitive", kind: "box", position: [2.93, 1.5, 0], rotation: [0, 0, 0], scale: [0.05, 1.3, 2.5], color: "#b8d4e8" },
      // 병상 (프레임 max y≈0.725, 헤드보드 밑면 맞춤)
      { type: "primitive", kind: "box", position: [-0.8, 0.45, 0], rotation: [0, 0, 0], scale: [1.0, 0.55, 2.2], color: "#f8fafc" },
      { type: "primitive", kind: "box", position: [-0.8, 0.75, 0], rotation: [0, 0, 0], scale: [0.95, 0.1, 2.1], color: "#60a5fa" },
      { type: "primitive", kind: "box", position: [-0.8, 0.9, -1.05], rotation: [0, 0, 0], scale: [0.95, 0.35, 0.12], color: "#e2e8f0" },
      // 사이드 테이블: 상판 밑면 y=0.51, 다리 높이 0.51로 밀착
      { type: "primitive", kind: "box", position: [0.5, 0.55, 0.6], rotation: [0, 0, 0], scale: [0.5, 0.08, 0.5], color: "#94a3b8" },
      { type: "primitive", kind: "cylinder", position: [0.5, 0.255, 0.6], rotation: [0, 0, 0], scale: [0.15, 0.51, 0.15], color: "#64748b" },
      { type: "composite", presetId: "prop_crate", anchor: [2.0, 0, -1.8] },
    ],
  },
  {
    id: "convenience_store",
    category: "interior",
    label: "편의점",
    description: "계산대 · 선반 · 자판기",
    footprint: { width: 7, depth: 5.5 },
    placements: [
      { type: "primitive", kind: "plane", position: [0, 0, 0], rotation: [-Math.PI / 2, 0, 0], scale: [7, 5.5, 1], color: "#c8c8c4" },
      { type: "primitive", kind: "box", position: [0, 1.5, -2.75], rotation: [0, 0, 0], scale: [7, 3, 0.12], color: "#f0f0ec" },
      { type: "primitive", kind: "box", position: [-3.5, 1.5, 0], rotation: [0, 0, 0], scale: [0.12, 3, 5.5], color: "#f0f0ec" },
      { type: "primitive", kind: "box", position: [3.5, 1.5, 0], rotation: [0, 0, 0], scale: [0.12, 3, 5.5], color: "#f0f0ec" },
      // 계산대
      { type: "primitive", kind: "box", position: [0, 0.55, 1.8], rotation: [0, 0, 0], scale: [2.2, 1.1, 0.7], color: "#3a7a5a" },
      // 선반 3줄
      { type: "primitive", kind: "box", position: [-2.4, 1.0, -1.5], rotation: [0, 0, 0], scale: [1.6, 2.0, 0.4], color: "#e8e4d8" },
      { type: "primitive", kind: "box", position: [0, 1.0, -1.5], rotation: [0, 0, 0], scale: [1.6, 2.0, 0.4], color: "#e8e4d8" },
      { type: "primitive", kind: "box", position: [2.4, 1.0, -1.5], rotation: [0, 0, 0], scale: [1.6, 2.0, 0.4], color: "#e8e4d8" },
      { type: "composite", presetId: "prop_vending", anchor: [2.6, 0, 1.5] },
      { type: "composite", presetId: "prop_trashcan", anchor: [-2.8, 0, 2.0] },
    ],
  },

  // ── urban (확장) ──────────────────────────────────────────
  {
    id: "crosswalk",
    category: "urban",
    label: "횡단보도",
    description: "교차로 · 건물 · 신호 소품",
    footprint: { width: 12, depth: 12 },
    placements: [
      { type: "primitive", kind: "plane", position: [0, 0, 0], rotation: [-Math.PI / 2, 0, 0], scale: [12, 12, 1], color: "#3f3f3f" },
      // 보도 두 축이 같은 중심에 겹치지 않도록 살짝 어긋난 높이·오프셋 사용
      { type: "primitive", kind: "plane", position: [0, 0.012, 0], rotation: [-Math.PI / 2, 0, 0], scale: [3.2, 12, 1], color: "#b9b2a0" },
      { type: "primitive", kind: "plane", position: [0, 0.014, 0.01], rotation: [-Math.PI / 2, 0, 0], scale: [12, 3.2, 1], color: "#b9b2a0" },
      // 횡단보도 줄
      ...([-1.2, -0.6, 0, 0.6, 1.2] as const).flatMap((z) => [
        {
          type: "primitive" as const,
          kind: "box" as const,
          position: [0, 0.02, z] as [number, number, number],
          rotation: [0, 0, 0] as [number, number, number],
          scale: [2.8, 0.01, 0.28] as [number, number, number],
          color: "#f0f0f0",
        },
      ]),
      { type: "composite", presetId: "building_highrise", anchor: [-4.5, 0, -4.5] },
      { type: "composite", presetId: "building_apartment", anchor: [4.5, 0, -4.5] },
      { type: "composite", presetId: "building_low_shop", anchor: [-4.5, 0, 4.5], yaw: Math.PI },
      { type: "composite", presetId: "building_low_shop", anchor: [4.5, 0, 4.5], yaw: Math.PI },
      { type: "composite", presetId: "prop_streetlamp", anchor: [-2.2, 0, -2.2] },
      { type: "composite", presetId: "prop_streetlamp", anchor: [2.2, 0, 2.2] },
      { type: "composite", presetId: "prop_traffic_cone", anchor: [1.5, 0, 1.5] },
      { type: "composite", presetId: "vehicle_sedan", anchor: [-1.8, 0, -3.5], yaw: Math.PI / 2 },
    ],
  },
  {
    id: "station_plaza",
    category: "urban",
    label: "역 앞 광장",
    description: "광장 · 빌보드 · 자판기 · 벤치",
    footprint: { width: 12, depth: 10 },
    placements: [
      { type: "primitive", kind: "plane", position: [0, 0, 0], rotation: [-Math.PI / 2, 0, 0], scale: [12, 10, 1], color: "#a8a49c" },
      { type: "composite", presetId: "building_apartment", anchor: [0, 0, -4.2] },
      { type: "composite", presetId: "building_kiosk", anchor: [-3.5, 0, 1.5] },
      { type: "composite", presetId: "prop_billboard", anchor: [4.0, 0, -2.0] },
      { type: "composite", presetId: "prop_vending", anchor: [3.5, 0, 2.5] },
      { type: "composite", presetId: "prop_bench", anchor: [-1.5, 0, 2.8], yaw: Math.PI },
      { type: "composite", presetId: "prop_bench", anchor: [1.0, 0, 2.8], yaw: Math.PI },
      { type: "composite", presetId: "prop_streetlamp", anchor: [-4.5, 0, 0] },
      { type: "composite", presetId: "prop_streetlamp", anchor: [4.5, 0, 0] },
      { type: "composite", presetId: "prop_trashcan", anchor: [0, 0, 3.2] },
      { type: "composite", presetId: "tree_round", anchor: [-4.0, 0, -1.5] },
    ],
  },
  {
    id: "construction_site",
    category: "urban",
    label: "공사장",
    description: "바리케이드 · 드럼 · 크레인 실루엣",
    footprint: { width: 10, depth: 9 },
    placements: [
      { type: "primitive", kind: "plane", position: [0, 0, 0], rotation: [-Math.PI / 2, 0, 0], scale: [10, 9, 1], color: "#8a7a5a" },
      { type: "composite", presetId: "building_warehouse", anchor: [0, 0, -3.2] },
      { type: "composite", presetId: "prop_barrier", anchor: [-3.2, 0, 2.2] },
      { type: "composite", presetId: "prop_barrier", anchor: [0, 0, 2.4] },
      { type: "composite", presetId: "prop_barrier", anchor: [3.2, 0, 2.2] },
      { type: "composite", presetId: "prop_traffic_cone", anchor: [-3.5, 0, 3.5] },
      { type: "composite", presetId: "prop_traffic_cone", anchor: [3.5, 0, 3.5] },
      { type: "composite", presetId: "prop_barrel", anchor: [-3.8, 0, -0.2] },
      { type: "composite", presetId: "prop_crate", anchor: [3.5, 0, -0.3] },
      { type: "composite", presetId: "prop_crate", anchor: [4.3, 0, 0.4] },
      { type: "composite", presetId: "vehicle_truck", anchor: [0.5, 0, 3.9], yaw: Math.PI / 2 },
      // 크레인 실루엣 (창고와 분리)
      { type: "primitive", kind: "cylinder", position: [3.6, 2.5, 0.5], rotation: [0, 0, 0], scale: [0.2, 5.0, 0.2], color: "#e8a020" },
      { type: "primitive", kind: "box", position: [2.1, 4.8, 0.5], rotation: [0, 0, 0], scale: [3.0, 0.15, 0.2], color: "#e8a020" },
    ],
  },

  // ── nature (확장) ─────────────────────────────────────────
  {
    id: "beach",
    category: "nature",
    label: "해변",
    description: "모래 · 바다 평면 · 야자수",
    footprint: { width: 14, depth: 10 },
    placements: [
      { type: "primitive", kind: "plane", position: [0, 0, 1.5], rotation: [-Math.PI / 2, 0, 0], scale: [14, 7, 1], color: "#e8d4a8" },
      { type: "primitive", kind: "plane", position: [0, -0.02, -3.5], rotation: [-Math.PI / 2, 0, 0], scale: [14, 5, 1], color: "#3a8fd4" },
      { type: "composite", presetId: "tree_palm", anchor: [-4.5, 0, 2.5] },
      { type: "composite", presetId: "tree_palm", anchor: [4.0, 0, 3.0] },
      { type: "composite", presetId: "rock_cluster", anchor: [-2, 0, -0.5] },
      { type: "composite", presetId: "prop_bench", anchor: [1.5, 0, 3.5], yaw: Math.PI },
      { type: "composite", presetId: "prop_umbrella", anchor: [0, 0, 2.0] },
      { type: "composite", presetId: "prop_umbrella", anchor: [2.5, 0, 2.8] },
    ],
  },
  {
    id: "forest_path",
    category: "nature",
    label: "숲길",
    description: "나무 터널 · 바위 · 오솔길",
    footprint: { width: 10, depth: 14 },
    placements: [
      { type: "primitive", kind: "plane", position: [0, 0, 0], rotation: [-Math.PI / 2, 0, 0], scale: [10, 14, 1], color: "#5a8a48" },
      { type: "primitive", kind: "plane", position: [0, 0.01, 0], rotation: [-Math.PI / 2, 0, 0], scale: [2.2, 14, 1], color: "#8a7048" },
      { type: "composite", presetId: "tree_round", anchor: [-3.2, 0, -5] },
      { type: "composite", presetId: "tree_conifer", anchor: [3.2, 0, -5] },
      { type: "composite", presetId: "tree_round", anchor: [-3.5, 0, -1] },
      { type: "composite", presetId: "tree_conifer", anchor: [3.0, 0, -1] },
      { type: "composite", presetId: "tree_round", anchor: [-3.0, 0, 3] },
      { type: "composite", presetId: "tree_conifer", anchor: [3.5, 0, 3] },
      { type: "composite", presetId: "tree_dead", anchor: [-2.5, 0, 5.5] },
      { type: "composite", presetId: "rock_cluster", anchor: [2.0, 0, 1.5] },
      { type: "composite", presetId: "bush_round", anchor: [-1.5, 0, 0] },
      { type: "composite", presetId: "bush_round", anchor: [1.5, 0, -2] },
    ],
  },
  {
    id: "shrine_yard",
    category: "nature",
    label: "사당 마당",
    description: "기와 사당 · 생울타리 · 정원수",
    footprint: { width: 10, depth: 9 },
    placements: [
      { type: "primitive", kind: "plane", position: [0, 0, 0], rotation: [-Math.PI / 2, 0, 0], scale: [10, 9, 1], color: "#6a9a58" },
      { type: "primitive", kind: "plane", position: [0, 0.01, 0.5], rotation: [-Math.PI / 2, 0, 0], scale: [4, 5, 1], color: "#b8a88a" },
      { type: "composite", presetId: "building_temple", anchor: [0, 0, -2.5] },
      { type: "composite", presetId: "hedge_row", anchor: [-3.5, 0, 0], yaw: Math.PI / 2 },
      { type: "composite", presetId: "hedge_row", anchor: [3.5, 0, 0], yaw: Math.PI / 2 },
      { type: "composite", presetId: "tree_round", anchor: [-3.5, 0, -2.5] },
      { type: "composite", presetId: "tree_round", anchor: [3.5, 0, -2.5] },
      { type: "composite", presetId: "flower_pot", anchor: [-1.5, 0, 1.5] },
      { type: "composite", presetId: "flower_pot", anchor: [1.5, 0, 1.5] },
      { type: "composite", presetId: "prop_streetlamp", anchor: [-2, 0, 0.5] },
      { type: "composite", presetId: "prop_streetlamp", anchor: [2, 0, 0.5] },
    ],
  },
  {
    id: "rooftop",
    category: "urban",
    label: "옥상",
    description: "난간 · 물탱크 · 도시 배경 실루엣",
    footprint: { width: 8, depth: 8 },
    placements: [
      { type: "primitive", kind: "plane", position: [0, 0, 0], rotation: [-Math.PI / 2, 0, 0], scale: [8, 8, 1], color: "#7a7a78" },
      // 난간
      { type: "primitive", kind: "box", position: [0, 0.55, -4], rotation: [0, 0, 0], scale: [8, 1.1, 0.12], color: "#c8c8c4" },
      { type: "primitive", kind: "box", position: [0, 0.55, 4], rotation: [0, 0, 0], scale: [8, 1.1, 0.12], color: "#c8c8c4" },
      { type: "primitive", kind: "box", position: [-4, 0.55, 0], rotation: [0, 0, 0], scale: [0.12, 1.1, 8], color: "#c8c8c4" },
      { type: "primitive", kind: "box", position: [4, 0.55, 0], rotation: [0, 0, 0], scale: [0.12, 1.1, 8], color: "#c8c8c4" },
      { type: "composite", presetId: "prop_barrel", anchor: [-2.5, 0, -2.5] },
      { type: "composite", presetId: "prop_barrel", anchor: [-1.8, 0, -2.5] },
      { type: "composite", presetId: "prop_crate", anchor: [2.5, 0, -2.8] },
      { type: "composite", presetId: "prop_bench", anchor: [0, 0, 2.5], yaw: Math.PI },
      { type: "composite", presetId: "prop_streetlamp", anchor: [3.2, 0, 3.2] },
      { type: "primitive", kind: "cylinder", position: [2.5, 0.9, 2.0], rotation: [0, 0, 0], scale: [1.4, 1.8, 1.4], color: "#8a9aa8" },
    ],
  },
  {
    id: "ancient_palace",
    category: "nature",
    label: "고풍 전통 궁궐 사당",
    description: "목재 마루 · 전통 경사지붕 단독주택 · 가로수 정원",
    footprint: { width: 10, depth: 10 },
    placements: [
      { type: "primitive", kind: "plane", position: [0, 0, 0], rotation: [-Math.PI / 2, 0, 0], scale: [10, 10, 1], color: "#8c6d48" },
      { type: "composite", presetId: "building_house", anchor: [0, 0, -3.2] },
      { type: "composite", presetId: "tree_round", anchor: [-3.5, 0, 2.2] },
      { type: "composite", presetId: "tree_round", anchor: [3.5, 0, 2.2] },
    ],
  },
  {
    id: "modern_hospital_room",
    category: "interior",
    label: "모던 병원 진료실",
    description: "화이트 타일 · 진료 의자 · 병상 파티션",
    footprint: { width: 8, depth: 8 },
    placements: [
      { type: "primitive", kind: "plane", position: [0, 0, 0], rotation: [-Math.PI / 2, 0, 0], scale: [8, 8, 1], color: "#e2e8f0" },
      { type: "composite", presetId: "prop_table_set", anchor: [0, 0, -2.2] },
      { type: "composite", presetId: "flower_pot", anchor: [2.5, 0, -2.2] },
    ],
  },
  {
    id: "post_apocalyptic_ruins",
    category: "urban",
    label: "폐허 아포칼립스 거점",
    description: "파괴된 콘크리트 바닥 · 드럼통 벙커 · 난로",
    footprint: { width: 9, depth: 9 },
    placements: [
      { type: "primitive", kind: "plane", position: [0, 0, 0], rotation: [-Math.PI / 2, 0, 0], scale: [9, 9, 1], color: "#475569" },
      { type: "composite", presetId: "building_low_shop", anchor: [0, 0, -3.5] },
      { type: "composite", presetId: "prop_barrel", anchor: [-2.5, 0, 1.8] },
      { type: "composite", presetId: "prop_crate", anchor: [-1.6, 0, 1.8] },
      { type: "composite", presetId: "prop_streetlamp", anchor: [3.2, 0, 1.8] },
    ],
  },
  {
    id: "magical_academy_classroom",
    category: "interior",
    label: "마법 아카데미 강당 교실",
    description: "중세 강당 마루 · 서가 배치 · 강단 데스크",
    footprint: { width: 10, depth: 10 },
    placements: [
      { type: "primitive", kind: "plane", position: [0, 0, 0], rotation: [-Math.PI / 2, 0, 0], scale: [10, 10, 1], color: "#64748b" },
      { type: "composite", presetId: "building_house", anchor: [0, 0, -3.6] },
      { type: "composite", presetId: "prop_table_set", anchor: [-2.2, 0, 1.8] },
      { type: "composite", presetId: "prop_table_set", anchor: [2.2, 0, 1.8] },
    ],
  },
  {
    id: "space_station_bridge",
    category: "urban",
    label: "SF 우주선 함교",
    description: "메탈릭 덱 · 제어 콘솔 · 아크 윈도우",
    footprint: { width: 11, depth: 11 },
    placements: [
      { type: "primitive", kind: "plane", position: [0, 0, 0], rotation: [-Math.PI / 2, 0, 0], scale: [11, 11, 1], color: "#1e293b" },
      { type: "composite", presetId: "building_tower", anchor: [0, 0, -4.2] },
      { type: "composite", presetId: "prop_vending", anchor: [-3.8, 0, -2.5] },
      { type: "composite", presetId: "prop_streetlamp", anchor: [3.8, 0, -2.5] },
    ],
  },
  {
    id: "fantasy_dungeon_hall",
    category: "nature",
    label: "판타지 던전 알현실",
    description: "돌 마루 석조 기둥 · 횃불 다이 · 중앙 알현 단상",
    footprint: { width: 12, depth: 12 },
    placements: [
      { type: "primitive", kind: "plane", position: [0, 0, 0], rotation: [-Math.PI / 2, 0, 0], scale: [12, 12, 1], color: "#334155" },
      { type: "composite", presetId: "building_temple", anchor: [0, 0, -4.5] },
      { type: "composite", presetId: "rock_cluster", anchor: [-4.2, 0, -2.5] },
      { type: "composite", presetId: "rock_cluster", anchor: [4.2, 0, -2.5] },
    ],
  },
  {
    id: "fantasy_tavern",
    category: "interior",
    label: "목재 주점",
    description: "목재 바닥 · 테이블 좌석 · 술통 · 벽 랜턴",
    footprint: { width: 8, depth: 8 },
    placements: [
      { type: "primitive", kind: "plane", position: [0, 0, 0], rotation: [-Math.PI / 2, 0, 0], scale: [8, 8, 1], color: "#4a3525" },
      { type: "primitive", kind: "box", position: [0, 1.5, -4], rotation: [0, 0, 0], scale: [8, 3, 0.2], color: "#382618" },
      { type: "primitive", kind: "box", position: [-4, 1.5, 0], rotation: [0, 0, 0], scale: [0.2, 3, 8], color: "#382618" },
      { type: "composite", presetId: "prop_table_set", anchor: [-2, 0, -1.5] },
      { type: "composite", presetId: "prop_table_set", anchor: [2, 0, -1.5] },
      { type: "composite", presetId: "prop_barrel", anchor: [-3.2, 0, -3.2] },
      { type: "composite", presetId: "prop_barrel", anchor: [-2.5, 0, -3.2] },
      { type: "composite", presetId: "prop_crate", anchor: [3, 0, -3.2] },
      { type: "composite", presetId: "prop_lantern", anchor: [0, 0, -3.8] },
    ],
  },
];

// ── 전개 함수 ─────────────────────────────────────────────────────────────

/**
 * 씬 템플릿을 실제 BgPrimitive[]로 전개한다. instantiateCompositePreset과 같은
 * "existingCount 기반 결정적 오프셋" 철학을 잇되, 씬 템플릿 하나가 이미 개별 복합 프리셋보다
 * 한 자릿수 이상 크기 때문에(교실 8m 폭 vs 가로등 0.4m) 계수를 footprint.width에 비례시킨다.
 * 반복 추가마다 existingCount(보통 primitives.length)가 이전 템플릿의 파츠 수만큼 커지므로,
 * anchorX 증가폭이 어떤 단일 템플릿의 폭보다도 항상 크게 유지돼(§아래 계산) 실질적으로 겹치지 않는다.
 */
export function instantiateSceneTemplate(template: BgSceneTemplate, existingCount: number): BgPrimitive[] {
  const anchorX = existingCount > 0 ? existingCount * (template.footprint.width / 6) : 0;
  const out: BgPrimitive[] = [];

  for (const placement of template.placements) {
    if (placement.type === "primitive") {
      out.push({
        id: uid(),
        kind: placement.kind,
        position: [placement.position[0] + anchorX, placement.position[1], placement.position[2]],
        rotation: [...placement.rotation],
        scale: [...placement.scale],
        color: placement.color,
      });
      continue;
    }

    const preset = COMPOSITE_PRESETS.find((p) => p.id === placement.presetId);
    if (!preset) continue; // 알 수 없는 프리셋 id는 조용히 건너뜀 — 템플릿 정의 오타로 전체가 깨지지 않도록.

    const yaw = placement.yaw ?? 0;
    for (const part of preset.parts) {
      const worldOffset = yaw === 0 ? part.offset : rotateOffsetYaw(part.offset, yaw);
      const worldRotation = yaw === 0 ? part.rotation : rotateEulerYaw(part.rotation, yaw);
      out.push({
        id: uid(),
        kind: part.kind,
        position: [
          placement.anchor[0] + worldOffset[0] + anchorX,
          placement.anchor[1] + worldOffset[1],
          placement.anchor[2] + worldOffset[2],
        ],
        rotation: worldRotation,
        scale: [...part.scale],
        color: part.color,
      });
    }
  }

  return out;
}
