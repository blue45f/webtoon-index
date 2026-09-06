// "3D 배경" 블록아웃 도구의 복합 오브젝트 프리셋 — 건물/나무/차량/소품처럼 여러 BgPrimitive가
// 상대 위치로 조합된 형태를 코드로 합성한다. 외부 glTF 에셋 없이 기존 PRIMITIVE_DEFS의 13종
// 지오메트리만 재사용(studio-background-3d-primitives.ts §makeGeometry 확장 없음) — 라이선스/
// 파일크기 리스크를 피하기 위한 설계 결정.
import { uid, type BgPrimitive, type BgPrimitiveKind } from "./studio-background-3d-primitives";

export type BgCompositeCategory = "building" | "nature" | "vehicle" | "prop";

export const COMPOSITE_CATEGORY_LABELS: Record<BgCompositeCategory, string> = {
  building: "건물",
  nature: "자연",
  vehicle: "차량",
  prop: "소품",
};
export const COMPOSITE_CATEGORIES = Object.keys(COMPOSITE_CATEGORY_LABELS) as BgCompositeCategory[];

interface BgCompositePart {
  kind: BgPrimitiveKind;
  offset: [number, number, number]; // 앵커(0,0,0) 기준 상대 위치, 미터
  rotation: [number, number, number]; // Euler XYZ, 라디안 — BgPrimitive와 동일 계약
  scale: [number, number, number];
  color: string;
}

export interface BgCompositePreset {
  id: string;
  category: BgCompositeCategory;
  label: string;
  description: string;
  /**
   * 대략적인 바닥 반경(m). instantiateCompositePreset의 반복-추가 간격 계산에만 쓰이는 근사치이며
   * 실제 바운딩 계산이 아니다(가로등 0.4 vs 버스 2.0처럼 프리셋마다 크게 달라, createPrimitive의
   * 고정 0.8m 간격을 그대로 재사용하면 큰 오브젝트끼리 겹친다 — 그래서 이 필드를 추가함).
   */
  footprint: number;
  /**
   * parts[0]는 관례상 "앵커 파츠"(본체/몸통/줄기)다. 두 곳에서 쓰인다:
   * (1) instantiateCompositePreset 결과의 result[0].id가 곧 새로 선택될 프리미티브가 된다(단일
   *     addPrimitive와 동일하게 "방금 추가한 것 = 선택됨" UX 유지),
   * (2) 피커 그리드의 색상 스와치 미리보기가 parts[0].color를 사용한다.
   */
  parts: BgCompositePart[];
}

export const COMPOSITE_PRESETS: BgCompositePreset[] = [
  // ── building ──────────────────────────────────────────────
  {
    id: "building_low_shop",
    category: "building",
    label: "저층 상가건물",
    description: "1~2층 스트리트 상가",
    footprint: 2.2,
    parts: [
      { kind: "box", offset: [0, 1.1, 0], rotation: [0, 0, 0], scale: [3.4, 2.2, 2.2], color: "#d8cdb8" },
      { kind: "box", offset: [-1.0, 1.3, 1.11], rotation: [0, 0, 0], scale: [0.6, 0.6, 0.05], color: "#8fb8c9" },
      { kind: "box", offset: [0, 1.3, 1.11], rotation: [0, 0, 0], scale: [0.6, 0.6, 0.05], color: "#8fb8c9" },
      { kind: "box", offset: [1.0, 1.3, 1.11], rotation: [0, 0, 0], scale: [0.6, 0.6, 0.05], color: "#8fb8c9" },
      { kind: "box", offset: [0, 2.25, 0], rotation: [0, 0, 0], scale: [3.6, 0.12, 2.4], color: "#5c5347" },
    ],
  },
  {
    id: "building_house",
    category: "building",
    label: "경사지붕 단독주택",
    description: "박공지붕이 있는 단층 주택",
    footprint: 2.0,
    parts: [
      { kind: "box", offset: [0, 1.0, 0], rotation: [0, 0, 0], scale: [2.6, 2.0, 2.2], color: "#e3d9c4" },
      // triangularPrism(radialSegments=3 원기둥)의 세 꼭짓점은 로컬 (X=0,Z=+r) / (X=±0.87r,Z=-0.5r)에
      // 있다 — "뾰족한 꼭짓점"은 로컬 Z축 방향이지 X축이 아니다. Z축 회전은 X·Y만 섞고 Z는 그대로
      // 두므로, z축 90°만 주면(리뷰에서 발견된 버그) 꼭짓점이 계속 Z방향을 가리켜 위로 세워지지 않고
      // 벽면 쪽으로 삐져나온 비대칭 쐐기 모양이 된다(node+three.js로 world-space 정점 직접 계산해
      // 확인함). X축 -90° 회전으로 Z(꼭짓점 방향)→Y(위) 매핑을 만들고, 이어서 Z축 90° 회전으로
      // Y(원래 압출축)→X(용마루 방향, 건물 폭과 정렬)를 만들어야 apex-up 지붕이 나온다. 이 offset/
      // scale 조합에서는 밑변이 정확히 몸체 상단(y=2.0)에 맞닿고 꼭짓점은 y=3.2. scale.x(2.8)=지붕
      // 깊이 방향 처마 폭(±1.21, 벽 z=±1.1보다 넓게 오버행), scale.y(2.9)=용마루 길이(벽 x=±1.3보다
      // 넓게 오버행), scale.z(1.6)=지붕 물매 높이(밑변 대비 +1.2).
      {
        kind: "triangularPrism",
        offset: [0, 2.4, 0],
        rotation: [-Math.PI / 2, 0, Math.PI / 2],
        scale: [2.8, 2.9, 1.6],
        color: "#8a4a3a",
      },
      { kind: "box", offset: [0, 0.5, 1.11], rotation: [0, 0, 0], scale: [0.6, 1.0, 0.05], color: "#6b4a37" },
      { kind: "box", offset: [-0.85, 1.15, 1.11], rotation: [0, 0, 0], scale: [0.55, 0.55, 0.05], color: "#a8cbe0" },
      { kind: "box", offset: [0.85, 1.15, 1.11], rotation: [0, 0, 0], scale: [0.55, 0.55, 0.05], color: "#a8cbe0" },
    ],
  },
  {
    id: "building_highrise",
    category: "building",
    label: "고층 오피스",
    description: "유리 파사드 고층 빌딩",
    footprint: 2.4,
    parts: [
      { kind: "box", offset: [0, 4.0, 0], rotation: [0, 0, 0], scale: [3.0, 8.0, 3.0], color: "#9fb0bf" },
      { kind: "box", offset: [0, 8.35, 0], rotation: [0, 0, 0], scale: [1.2, 0.7, 1.2], color: "#6b7480" },
      { kind: "cylinder", offset: [0, 9.0, 0], rotation: [0, 0, 0], scale: [0.06, 1.2, 0.06], color: "#333333" },
    ],
  },

  // ── nature ────────────────────────────────────────────────
  {
    id: "tree_round",
    category: "nature",
    label: "가로수(활엽수)",
    description: "둥근 캐노피 3덩이",
    footprint: 0.9,
    parts: [
      { kind: "cylinder", offset: [0, 0.75, 0], rotation: [0, 0, 0], scale: [0.5, 1.5, 0.5], color: "#6b4a35" },
      { kind: "sphere", offset: [0, 2.1, 0], rotation: [0, 0, 0], scale: [1.6, 1.4, 1.6], color: "#4f8f52" },
      { kind: "sphere", offset: [0.5, 1.9, 0.3], rotation: [0, 0, 0], scale: [1.0, 0.9, 1.0], color: "#5a9a5d" },
      { kind: "sphere", offset: [-0.45, 1.85, -0.35], rotation: [0, 0, 0], scale: [0.95, 0.85, 0.95], color: "#437f47" },
    ],
  },
  {
    id: "tree_conifer",
    category: "nature",
    label: "소나무(침엽수)",
    description: "층진 원뿔형 상록수",
    footprint: 0.7,
    parts: [
      { kind: "cylinder", offset: [0, 0.4, 0], rotation: [0, 0, 0], scale: [0.35, 0.8, 0.35], color: "#5a4230" },
      { kind: "cone", offset: [0, 1.55, 0], rotation: [0, 0, 0], scale: [1.1, 1.3, 1.1], color: "#2f6b45" },
      { kind: "cone", offset: [0, 1.05, 0], rotation: [0, 0, 0], scale: [1.5, 1.4, 1.5], color: "#356f49" },
      { kind: "cone", offset: [0, 0.65, 0], rotation: [0, 0, 0], scale: [1.9, 1.3, 1.9], color: "#3a7a4e" },
    ],
  },
  {
    id: "bush_round",
    category: "nature",
    label: "화단 관목",
    description: "낮은 둥근 덤불",
    footprint: 0.5,
    parts: [
      { kind: "sphere", offset: [0, 0.35, 0], rotation: [0, 0, 0], scale: [1.1, 0.7, 1.1], color: "#5a9a5d" },
      { kind: "sphere", offset: [0.35, 0.3, 0.2], rotation: [0, 0, 0], scale: [0.7, 0.55, 0.7], color: "#4f8f52" },
      { kind: "sphere", offset: [-0.3, 0.28, -0.25], rotation: [0, 0, 0], scale: [0.65, 0.5, 0.65], color: "#63a666" },
    ],
  },

  // ── vehicle ───────────────────────────────────────────────
  {
    id: "vehicle_sedan",
    category: "vehicle",
    label: "세단",
    description: "승용차 (본체+캐빈+바퀴4)",
    footprint: 1.3,
    parts: [
      { kind: "box", offset: [0, 0.4, 0], rotation: [0, 0, 0], scale: [1.05, 0.55, 2.0], color: "#8a3f3f" },
      { kind: "box", offset: [0, 0.78, -0.1], rotation: [0, 0, 0], scale: [0.85, 0.42, 1.05], color: "#6f3232" },
      // 바퀴: cylinder는 기본적으로 Y축이 회전축이라 z축 90°로 눕혀야 좌우 축(X)에 걸리는 원판이 된다.
      {
        kind: "cylinder",
        offset: [0.6, 0.26, 0.72],
        rotation: [0, 0, Math.PI / 2],
        scale: [0.85, 0.22, 0.85],
        color: "#1c1c1c",
      },
      {
        kind: "cylinder",
        offset: [-0.6, 0.26, 0.72],
        rotation: [0, 0, Math.PI / 2],
        scale: [0.85, 0.22, 0.85],
        color: "#1c1c1c",
      },
      {
        kind: "cylinder",
        offset: [0.6, 0.26, -0.72],
        rotation: [0, 0, Math.PI / 2],
        scale: [0.85, 0.22, 0.85],
        color: "#1c1c1c",
      },
      {
        kind: "cylinder",
        offset: [-0.6, 0.26, -0.72],
        rotation: [0, 0, Math.PI / 2],
        scale: [0.85, 0.22, 0.85],
        color: "#1c1c1c",
      },
    ],
  },
  {
    id: "prop_streetlamp",
    category: "prop",
    label: "가로등",
    description: "기둥+팔+등",
    footprint: 0.4,
    parts: [
      { kind: "cylinder", offset: [0, 1.6, 0], rotation: [0, 0, 0], scale: [0.12, 3.2, 0.12], color: "#3a3a3a" },
      { kind: "box", offset: [0.35, 3.05, 0], rotation: [0, 0, 0], scale: [0.7, 0.08, 0.08], color: "#3a3a3a" },
      { kind: "sphere", offset: [0.68, 2.95, 0], rotation: [0, 0, 0], scale: [0.32, 0.32, 0.32], color: "#ffe9a8" },
    ],
  },
  {
    id: "prop_bench",
    category: "prop",
    label: "벤치",
    description: "좌석+등받이+다리2",
    footprint: 0.6,
    parts: [
      { kind: "box", offset: [0, 0.42, 0], rotation: [0, 0, 0], scale: [1.6, 0.08, 0.5], color: "#8a6b4a" },
      { kind: "box", offset: [0, 0.72, -0.21], rotation: [-0.17, 0, 0], scale: [1.6, 0.5, 0.08], color: "#8a6b4a" },
      { kind: "box", offset: [-0.65, 0.21, 0], rotation: [0, 0, 0], scale: [0.08, 0.42, 0.46], color: "#3a3a3a" },
      { kind: "box", offset: [0.65, 0.21, 0], rotation: [0, 0, 0], scale: [0.08, 0.42, 0.46], color: "#3a3a3a" },
    ],
  },
  {
    id: "prop_sign",
    category: "prop",
    label: "간판/표지판",
    description: "기둥+판",
    footprint: 0.3,
    parts: [
      { kind: "cylinder", offset: [0, 1.0, 0], rotation: [0, 0, 0], scale: [0.08, 2.0, 0.08], color: "#3a3a3a" },
      { kind: "box", offset: [0, 1.95, 0], rotation: [0, 0, 0], scale: [0.9, 0.6, 0.06], color: "#d64545" },
    ],
  },
  {
    id: "prop_trashcan",
    category: "prop",
    label: "쓰레기통",
    description: "몸통+뚜껑",
    footprint: 0.3,
    parts: [
      { kind: "cylinder", offset: [0, 0.45, 0], rotation: [0, 0, 0], scale: [0.9, 0.9, 0.9], color: "#4a6b4a" },
      { kind: "cylinder", offset: [0, 0.92, 0], rotation: [0, 0, 0], scale: [0.95, 0.08, 0.95], color: "#2f4a2f" },
    ],
  },

  // ── building (확장) ───────────────────────────────────────
  {
    id: "building_apartment",
    category: "building",
    label: "아파트 동",
    description: "중층 주거 블록",
    footprint: 2.6,
    parts: [
      { kind: "box", offset: [0, 3.2, 0], rotation: [0, 0, 0], scale: [4.2, 6.4, 2.8], color: "#c9b8a4" },
      { kind: "box", offset: [0, 6.5, 0], rotation: [0, 0, 0], scale: [4.4, 0.2, 3.0], color: "#8a7a68" },
      { kind: "box", offset: [-1.2, 2.2, 1.42], rotation: [0, 0, 0], scale: [0.7, 0.7, 0.05], color: "#9ec5d8" },
      { kind: "box", offset: [0.2, 2.2, 1.42], rotation: [0, 0, 0], scale: [0.7, 0.7, 0.05], color: "#9ec5d8" },
      { kind: "box", offset: [1.4, 2.2, 1.42], rotation: [0, 0, 0], scale: [0.55, 0.7, 0.05], color: "#9ec5d8" },
      { kind: "box", offset: [-1.2, 4.0, 1.42], rotation: [0, 0, 0], scale: [0.7, 0.7, 0.05], color: "#9ec5d8" },
      { kind: "box", offset: [0.2, 4.0, 1.42], rotation: [0, 0, 0], scale: [0.7, 0.7, 0.05], color: "#9ec5d8" },
      { kind: "box", offset: [1.4, 4.0, 1.42], rotation: [0, 0, 0], scale: [0.55, 0.7, 0.05], color: "#9ec5d8" },
    ],
  },
  {
    id: "building_temple",
    category: "building",
    label: "기와 사당",
    description: "단층 동양풍 건물",
    footprint: 2.2,
    parts: [
      { kind: "box", offset: [0, 1.0, 0], rotation: [0, 0, 0], scale: [3.0, 2.0, 2.4], color: "#e8dcc4" },
      {
        kind: "triangularPrism",
        offset: [0, 2.35, 0],
        rotation: [-Math.PI / 2, 0, Math.PI / 2],
        scale: [3.2, 3.4, 1.4],
        color: "#5c2e2e",
      },
      { kind: "box", offset: [0, 0.55, 1.22], rotation: [0, 0, 0], scale: [0.7, 1.1, 0.06], color: "#6b3b2a" },
      { kind: "cylinder", offset: [-1.3, 1.0, 1.0], rotation: [0, 0, 0], scale: [0.18, 2.0, 0.18], color: "#7a4a32" },
      { kind: "cylinder", offset: [1.3, 1.0, 1.0], rotation: [0, 0, 0], scale: [0.18, 2.0, 0.18], color: "#7a4a32" },
    ],
  },
  {
    id: "building_warehouse",
    category: "building",
    label: "창고",
    description: "박스형 산업 건물",
    footprint: 2.4,
    parts: [
      { kind: "box", offset: [0, 1.5, 0], rotation: [0, 0, 0], scale: [4.0, 3.0, 3.2], color: "#8a9098" },
      { kind: "box", offset: [0, 3.1, 0], rotation: [0, 0, 0], scale: [4.2, 0.15, 3.4], color: "#5c6168" },
      { kind: "box", offset: [0, 1.0, 1.62], rotation: [0, 0, 0], scale: [1.4, 2.0, 0.08], color: "#4a4f55" },
      { kind: "box", offset: [-1.4, 2.0, 1.62], rotation: [0, 0, 0], scale: [0.8, 0.6, 0.05], color: "#7a8894" },
    ],
  },
  {
    id: "building_tower",
    category: "building",
    label: "전망 타워",
    description: "원기둥 타워 + 관측 캡",
    footprint: 1.4,
    parts: [
      { kind: "cylinder", offset: [0, 3.5, 0], rotation: [0, 0, 0], scale: [1.2, 7.0, 1.2], color: "#b0b8c0" },
      { kind: "cylinder", offset: [0, 7.2, 0], rotation: [0, 0, 0], scale: [2.2, 0.6, 2.2], color: "#8a949e" },
      { kind: "sphere", offset: [0, 7.7, 0], rotation: [0, 0, 0], scale: [1.4, 0.9, 1.4], color: "#d0d8e0" },
      { kind: "cylinder", offset: [0, 8.4, 0], rotation: [0, 0, 0], scale: [0.08, 1.0, 0.08], color: "#333333" },
    ],
  },
  {
    id: "building_kiosk",
    category: "building",
    label: "노점 키오스크",
    description: "작은 판매 부스",
    footprint: 1.0,
    parts: [
      { kind: "box", offset: [0, 0.7, 0], rotation: [0, 0, 0], scale: [1.4, 1.4, 1.2], color: "#e8c86a" },
      { kind: "box", offset: [0, 1.45, 0], rotation: [0, 0, 0], scale: [1.6, 0.1, 1.4], color: "#c45c3a" },
      { kind: "box", offset: [0, 0.9, 0.62], rotation: [0, 0, 0], scale: [1.0, 0.7, 0.05], color: "#6ec3e8" },
    ],
  },

  // ── nature (확장) ─────────────────────────────────────────
  {
    id: "tree_palm",
    category: "nature",
    label: "야자수",
    description: "열대 분위기 기둥+잎",
    footprint: 0.8,
    parts: [
      { kind: "cylinder", offset: [0, 1.4, 0], rotation: [0, 0, 0], scale: [0.45, 2.8, 0.45], color: "#8a6a3c" },
      { kind: "cone", offset: [0.55, 2.9, 0], rotation: [0, 0, 1.1], scale: [0.9, 1.2, 0.35], color: "#3d8f4a" },
      { kind: "cone", offset: [-0.55, 2.9, 0], rotation: [0, 0, -1.1], scale: [0.9, 1.2, 0.35], color: "#3d8f4a" },
      { kind: "cone", offset: [0, 2.95, 0.55], rotation: [1.1, 0, 0], scale: [0.35, 1.2, 0.9], color: "#4aa05a" },
      { kind: "cone", offset: [0, 2.95, -0.55], rotation: [-1.1, 0, 0], scale: [0.35, 1.2, 0.9], color: "#4aa05a" },
      { kind: "sphere", offset: [0, 2.75, 0], rotation: [0, 0, 0], scale: [0.5, 0.45, 0.5], color: "#6b4a2a" },
    ],
  },
  {
    id: "tree_dead",
    category: "nature",
    label: "고목",
    description: "앙상한 가지 나무",
    footprint: 0.7,
    parts: [
      { kind: "cylinder", offset: [0, 1.0, 0], rotation: [0, 0, 0], scale: [0.55, 2.0, 0.55], color: "#5a4632" },
      { kind: "cylinder", offset: [0.35, 2.2, 0], rotation: [0, 0, 0.7], scale: [0.18, 1.1, 0.18], color: "#6b5340" },
      { kind: "cylinder", offset: [-0.4, 2.1, 0.15], rotation: [0, 0, -0.8], scale: [0.16, 1.0, 0.16], color: "#6b5340" },
      { kind: "cylinder", offset: [0.1, 2.4, -0.35], rotation: [0.6, 0, 0], scale: [0.14, 0.9, 0.14], color: "#5c4a38" },
    ],
  },
  {
    id: "rock_cluster",
    category: "nature",
    label: "바위 무리",
    description: "산·계곡용 바위 3개",
    footprint: 1.0,
    parts: [
      { kind: "sphere", offset: [0, 0.4, 0], rotation: [0, 0.3, 0], scale: [1.2, 0.8, 1.0], color: "#8a8a82" },
      { kind: "sphere", offset: [0.7, 0.28, 0.2], rotation: [0, 0, 0.2], scale: [0.7, 0.55, 0.65], color: "#7a7a72" },
      { kind: "sphere", offset: [-0.55, 0.22, -0.25], rotation: [0.1, 0, 0], scale: [0.55, 0.45, 0.5], color: "#94948c" },
    ],
  },
  {
    id: "flower_pot",
    category: "nature",
    label: "화분",
    description: "화분+관목",
    footprint: 0.4,
    parts: [
      { kind: "cylinder", offset: [0, 0.22, 0], rotation: [0, 0, 0], scale: [0.7, 0.45, 0.7], color: "#a86b4a" },
      { kind: "sphere", offset: [0, 0.55, 0], rotation: [0, 0, 0], scale: [0.85, 0.55, 0.85], color: "#4f9a55" },
      { kind: "sphere", offset: [0.12, 0.62, 0.08], rotation: [0, 0, 0], scale: [0.25, 0.2, 0.25], color: "#e86a9b" },
    ],
  },
  {
    id: "hedge_row",
    category: "nature",
    label: "생울타리",
    description: "긴 관목 울타리",
    footprint: 1.4,
    parts: [
      { kind: "box", offset: [0, 0.55, 0], rotation: [0, 0, 0], scale: [2.4, 1.1, 0.55], color: "#4a8f4e" },
      { kind: "sphere", offset: [-0.9, 1.0, 0], rotation: [0, 0, 0], scale: [0.55, 0.4, 0.45], color: "#5a9a5d" },
      { kind: "sphere", offset: [0, 1.05, 0], rotation: [0, 0, 0], scale: [0.6, 0.42, 0.48], color: "#437f47" },
      { kind: "sphere", offset: [0.9, 1.0, 0], rotation: [0, 0, 0], scale: [0.55, 0.4, 0.45], color: "#5a9a5d" },
    ],
  },

  // ── vehicle (확장) ────────────────────────────────────────
  {
    id: "vehicle_suv",
    category: "vehicle",
    label: "SUV",
    description: "전고 높은 승용차",
    footprint: 1.4,
    parts: [
      { kind: "box", offset: [0, 0.55, 0], rotation: [0, 0, 0], scale: [1.2, 0.7, 2.2], color: "#3a5a7a" },
      { kind: "box", offset: [0, 1.0, -0.05], rotation: [0, 0, 0], scale: [1.05, 0.55, 1.3], color: "#2a455f" },
      {
        kind: "cylinder",
        offset: [0.68, 0.3, 0.75],
        rotation: [0, 0, Math.PI / 2],
        scale: [0.95, 0.25, 0.95],
        color: "#1c1c1c",
      },
      {
        kind: "cylinder",
        offset: [-0.68, 0.3, 0.75],
        rotation: [0, 0, Math.PI / 2],
        scale: [0.95, 0.25, 0.95],
        color: "#1c1c1c",
      },
      {
        kind: "cylinder",
        offset: [0.68, 0.3, -0.75],
        rotation: [0, 0, Math.PI / 2],
        scale: [0.95, 0.25, 0.95],
        color: "#1c1c1c",
      },
      {
        kind: "cylinder",
        offset: [-0.68, 0.3, -0.75],
        rotation: [0, 0, Math.PI / 2],
        scale: [0.95, 0.25, 0.95],
        color: "#1c1c1c",
      },
    ],
  },
  {
    id: "vehicle_bike",
    category: "vehicle",
    label: "자전거",
    description: "바퀴2 + 프레임 실루엣",
    footprint: 0.7,
    parts: [
      {
        kind: "torus",
        offset: [0, 0.35, 0.55],
        rotation: [0, 0, Math.PI / 2],
        scale: [0.9, 0.9, 0.35],
        color: "#1c1c1c",
      },
      {
        kind: "torus",
        offset: [0, 0.35, -0.55],
        rotation: [0, 0, Math.PI / 2],
        scale: [0.9, 0.9, 0.35],
        color: "#1c1c1c",
      },
      { kind: "box", offset: [0, 0.55, 0], rotation: [0.15, 0, 0], scale: [0.08, 0.08, 1.1], color: "#c45c3a" },
      { kind: "box", offset: [0, 0.75, -0.15], rotation: [0, 0, 0], scale: [0.45, 0.06, 0.12], color: "#2a2a2a" },
      { kind: "cylinder", offset: [0, 0.85, 0.45], rotation: [0.4, 0, 0], scale: [0.12, 0.5, 0.12], color: "#3a3a3a" },
    ],
  },
  {
    id: "vehicle_truck",
    category: "vehicle",
    label: "트럭",
    description: "캡+적재함",
    footprint: 1.8,
    parts: [
      { kind: "box", offset: [0, 0.7, 1.1], rotation: [0, 0, 0], scale: [1.3, 1.1, 1.2], color: "#c45c3a" },
      { kind: "box", offset: [0, 1.0, -0.6], rotation: [0, 0, 0], scale: [1.35, 1.5, 2.4], color: "#d8d0c0" },
      {
        kind: "cylinder",
        offset: [0.75, 0.32, 1.3],
        rotation: [0, 0, Math.PI / 2],
        scale: [1.0, 0.28, 1.0],
        color: "#1c1c1c",
      },
      {
        kind: "cylinder",
        offset: [-0.75, 0.32, 1.3],
        rotation: [0, 0, Math.PI / 2],
        scale: [1.0, 0.28, 1.0],
        color: "#1c1c1c",
      },
      {
        kind: "cylinder",
        offset: [0.75, 0.32, -1.2],
        rotation: [0, 0, Math.PI / 2],
        scale: [1.0, 0.28, 1.0],
        color: "#1c1c1c",
      },
      {
        kind: "cylinder",
        offset: [-0.75, 0.32, -1.2],
        rotation: [0, 0, Math.PI / 2],
        scale: [1.0, 0.28, 1.0],
        color: "#1c1c1c",
      },
    ],
  },

  // ── prop (확장) ───────────────────────────────────────────
  {
    id: "prop_mailbox",
    category: "prop",
    label: "우체통",
    description: "기둥+우편함",
    footprint: 0.3,
    parts: [
      { kind: "cylinder", offset: [0, 0.55, 0], rotation: [0, 0, 0], scale: [0.12, 1.1, 0.12], color: "#3a3a3a" },
      { kind: "box", offset: [0, 1.15, 0], rotation: [0, 0, 0], scale: [0.45, 0.35, 0.3], color: "#2f5a9a" },
      { kind: "box", offset: [0, 1.32, 0.16], rotation: [0, 0, 0], scale: [0.35, 0.08, 0.04], color: "#1e3a6a" },
    ],
  },
  {
    id: "prop_vending",
    category: "prop",
    label: "자판기",
    description: "음료 자판기",
    footprint: 0.5,
    parts: [
      { kind: "box", offset: [0, 0.95, 0], rotation: [0, 0, 0], scale: [0.9, 1.9, 0.55], color: "#e8e8ec" },
      { kind: "box", offset: [0, 1.15, 0.28], rotation: [0, 0, 0], scale: [0.7, 1.1, 0.04], color: "#3a8fd4" },
      { kind: "box", offset: [0, 0.25, 0.28], rotation: [0, 0, 0], scale: [0.55, 0.25, 0.08], color: "#2a2a2a" },
    ],
  },
  {
    id: "prop_barrier",
    category: "prop",
    label: "공사 바리케이드",
    description: "줄무늬 차단봉",
    footprint: 0.6,
    parts: [
      { kind: "box", offset: [0, 0.45, 0], rotation: [0, 0, 0], scale: [1.4, 0.9, 0.12], color: "#e8a020" },
      { kind: "box", offset: [0, 0.55, 0.02], rotation: [0, 0, 0], scale: [1.2, 0.2, 0.04], color: "#1c1c1c" },
      { kind: "box", offset: [0, 0.25, 0.02], rotation: [0, 0, 0], scale: [1.2, 0.2, 0.04], color: "#1c1c1c" },
    ],
  },
  {
    id: "prop_fountain",
    category: "prop",
    label: "분수대",
    description: "원형 연못+기둥",
    footprint: 1.2,
    parts: [
      { kind: "cylinder", offset: [0, 0.2, 0], rotation: [0, 0, 0], scale: [2.4, 0.4, 2.4], color: "#a8b0b8" },
      { kind: "cylinder", offset: [0, 0.55, 0], rotation: [0, 0, 0], scale: [0.5, 0.9, 0.5], color: "#8a949c" },
      { kind: "sphere", offset: [0, 1.1, 0], rotation: [0, 0, 0], scale: [0.55, 0.4, 0.55], color: "#6ec3e8" },
    ],
  },
  {
    id: "prop_traffic_cone",
    category: "prop",
    label: "라바콘",
    description: "도로 안전 콘",
    footprint: 0.25,
    parts: [
      { kind: "cone", offset: [0, 0.35, 0], rotation: [0, 0, 0], scale: [0.55, 0.7, 0.55], color: "#e85a20" },
      { kind: "box", offset: [0, 0.05, 0], rotation: [0, 0, 0], scale: [0.45, 0.08, 0.45], color: "#1c1c1c" },
    ],
  },
  {
    id: "prop_billboard",
    category: "prop",
    label: "빌보드",
    description: "대형 광고판",
    footprint: 1.0,
    parts: [
      { kind: "cylinder", offset: [-0.9, 2.0, 0], rotation: [0, 0, 0], scale: [0.15, 4.0, 0.15], color: "#3a3a3a" },
      { kind: "cylinder", offset: [0.9, 2.0, 0], rotation: [0, 0, 0], scale: [0.15, 4.0, 0.15], color: "#3a3a3a" },
      { kind: "box", offset: [0, 3.4, 0], rotation: [0, 0, 0], scale: [2.4, 1.4, 0.12], color: "#e8e2d6" },
      { kind: "box", offset: [0, 3.4, 0.07], rotation: [0, 0, 0], scale: [2.1, 1.15, 0.04], color: "#5a9fd4" },
    ],
  },
  {
    id: "prop_crate",
    category: "prop",
    label: "나무 상자",
    description: "물류·창고 소품",
    footprint: 0.45,
    parts: [
      { kind: "box", offset: [0, 0.3, 0], rotation: [0, 0.2, 0], scale: [0.7, 0.6, 0.7], color: "#a67c4a" },
      { kind: "box", offset: [0, 0.62, 0], rotation: [0, 0.2, 0], scale: [0.72, 0.06, 0.72], color: "#8a6438" },
    ],
  },
  {
    id: "prop_barrel",
    category: "prop",
    label: "드럼통",
    description: "원통 드럼",
    footprint: 0.4,
    parts: [
      { kind: "cylinder", offset: [0, 0.5, 0], rotation: [0, 0, 0], scale: [1.0, 1.0, 1.0], color: "#4a6b4a" },
      { kind: "cylinder", offset: [0, 0.95, 0], rotation: [0, 0, 0], scale: [1.05, 0.08, 1.05], color: "#3a5a3a" },
      { kind: "cylinder", offset: [0, 0.35, 0], rotation: [0, 0, 0], scale: [1.08, 0.06, 1.08], color: "#2a2a2a" },
    ],
  },
  {
    id: "prop_umbrella",
    category: "prop",
    label: "파라솔",
    description: "해변·카페용 큰 우산",
    footprint: 0.9,
    parts: [
      { kind: "cylinder", offset: [0, 1.1, 0], rotation: [0, 0, 0], scale: [0.12, 2.2, 0.12], color: "#e8e2d6" },
      { kind: "cone", offset: [0, 2.25, 0], rotation: [Math.PI, 0, 0], scale: [2.2, 0.7, 2.2], color: "#e85a5a" },
      { kind: "cylinder", offset: [0, 0.08, 0], rotation: [0, 0, 0], scale: [0.9, 0.12, 0.9], color: "#c9b28a" },
    ],
  },
  {
    id: "prop_lantern",
    category: "prop",
    label: "석등",
    description: "사당·정원용 등롱",
    footprint: 0.35,
    parts: [
      { kind: "box", offset: [0, 0.15, 0], rotation: [0, 0, 0], scale: [0.55, 0.3, 0.55], color: "#8a8a82" },
      { kind: "box", offset: [0, 0.55, 0], rotation: [0, 0, 0], scale: [0.35, 0.5, 0.35], color: "#6a6a62" },
      { kind: "box", offset: [0, 0.95, 0], rotation: [0, 0, 0], scale: [0.6, 0.18, 0.6], color: "#5a5a52" },
      { kind: "sphere", offset: [0, 0.7, 0], rotation: [0, 0, 0], scale: [0.22, 0.22, 0.22], color: "#ffe9a8" },
    ],
  },
  {
    id: "prop_table_set",
    category: "prop",
    label: "야외 테이블",
    description: "원탁+의자 실루엣",
    footprint: 0.9,
    parts: [
      { kind: "cylinder", offset: [0, 0.72, 0], rotation: [0, 0, 0], scale: [1.6, 0.08, 1.6], color: "#8a6b4a" },
      { kind: "cylinder", offset: [0, 0.36, 0], rotation: [0, 0, 0], scale: [0.15, 0.72, 0.15], color: "#3a3a3a" },
      { kind: "box", offset: [0.7, 0.35, 0], rotation: [0, 0, 0], scale: [0.4, 0.7, 0.4], color: "#5c4632" },
      { kind: "box", offset: [-0.7, 0.35, 0], rotation: [0, 0, 0], scale: [0.4, 0.7, 0.4], color: "#5c4632" },
    ],
  },
  {
    id: "prop_streetlight",
    category: "prop",
    label: "가로등",
    description: "기둥 + 팔 + 구형 등 head",
    footprint: 0.4,
    parts: [
      { kind: "cylinder", offset: [0, 1.9, 0], rotation: [0, 0, 0], scale: [0.13, 3.8, 0.13], color: "#4a4f58" },
      { kind: "box", offset: [0.38, 3.82, 0], rotation: [0, 0, 0], scale: [0.95, 0.07, 0.07], color: "#4a4f58" },
      { kind: "sphere", offset: [0.78, 3.66, 0], rotation: [0, 0, 0], scale: [0.55, 0.55, 0.55], color: "#ffe9b8" },
    ],
  },
  {
    id: "nature_boulder",
    category: "nature",
    label: "바위",
    description: "포개진 화강암 덩어리 3개",
    footprint: 1.2,
    parts: [
      { kind: "sphere", offset: [0, 0.42, 0], rotation: [0, 0, 0], scale: [1.5, 0.95, 1.25], color: "#9a948a" },
      { kind: "sphere", offset: [0.62, 0.22, 0.28], rotation: [0, 0, 0], scale: [0.85, 0.55, 0.75], color: "#8a847a" },
      { kind: "sphere", offset: [-0.55, 0.18, -0.2], rotation: [0, 0, 0], scale: [0.7, 0.45, 0.65], color: "#a39d92" },
    ],
  },
  {
    id: "vehicle_bus",
    category: "vehicle",
    label: "시내버스",
    description: "창문 띠와 앞유리, 네 바퀴",
    footprint: 2.6,
    parts: [
      { kind: "box", offset: [0, 1.5, 0], rotation: [0, 0, 0], scale: [4.6, 1.8, 1.9], color: "#3f7f5f" },
      { kind: "box", offset: [0, 2.02, 0.96], rotation: [0, 0, 0], scale: [4.2, 0.66, 0.05], color: "#9fc6d8" },
      { kind: "box", offset: [0, 2.02, -0.96], rotation: [0, 0, 0], scale: [4.2, 0.66, 0.05], color: "#9fc6d8" },
      { kind: "box", offset: [2.32, 1.98, 0], rotation: [0, 0, 0], scale: [0.05, 0.78, 1.6], color: "#9fc6d8" },
      { kind: "cylinder", offset: [1.55, 0.36, 0.86], rotation: [0, 0, Math.PI / 2], scale: [0.76, 0.14, 0.76], color: "#22252a" },
      { kind: "cylinder", offset: [-1.55, 0.36, 0.86], rotation: [0, 0, Math.PI / 2], scale: [0.76, 0.14, 0.76], color: "#22252a" },
      { kind: "cylinder", offset: [1.55, 0.36, -0.86], rotation: [0, 0, Math.PI / 2], scale: [0.76, 0.14, 0.76], color: "#22252a" },
      { kind: "cylinder", offset: [-1.55, 0.36, -0.86], rotation: [0, 0, Math.PI / 2], scale: [0.76, 0.14, 0.76], color: "#22252a" },
    ],
  },
];

/**
 * 프리셋 템플릿을 실제 BgPrimitive[]로 전개한다. createPrimitive와 동일한 "찾기 쉬운 자리에
 * 결정적으로 흩뿌리기" 철학을 따르되(정확한 배치는 사용자가 TransformControls로 직접 잡음),
 * footprint가 프리셋마다 크게 달라 고정 0.8m 대신 footprint 비례 간격을 쓴다.
 */
export function instantiateCompositePreset(preset: BgCompositePreset, existingCount: number): BgPrimitive[] {
  const anchorX = (existingCount % 5) * preset.footprint * 1.5;
  return preset.parts.map((part) => ({
    id: uid(),
    kind: part.kind,
    position: [anchorX + part.offset[0], part.offset[1], part.offset[2]],
    rotation: [...part.rotation],
    scale: [...part.scale],
    color: part.color,
  }));
}
