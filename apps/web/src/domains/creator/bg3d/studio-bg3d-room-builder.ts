// "3D 배경" 도구의 SketchUp 스타일 간이 블로킹 모델러 — 바닥+벽 4면(두께/높이), 벽별 문/창
// 오프닝, 계단·기둥·가구 프리미티브를 "수치 파라미터"로 절차 생성한다.
//
// 설계 결정(§씬 템플릿과의 관계): studio-background-3d-scene-templates.ts의 교실/카페 템플릿은
// 좌표가 하드코딩된 "완성형 공간"이라 크기·문 위치를 바꿀 수 없다. 이 모듈은 같은 13종
// PRIMITIVE_DEFS 지오메트리만 재사용하되(새 지오메트리·외부 에셋 없음 — 라이선스/번들 영향 0),
// 방 치수와 오프닝을 파라미터로 받아 매번 새로 계산한다. 결과는 기존 BgPrimitive[]로 전개되어
// 장면 문서의 primitive 노드로 그대로 저장된다 — 새 문서 스키마 개념을 만들지 않는다
// (studio-bg3d-scene-document.ts v3의 정규화·버전 계약을 그대로 상속).
//
// 좌표 계약: 방 중심이 원점, 바닥 윗면이 y=0. 벽은 축 정렬(북=-Z, 남=+Z, 서=-X, 동=+X)이며
// 기존 템플릿과 동일하게 둘레 선 위에 중심을 둔다(모서리 겹침 허용 — 시각적으로 무해).
// 가구 파츠는 yaw(월드 Y) 회전만 사용하므로 오일러 합성 없이 rotation[1] 덧셈이 정확하다
// (지붕처럼 X/Z축이 이미 튼 파츠가 없다는 것이 이 단순화의 전제 — 카탈로그에 그런 파츠를 추가하려면
// scene-templates의 rotateEulerYaw 방식으로 바꿔야 한다).

import { uid } from "../studio-id";

import type { BgPrimitive, BgPrimitiveKind } from "../studio-background-3d-metadata";

export const STUDIO_BG3D_ROOM_WALL_IDS = ["north", "south", "west", "east"] as const;
export type StudioBg3dRoomWallId = (typeof STUDIO_BG3D_ROOM_WALL_IDS)[number];

export const STUDIO_BG3D_ROOM_WALL_LABELS: Record<StudioBg3dRoomWallId, string> = {
  north: "뒷벽",
  south: "앞벽",
  west: "왼벽",
  east: "오른벽",
};

export type StudioBg3dRoomOpeningType = "door" | "window";

export interface StudioBg3dRoomOpening {
  readonly wall: StudioBg3dRoomWallId;
  readonly type: StudioBg3dRoomOpeningType;
  /** 벽 중심 기준 좌우 오프셋(m). 벽을 안(방 내부)에서 바라볼 때 +가 오른쪽. */
  readonly centerOffset: number;
  readonly width: number;
  readonly height: number;
  /** 바닥에서 오프닝 하단까지 높이(m). 문은 0으로 강제된다. */
  readonly sillHeight: number;
}

export const STUDIO_BG3D_ROOM_FURNITURE_KINDS = [
  "table",
  "chair",
  "bed",
  "bookshelf",
  "column",
  "stairs",
  "sofa",
  "plant",
  "lamp",
] as const;
export type StudioBg3dRoomFurnitureKind = (typeof STUDIO_BG3D_ROOM_FURNITURE_KINDS)[number];

export const STUDIO_BG3D_ROOM_FURNITURE_LABELS: Record<StudioBg3dRoomFurnitureKind, string> = {
  table: "테이블",
  chair: "의자",
  bed: "침대",
  bookshelf: "책장",
  column: "기둥",
  stairs: "계단",
  sofa: "소파",
  plant: "화분",
  lamp: "스탠드 조명",
};

export interface StudioBg3dRoomFurnitureItem {
  readonly kind: StudioBg3dRoomFurnitureKind;
  /** 방-로컬 배치 좌표(m). 방 중심이 (0, 0). */
  readonly x: number;
  readonly z: number;
  /** 월드 Y축 요 회전(도). 파츠가 전부 yaw-only라 단순 덧셈 합성이 정확하다. */
  readonly yawDeg: number;
}

export interface StudioBg3dRoomSpec {
  readonly width: number;
  readonly depth: number;
  readonly wallHeight: number;
  readonly wallThickness: number;
  readonly floorColor: string;
  readonly wallColor: string;
  readonly openings: readonly StudioBg3dRoomOpening[];
  readonly furniture: readonly StudioBg3dRoomFurnitureItem[];
}

export interface StudioBg3dRoomPart {
  readonly kind: BgPrimitiveKind;
  readonly name: string;
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
  readonly color: string;
}

export const STUDIO_BG3D_ROOM_LIMITS = Object.freeze({
  minWidth: 2,
  maxWidth: 30,
  minDepth: 2,
  maxDepth: 30,
  minWallHeight: 1,
  maxWallHeight: 10,
  minWallThickness: 0.05,
  maxWallThickness: 0.6,
  maxOpenings: 12,
  maxFurniture: 24,
  /** 오프닝 좌우와 벽 끝 사이에 남겨야 하는 최소 벽체(m). */
  openingEdgeMargin: 0.1,
  /** 오프닝 상단과 벽 상단 사이 최소 벽체(m) — 인방(헤더)이 0 두께로 사라지지 않게. */
  openingHeadMargin: 0.1,
  floorThickness: 0.1,
});

const HEX_COLOR = /^#[0-9a-f]{6}$/iu;

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function clampColor(value: unknown, fallback: string): string {
  return typeof value === "string" && HEX_COLOR.test(value) ? value.toLowerCase() : fallback;
}

/**
 * 임의 입력을 렌더 가능한 안전 범위로 눌러 담는다. 실패-열림 없이 항상 유효한 스펙을 돌려준다
 * (scene-document의 boundedNumber 철학과 동일 — 슬라이더/숫자 입력의 중간 상태도 안전).
 * 오프닝은 여기서 개별 클램프만 하고, 벽 안에 실제로 들어가는지는 layout 단계에서 다시 검사한다
 * (벽 길이가 함께 바뀌면 클램프 시점의 판단이 무효가 되므로 최종 판정은 한 곳에만 둔다).
 */
export function clampStudioBg3dRoomSpec(raw: Partial<StudioBg3dRoomSpec> | null | undefined): StudioBg3dRoomSpec {
  const limits = STUDIO_BG3D_ROOM_LIMITS;
  const source = raw ?? {};
  const width = clampNumber(source.width, 6, limits.minWidth, limits.maxWidth);
  const depth = clampNumber(source.depth, 5, limits.minDepth, limits.maxDepth);
  const wallHeight = clampNumber(source.wallHeight, 2.6, limits.minWallHeight, limits.maxWallHeight);
  const wallThickness = clampNumber(
    source.wallThickness,
    0.15,
    limits.minWallThickness,
    limits.maxWallThickness,
  );
  const openings = (Array.isArray(source.openings) ? source.openings : [])
    .slice(0, limits.maxOpenings)
    .filter((opening): opening is StudioBg3dRoomOpening =>
      !!opening &&
      (STUDIO_BG3D_ROOM_WALL_IDS as readonly string[]).includes(opening.wall) &&
      (opening.type === "door" || opening.type === "window"))
    .map((opening) => {
      const wallLength = opening.wall === "north" || opening.wall === "south" ? width : depth;
      const maxOpeningWidth = Math.max(0.3, wallLength - limits.openingEdgeMargin * 2);
      const openingWidth = clampNumber(opening.width, 0.9, 0.3, maxOpeningWidth);
      const sillHeight = opening.type === "door"
        ? 0
        : clampNumber(opening.sillHeight, 0.9, 0.1, Math.max(0.1, wallHeight - 0.4));
      const maxOpeningHeight = Math.max(0.2, wallHeight - sillHeight - limits.openingHeadMargin);
      const height = clampNumber(
        opening.height,
        opening.type === "door" ? 2 : 1.1,
        0.2,
        maxOpeningHeight,
      );
      const halfSpan = wallLength / 2 - limits.openingEdgeMargin - openingWidth / 2;
      const centerOffset = clampNumber(opening.centerOffset, 0, -Math.max(0, halfSpan), Math.max(0, halfSpan));
      return { wall: opening.wall, type: opening.type, centerOffset, width: openingWidth, height, sillHeight };
    });
  const furniture = (Array.isArray(source.furniture) ? source.furniture : [])
    .slice(0, limits.maxFurniture)
    .filter((item): item is StudioBg3dRoomFurnitureItem =>
      !!item && (STUDIO_BG3D_ROOM_FURNITURE_KINDS as readonly string[]).includes(item.kind))
    .map((item) => ({
      kind: item.kind,
      x: clampNumber(item.x, 0, -width / 2, width / 2),
      z: clampNumber(item.z, 0, -depth / 2, depth / 2),
      yawDeg: clampNumber(item.yawDeg, 0, -360, 360),
    }));
  return {
    width,
    depth,
    wallHeight,
    wallThickness,
    floorColor: clampColor(source.floorColor, "#d9c9a3"),
    wallColor: clampColor(source.wallColor, "#f2ead8"),
    openings,
    furniture,
  };
}

// ── 벽 세그먼트 레이아웃(불리언 컷 코어) ──────────────────────────────────────
// 벽 하나를 로컬 u축(길이 L, u=0이 벽 중심)·y축(높이 H) 평면에서 본다. 오프닝마다 벽을
// [좌측 솔리드 | (창턱) 오프닝 (인방) | 우측 솔리드]로 쪼갠다 — CSG 없이 박스 조합만으로
// SketchUp의 "벽에 구멍 뚫기"와 같은 결과를 만든다.

export interface StudioBg3dWallSegment {
  /** 세그먼트 중심 u(m, 벽 중심 기준). */
  readonly centerU: number;
  /** 세그먼트 중심 y(m, 바닥 기준). */
  readonly centerY: number;
  readonly lengthU: number;
  readonly height: number;
}

interface AcceptedOpening {
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
  readonly top: number;
}

const EPSILON = 1e-6;

/**
 * clamp를 통과한 오프닝이라도 벽 길이가 스펙 변경으로 줄었거나 서로 겹치면 여기서 탈락한다
 * (먼저 온 오프닝 우선 — 결정적). 반환 세그먼트는 u 오름차순 → 같은 오프닝의 창턱 → 인방 순.
 */
export function layoutStudioBg3dWallSegments(
  wallLength: number,
  wallHeight: number,
  openings: readonly Pick<StudioBg3dRoomOpening, "centerOffset" | "width" | "height" | "sillHeight">[],
): StudioBg3dWallSegment[] {
  const margin = STUDIO_BG3D_ROOM_LIMITS.openingEdgeMargin;
  const accepted: AcceptedOpening[] = [];
  const sorted = [...openings].sort((a, b) => a.centerOffset - b.centerOffset);
  for (const opening of sorted) {
    const left = opening.centerOffset - opening.width / 2;
    const right = opening.centerOffset + opening.width / 2;
    const bottom = Math.max(0, opening.sillHeight);
    const top = Math.min(wallHeight - STUDIO_BG3D_ROOM_LIMITS.openingHeadMargin, bottom + opening.height);
    if (left < -wallLength / 2 + margin - EPSILON) continue;
    if (right > wallLength / 2 - margin + EPSILON) continue;
    if (top - bottom < 0.05) continue;
    if (accepted.some((prev) => left < prev.right + EPSILON && right > prev.left - EPSILON)) continue;
    accepted.push({ left, right, bottom, top });
  }

  const segments: StudioBg3dWallSegment[] = [];
  let cursor = -wallLength / 2;
  for (const opening of accepted) {
    if (opening.left - cursor > EPSILON) {
      const lengthU = opening.left - cursor;
      segments.push({
        centerU: cursor + lengthU / 2,
        centerY: wallHeight / 2,
        lengthU,
        height: wallHeight,
      });
    }
    if (opening.bottom > EPSILON) {
      segments.push({
        centerU: (opening.left + opening.right) / 2,
        centerY: opening.bottom / 2,
        lengthU: opening.right - opening.left,
        height: opening.bottom,
      });
    }
    if (wallHeight - opening.top > EPSILON) {
      segments.push({
        centerU: (opening.left + opening.right) / 2,
        centerY: opening.top + (wallHeight - opening.top) / 2,
        lengthU: opening.right - opening.left,
        height: wallHeight - opening.top,
      });
    }
    cursor = opening.right;
  }
  if (wallLength / 2 - cursor > EPSILON) {
    const lengthU = wallLength / 2 - cursor;
    segments.push({
      centerU: cursor + lengthU / 2,
      centerY: wallHeight / 2,
      lengthU,
      height: wallHeight,
    });
  }
  return segments;
}

// ── 벽 → 월드 배치 ────────────────────────────────────────────────────────────
// "안(방 내부)에서 벽을 바라볼 때 +u가 오른쪽" 규약: 북벽은 +u=+x, 남벽은 +u=-x,
// 서벽은 +u=-z, 동벽은 +u=+z. 이렇게 하면 UI의 "좌/우" 오프셋이 어느 벽에서도 직관과 일치한다.

interface WallPlacement {
  readonly toWorld: (u: number) => readonly [number, number];
  /** 벽 길이 방향이 X축이면 true(스케일 매핑용). */
  readonly alongX: boolean;
}

function wallPlacement(wall: StudioBg3dRoomWallId, width: number, depth: number): WallPlacement {
  switch (wall) {
    case "north":
      return { toWorld: (u) => [u, -depth / 2], alongX: true };
    case "south":
      return { toWorld: (u) => [-u, depth / 2], alongX: true };
    case "west":
      return { toWorld: (u) => [-width / 2, -u], alongX: false };
    case "east":
      return { toWorld: (u) => [width / 2, u], alongX: false };
  }
}

// ── 가구 파츠 팩토리(yaw-only) ───────────────────────────────────────────────

interface FurniturePart {
  readonly kind: BgPrimitiveKind;
  readonly name: string;
  readonly offset: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
  readonly color: string;
}

function furnitureParts(kind: StudioBg3dRoomFurnitureKind, wallHeight: number): FurniturePart[] {
  switch (kind) {
    case "table":
      return [
        { kind: "box", name: "테이블 상판", offset: [0, 0.72, 0], scale: [1.4, 0.06, 0.8], color: "#8a6b4a" },
        { kind: "box", name: "테이블 다리", offset: [-0.6, 0.345, -0.3], scale: [0.08, 0.69, 0.08], color: "#5c4632" },
        { kind: "box", name: "테이블 다리", offset: [0.6, 0.345, -0.3], scale: [0.08, 0.69, 0.08], color: "#5c4632" },
        { kind: "box", name: "테이블 다리", offset: [-0.6, 0.345, 0.3], scale: [0.08, 0.69, 0.08], color: "#5c4632" },
        { kind: "box", name: "테이블 다리", offset: [0.6, 0.345, 0.3], scale: [0.08, 0.69, 0.08], color: "#5c4632" },
      ];
    case "chair":
      return [
        { kind: "box", name: "의자 좌판", offset: [0, 0.44, 0], scale: [0.42, 0.06, 0.42], color: "#6b4a37" },
        { kind: "box", name: "의자 다리", offset: [0, 0.205, 0], scale: [0.34, 0.41, 0.34], color: "#7a5a44" },
        { kind: "box", name: "의자 등받이", offset: [0, 0.72, -0.18], scale: [0.42, 0.5, 0.06], color: "#6b4a37" },
      ];
    case "bed":
      return [
        { kind: "box", name: "침대 프레임", offset: [0, 0.25, 0], scale: [1.2, 0.3, 2.1], color: "#6b4a6a" },
        { kind: "box", name: "침대 매트리스", offset: [0, 0.47, 0.05], scale: [1.1, 0.16, 1.9], color: "#e8dce8" },
        { kind: "box", name: "침대 헤드보드", offset: [0, 0.68, -1.0], scale: [1.2, 0.56, 0.12], color: "#5a3a5a" },
      ];
    case "bookshelf":
      return [
        { kind: "box", name: "책장 몸통", offset: [0, 0.9, 0], scale: [0.9, 1.8, 0.32], color: "#8a6b4a" },
        { kind: "box", name: "책장 선반", offset: [0, 0.62, 0.05], scale: [0.78, 0.05, 0.24], color: "#5c4632" },
        { kind: "box", name: "책장 선반", offset: [0, 1.18, 0.05], scale: [0.78, 0.05, 0.24], color: "#5c4632" },
      ];
    case "column": {
      const height = Math.max(0.5, wallHeight);
      return [
        // cylinder 기본 반지름 0.3(CylinderGeometry(0.3, ...)) → scale.x 0.6이면 실제 반지름 0.18m.
        { kind: "cylinder", name: "기둥", offset: [0, height / 2, 0], scale: [0.6, height, 0.6], color: "#c8c2b4" },
      ];
    }
    case "stairs": {
      const stepCount = 6;
      const stepRise = 0.2;
      const stepRun = 0.3;
      const stepWidth = 1.1;
      const parts: FurniturePart[] = [];
      for (let index = 0; index < stepCount; index += 1) {
        // 계단은 겹침 없는 "층층 박스": index번째 칸은 바닥부터 (index+1)*rise까지 차오른다 —
        // 옆에서 본 단면이 정확한 계단 모양이고, 섹션 컷과 선화 추출에서도 깨끗한 단이 나온다.
        const height = stepRise * (index + 1);
        parts.push({
          kind: "box",
          name: `계단 ${index + 1}단`,
          offset: [0, height / 2, stepRun * index - (stepRun * (stepCount - 1)) / 2],
          scale: [stepWidth, height, stepRun],
          color: "#b0a894",
        });
      }
      return parts;
    }
    case "sofa":
      return [
        { kind: "box", name: "소파 하부", offset: [0, 0.22, 0], scale: [1.7, 0.24, 0.85], color: "#5a6a7a" },
        { kind: "box", name: "소파 좌석", offset: [-0.4, 0.42, 0], scale: [0.8, 0.16, 0.78], color: "#6b7b8b" },
        { kind: "box", name: "소파 좌석", offset: [0.4, 0.42, 0], scale: [0.8, 0.16, 0.78], color: "#6b7b8b" },
        { kind: "box", name: "소파 등받이", offset: [0, 0.62, -0.32], scale: [1.7, 0.56, 0.2], color: "#5a6a7a" },
        { kind: "box", name: "소파 팔걸이", offset: [-0.79, 0.48, 0], scale: [0.12, 0.34, 0.85], color: "#4e5e6e" },
        { kind: "box", name: "소파 팔걸이", offset: [0.79, 0.48, 0], scale: [0.12, 0.34, 0.85], color: "#4e5e6e" },
      ];
    case "plant":
      return [
        // cylinder 기본 반지름 0.3 → scale.x 0.9면 화분 반지름 ≈0.27m.
        { kind: "cylinder", name: "화분 몸통", offset: [0, 0.19, 0], scale: [0.9, 0.38, 0.9], color: "#a4643f" },
        { kind: "sphere", name: "화분 잎", offset: [0, 0.72, 0], scale: [1.4, 1.2, 1.4], color: "#4a7a3a" },
      ];
    case "lamp":
      return [
        { kind: "cylinder", name: "조명 베이스", offset: [0, 0.02, 0], scale: [1.2, 0.04, 1.2], color: "#3a3a42" },
        { kind: "cylinder", name: "조명 폴", offset: [0, 0.75, 0], scale: [0.16, 1.44, 0.16], color: "#3a3a42" },
        { kind: "cone", name: "조명 갓", offset: [0, 1.56, 0], scale: [1.2, 0.5, 1.2], color: "#e8dcc8" },
      ];
  }
}

function rotateYaw(offset: readonly [number, number, number], yawRad: number): readonly [number, number, number] {
  const cos = Math.cos(yawRad);
  const sin = Math.sin(yawRad);
  return [offset[0] * cos + offset[2] * sin, offset[1], -offset[0] * sin + offset[2] * cos];
}

// ── 방 전체 파츠 생성 ─────────────────────────────────────────────────────────

export function buildStudioBg3dRoomParts(rawSpec: Partial<StudioBg3dRoomSpec>): StudioBg3dRoomPart[] {
  const spec = clampStudioBg3dRoomSpec(rawSpec);
  const parts: StudioBg3dRoomPart[] = [];
  const floorThickness = STUDIO_BG3D_ROOM_LIMITS.floorThickness;

  parts.push({
    kind: "box",
    name: "바닥",
    position: [0, -floorThickness / 2, 0],
    rotation: [0, 0, 0],
    scale: [spec.width, floorThickness, spec.depth],
    color: spec.floorColor,
  });

  for (const wall of STUDIO_BG3D_ROOM_WALL_IDS) {
    const wallLength = wall === "north" || wall === "south" ? spec.width : spec.depth;
    const placement = wallPlacement(wall, spec.width, spec.depth);
    const segments = layoutStudioBg3dWallSegments(
      wallLength,
      spec.wallHeight,
      spec.openings.filter((opening) => opening.wall === wall),
    );
    for (const segment of segments) {
      const [x, z] = placement.toWorld(segment.centerU);
      parts.push({
        kind: "box",
        name: `${STUDIO_BG3D_ROOM_WALL_LABELS[wall]} 벽체`,
        position: [x, segment.centerY, z],
        rotation: [0, 0, 0],
        scale: placement.alongX
          ? [segment.lengthU, segment.height, spec.wallThickness]
          : [spec.wallThickness, segment.height, segment.lengthU],
        color: spec.wallColor,
      });
    }
  }

  for (const item of spec.furniture) {
    const yawRad = (item.yawDeg * Math.PI) / 180;
    for (const part of furnitureParts(item.kind, spec.wallHeight)) {
      const rotated = rotateYaw(part.offset, yawRad);
      parts.push({
        kind: part.kind,
        name: part.name,
        position: [item.x + rotated[0], rotated[1], item.z + rotated[2]],
        rotation: [0, yawRad, 0],
        scale: [...part.scale] as [number, number, number],
        color: part.color,
      });
    }
  }

  return parts;
}

/**
 * 씬 템플릿과 같은 "결정적 X 오프셋 + uid" 전개. 테스트는 idFactory를 주입해 완전 결정적으로
 * 검증한다(프로덕션 ID는 공용 UUID 계약을 쓰며 지오메트리에는 영향 없음).
 */
export function instantiateStudioBg3dRoomBuild(
  spec: Partial<StudioBg3dRoomSpec>,
  existingCount: number,
  idFactory: () => string = uid,
): BgPrimitive[] {
  const clamped = clampStudioBg3dRoomSpec(spec);
  const anchorX = existingCount > 0 ? existingCount * (clamped.width / 6) : 0;
  return buildStudioBg3dRoomParts(clamped).map((part) => ({
    id: idFactory(),
    kind: part.kind,
    name: part.name,
    position: [part.position[0] + anchorX, part.position[1], part.position[2]],
    rotation: [...part.rotation] as [number, number, number],
    scale: [...part.scale] as [number, number, number],
    color: part.color,
  }));
}

// ── 프리셋 ────────────────────────────────────────────────────────────────────
// 씬 템플릿(고정 좌표 완성 공간)과 달리, 여기 프리셋은 "시작점 스펙"이다 — 적용 후에도 모든
// 수치를 계속 조정할 수 있다.

export interface StudioBg3dRoomPreset {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly spec: StudioBg3dRoomSpec;
}

export const STUDIO_BG3D_ROOM_PRESETS: readonly StudioBg3dRoomPreset[] = [
  {
    id: "classroom",
    label: "교실",
    description: "8×7m · 앞문/뒷문 · 창 3개 · 책상 열",
    spec: clampStudioBg3dRoomSpec({
      width: 8,
      depth: 7,
      wallHeight: 3,
      wallThickness: 0.15,
      floorColor: "#d9c9a3",
      wallColor: "#f2ead8",
      openings: [
        { wall: "south", type: "door", centerOffset: -2.8, width: 0.95, height: 2.1, sillHeight: 0 },
        { wall: "south", type: "door", centerOffset: 2.8, width: 0.95, height: 2.1, sillHeight: 0 },
        { wall: "east", type: "window", centerOffset: -2, width: 1.5, height: 1.1, sillHeight: 1 },
        { wall: "east", type: "window", centerOffset: 0, width: 1.5, height: 1.1, sillHeight: 1 },
        { wall: "east", type: "window", centerOffset: 2, width: 1.5, height: 1.1, sillHeight: 1 },
      ],
      furniture: [
        { kind: "table", x: -1.8, z: -0.6, yawDeg: 0 },
        { kind: "chair", x: -1.8, z: 0.1, yawDeg: 0 },
        { kind: "table", x: 0, z: -0.6, yawDeg: 0 },
        { kind: "chair", x: 0, z: 0.1, yawDeg: 0 },
        { kind: "table", x: 1.8, z: -0.6, yawDeg: 0 },
        { kind: "chair", x: 1.8, z: 0.1, yawDeg: 0 },
        { kind: "table", x: -1.8, z: 1.2, yawDeg: 0 },
        { kind: "chair", x: -1.8, z: 1.9, yawDeg: 0 },
        { kind: "table", x: 0, z: 1.2, yawDeg: 0 },
        { kind: "chair", x: 0, z: 1.9, yawDeg: 0 },
        { kind: "table", x: 1.8, z: 1.2, yawDeg: 0 },
        { kind: "chair", x: 1.8, z: 1.9, yawDeg: 0 },
      ],
    }),
  },
  {
    id: "cafe",
    label: "카페",
    description: "6×5m · 전면 유리창 · 출입문 · 테이블 2세트",
    spec: clampStudioBg3dRoomSpec({
      width: 6,
      depth: 5,
      wallHeight: 2.8,
      wallThickness: 0.15,
      floorColor: "#c9b28a",
      wallColor: "#e8dcc8",
      openings: [
        { wall: "south", type: "door", centerOffset: 2, width: 1, height: 2.1, sillHeight: 0 },
        { wall: "south", type: "window", centerOffset: -1, width: 2.8, height: 1.6, sillHeight: 0.6 },
        { wall: "west", type: "window", centerOffset: 0, width: 2.4, height: 1.3, sillHeight: 0.9 },
      ],
      furniture: [
        { kind: "table", x: -1.6, z: -1, yawDeg: 0 },
        { kind: "chair", x: -1.6, z: -1.8, yawDeg: 180 },
        { kind: "chair", x: -1.6, z: -0.2, yawDeg: 0 },
        { kind: "table", x: 1.2, z: 0.8, yawDeg: 90 },
        { kind: "chair", x: 0.4, z: 0.8, yawDeg: 90 },
        { kind: "chair", x: 2, z: 0.8, yawDeg: 270 },
        { kind: "bookshelf", x: -2.6, z: 2, yawDeg: 90 },
      ],
    }),
  },
  {
    id: "studio-flat",
    label: "원룸",
    description: "5×4m · 현관문 · 창 1개 · 침대·책장·테이블",
    spec: clampStudioBg3dRoomSpec({
      width: 5,
      depth: 4,
      wallHeight: 2.5,
      wallThickness: 0.12,
      floorColor: "#d4c4a8",
      wallColor: "#f0e6d8",
      openings: [
        { wall: "south", type: "door", centerOffset: 1.6, width: 0.9, height: 2.05, sillHeight: 0 },
        { wall: "east", type: "window", centerOffset: -0.5, width: 1.6, height: 1.2, sillHeight: 0.9 },
      ],
      furniture: [
        { kind: "bed", x: -1.4, z: -0.8, yawDeg: 0 },
        { kind: "bookshelf", x: 1.9, z: -1.6, yawDeg: 0 },
        { kind: "table", x: 1.2, z: 1.1, yawDeg: 0 },
        { kind: "chair", x: 1.2, z: 1.8, yawDeg: 0 },
        { kind: "sofa", x: -0.2, z: 1.35, yawDeg: 180 },
        { kind: "lamp", x: 1.9, z: 1.6, yawDeg: 0 },
      ],
    }),
  },
  {
    id: "corridor",
    label: "복도",
    description: "12×2.4m · 좌우 문 4개 · 복도 창",
    spec: clampStudioBg3dRoomSpec({
      width: 12,
      depth: 2.4,
      wallHeight: 2.8,
      wallThickness: 0.15,
      floorColor: "#c8c8c4",
      wallColor: "#eef0f2",
      openings: [
        { wall: "north", type: "door", centerOffset: -4, width: 0.95, height: 2.1, sillHeight: 0 },
        { wall: "north", type: "door", centerOffset: 0, width: 0.95, height: 2.1, sillHeight: 0 },
        { wall: "north", type: "door", centerOffset: 4, width: 0.95, height: 2.1, sillHeight: 0 },
        { wall: "south", type: "window", centerOffset: -2, width: 2.4, height: 1.2, sillHeight: 1 },
        { wall: "south", type: "window", centerOffset: 2, width: 2.4, height: 1.2, sillHeight: 1 },
        { wall: "east", type: "door", centerOffset: 0, width: 1, height: 2.1, sillHeight: 0 },
      ],
      furniture: [],
    }),
  },
  {
    id: "rooftop",
    label: "옥상",
    description: "9×8m · 낮은 난간 · 출입 계단·구조물",
    spec: clampStudioBg3dRoomSpec({
      width: 9,
      depth: 8,
      wallHeight: 1.1,
      wallThickness: 0.12,
      floorColor: "#7a7a78",
      wallColor: "#c8c8c4",
      openings: [
        { wall: "south", type: "door", centerOffset: 0, width: 1.2, height: 1, sillHeight: 0 },
      ],
      furniture: [
        { kind: "stairs", x: 2.8, z: -2.6, yawDeg: 180 },
        { kind: "column", x: -3.4, z: -3, yawDeg: 0 },
        { kind: "table", x: -1.5, z: 2, yawDeg: 0 },
        { kind: "chair", x: -1.5, z: 2.8, yawDeg: 180 },
        { kind: "plant", x: 3.4, z: 3.2, yawDeg: 0 },
      ],
    }),
  },
  {
    id: "study",
    label: "서재",
    description: "5×4.5m · 북쪽 큰 창 · 책장·책상·스탠드 조명",
    spec: clampStudioBg3dRoomSpec({
      width: 5,
      depth: 4.5,
      wallHeight: 2.7,
      wallThickness: 0.12,
      floorColor: "#8a7358",
      wallColor: "#e8e0d0",
      openings: [
        { wall: "north", type: "window", centerOffset: 0, width: 3.2, height: 1.4, sillHeight: 0.8 },
      ],
      furniture: [
        { kind: "bookshelf", x: -2.2, z: -2, yawDeg: 90 },
        { kind: "bookshelf", x: -2.2, z: -0.9, yawDeg: 90 },
        { kind: "table", x: 0.6, z: 0.4, yawDeg: 0 },
        { kind: "chair", x: 0.6, z: 1.15, yawDeg: 180 },
        { kind: "lamp", x: 1.9, z: -1.6, yawDeg: 0 },
        { kind: "plant", x: 2.1, z: 1.8, yawDeg: 0 },
      ],
    }),
  },
];

export function getStudioBg3dRoomPreset(id: unknown): StudioBg3dRoomPreset | null {
  return typeof id === "string"
    ? STUDIO_BG3D_ROOM_PRESETS.find((preset) => preset.id === id) ?? null
    : null;
}
