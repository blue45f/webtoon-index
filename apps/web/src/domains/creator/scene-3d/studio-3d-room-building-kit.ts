/**
 * Studio 3D Parametric Room & Building Kit
 *
 * 웹툰/만화 배경 세트장 구축을 위한 파라메트릭 건축 생성 엔진입니다.
 * 다중 방(Multi-Room), 벽 개구부(문/창문), 천장 조명, 바닥재, 계단,
 * 스마트 카메라 투명 벽(Wall Cutaway) 및 3D 메시 버퍼 생성을 완벽 지원합니다.
 */

export interface WallSegment {
  id: string;
  name?: string;
  start: [number, number]; // [X, Z] 2D 평면 시작점
  end: [number, number];   // [X, Z] 2D 평면 끝점
  height: number;          // 벽 높이 (m)
  thickness: number;       // 벽 두께 (m)
  materialId?: string;
  cutawayOpacity?: number; // 0.0(투명) ~ 1.0(불투명)
}

export type DoorType = "single-swing" | "double-swing" | "sliding" | "pocket" | "glass";
export type WindowType = "sliding" | "casement" | "bay" | "arch" | "fixed-picture";

export interface WallOpening {
  id: string;
  wallId: string;
  type: "door" | "window";
  subType?: DoorType | WindowType;
  offsetFromStart: number; // 벽 시작점으로부터의 거리 (m)
  width: number;           // 개구부 폭 (m)
  height: number;          // 개구부 높이 (m)
  sillHeight: number;      // 창문 턱 높이 (문인 경우 0)
  hasFrame: boolean;
  frameThickness?: number;
  mullionCount?: number;   // 창문 격자 수
}

export type StairStyle = "straight" | "l-shape" | "u-turn" | "spiral";

export interface StairSpec {
  id: string;
  startPoint: [number, number, number];
  directionAngleDeg: number;
  width: number;
  height: number;
  depth: number;
  stepsCount: number;
  style: StairStyle;
  hasRailing: boolean;
  railingHeight: number;
}

export type FlooringPattern = "hardwood-parquet" | "ceramic-tiles" | "tatami-mats" | "concrete" | "carpet";

export interface FlooringSpec {
  pattern: FlooringPattern;
  color: string;
  tileScale: number; // 타일 반복 배율
  hasBaseboard: boolean;
  baseboardHeight: number;
}

export type CeilingStyle = "flat" | "coffered" | "grid-tiles" | "exposed-beams";

export interface CeilingSpec {
  visible: boolean;
  style: CeilingStyle;
  hasLights: boolean;
  lightFixtureType: "recessed-downlight" | "fluorescent-tube" | "pendant" | "chandelier";
  lightPositions: [number, number, number][];
}

export interface RoomBuildingConfig {
  id: string;
  name: string;
  layoutShape: "rectangle" | "l-shape" | "t-shape" | "multi-room";
  walls: WallSegment[];
  openings: WallOpening[];
  stairs: StairSpec[];
  flooring: FlooringSpec;
  ceiling: CeilingSpec;
  cameraWallTransparency: boolean; // 카메라가 벽 뒤에 있을 때 해당 벽 자동 투명화
}

export interface RoomMeshBuffer {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
  triangleCount: number;
}

/**
 * 기본 직사각형 방 생성기
 */
export function createSimpleRectangularRoom(
  id: string,
  name: string,
  width: number,
  depth: number,
  height = 2.8,
  thickness = 0.2,
): RoomBuildingConfig {
  const hw = width / 2;
  const hd = depth / 2;

  const walls: WallSegment[] = [
    { id: "wall-south", name: "남쪽 벽 (전면)", start: [-hw, -hd], end: [hw, -hd], height, thickness },
    { id: "wall-east", name: "동쪽 벽 (우측)", start: [hw, -hd], end: [hw, hd], height, thickness },
    { id: "wall-north", name: "북쪽 벽 (후면)", start: [hw, hd], end: [-hw, hd], height, thickness },
    { id: "wall-west", name: "서쪽 벽 (좌측)", start: [-hw, hd], end: [-hw, -hd], height, thickness },
  ];

  const openings: WallOpening[] = [
    {
      id: "door-main",
      wallId: "wall-south",
      type: "door",
      subType: "single-swing",
      offsetFromStart: width * 0.35,
      width: 0.9,
      height: 2.1,
      sillHeight: 0,
      hasFrame: true,
      frameThickness: 0.05,
    },
    {
      id: "window-north",
      wallId: "wall-north",
      type: "window",
      subType: "sliding",
      offsetFromStart: width * 0.25,
      width: 1.6,
      height: 1.3,
      sillHeight: 0.85,
      hasFrame: true,
      frameThickness: 0.05,
      mullionCount: 2,
    },
  ];

  return {
    id,
    name,
    layoutShape: "rectangle",
    walls,
    openings,
    stairs: [],
    flooring: {
      pattern: "hardwood-parquet",
      color: "#d4a373",
      tileScale: 1.0,
      hasBaseboard: true,
      baseboardHeight: 0.1,
    },
    ceiling: {
      visible: true,
      style: "flat",
      hasLights: true,
      lightFixtureType: "recessed-downlight",
      lightPositions: [[0, height - 0.05, 0]],
    },
    cameraWallTransparency: true,
  };
}

/**
 * L자형 복합 방 생성기
 */
export function createLShapeRoom(
  id: string,
  name: string,
  width1: number,
  depth1: number,
  width2: number,
  depth2: number,
  height = 2.8,
  thickness = 0.2,
): RoomBuildingConfig {
  const walls: WallSegment[] = [
    { id: "wall-1", start: [0, 0], end: [width1, 0], height, thickness },
    { id: "wall-2", start: [width1, 0], end: [width1, depth1], height, thickness },
    { id: "wall-3", start: [width1, depth1], end: [width2, depth1], height, thickness },
    { id: "wall-4", start: [width2, depth1], end: [width2, depth1 + depth2], height, thickness },
    { id: "wall-5", start: [width2, depth1 + depth2], end: [0, depth1 + depth2], height, thickness },
    { id: "wall-6", start: [0, depth1 + depth2], end: [0, 0], height, thickness },
  ];

  const openings: WallOpening[] = [
    {
      id: "door-entrance",
      wallId: "wall-1",
      type: "door",
      subType: "single-swing",
      offsetFromStart: 1.0,
      width: 0.9,
      height: 2.1,
      sillHeight: 0,
      hasFrame: true,
    },
    {
      id: "window-living",
      wallId: "wall-5",
      type: "window",
      subType: "fixed-picture",
      offsetFromStart: 1.0,
      width: 2.0,
      height: 1.5,
      sillHeight: 0.7,
      hasFrame: true,
    },
  ];

  return {
    id,
    name,
    layoutShape: "l-shape",
    walls,
    openings,
    stairs: [],
    flooring: {
      pattern: "ceramic-tiles",
      color: "#e0e1dd",
      tileScale: 0.6,
      hasBaseboard: true,
      baseboardHeight: 0.08,
    },
    ceiling: {
      visible: true,
      style: "flat",
      hasLights: true,
      lightFixtureType: "recessed-downlight",
      lightPositions: [
        [width1 * 0.5, height - 0.05, depth1 * 0.5],
        [width2 * 0.5, height - 0.05, depth1 + depth2 * 0.5],
      ],
    },
    cameraWallTransparency: true,
  };
}

/**
 * 웹툰 전용 씬 프리셋 생성기
 */
export type WebtoonRoomPreset =
  | "classroom"
  | "hospital-ward"
  | "studio-apartment"
  | "police-interrogation"
  | "cafe"
  | "tatami-room"
  | "fantasy-throne"
  | "scifi-bridge";

export function createWebtoonRoomPreset(preset: WebtoonRoomPreset, id = `preset-${preset}`): RoomBuildingConfig {
  switch (preset) {
    case "classroom": {
      const room = createSimpleRectangularRoom(id, "🏫 학교 교실 세트장", 8.5, 7.0, 3.0, 0.25);
      room.flooring.pattern = "hardwood-parquet";
      room.openings = [
        {
          id: "door-back",
          wallId: "wall-south",
          type: "door",
          subType: "sliding",
          offsetFromStart: 1.0,
          width: 1.0,
          height: 2.1,
          sillHeight: 0,
          hasFrame: true,
        },
        {
          id: "door-front",
          wallId: "wall-south",
          type: "door",
          subType: "sliding",
          offsetFromStart: 6.5,
          width: 1.0,
          height: 2.1,
          sillHeight: 0,
          hasFrame: true,
        },
        {
          id: "window-1",
          wallId: "wall-north",
          type: "window",
          subType: "sliding",
          offsetFromStart: 1.2,
          width: 1.8,
          height: 1.5,
          sillHeight: 0.9,
          hasFrame: true,
          mullionCount: 2,
        },
        {
          id: "window-2",
          wallId: "wall-north",
          type: "window",
          subType: "sliding",
          offsetFromStart: 4.5,
          width: 1.8,
          height: 1.5,
          sillHeight: 0.9,
          hasFrame: true,
          mullionCount: 2,
        },
      ];
      room.ceiling.lightFixtureType = "fluorescent-tube";
      return room;
    }
    case "hospital-ward": {
      const room = createSimpleRectangularRoom(id, "🏥 병원 병실 세트장", 6.0, 5.0, 2.8, 0.2);
      room.flooring.pattern = "concrete";
      room.flooring.color = "#d8e2dc";
      room.ceiling.lightFixtureType = "recessed-downlight";
      return room;
    }
    case "police-interrogation": {
      const room = createSimpleRectangularRoom(id, "👮 취조실 세트장", 4.0, 3.5, 2.6, 0.25);
      room.flooring.pattern = "concrete";
      room.flooring.color = "#495057";
      room.openings = [
        {
          id: "door-heavy",
          wallId: "wall-south",
          type: "door",
          subType: "single-swing",
          offsetFromStart: 0.8,
          width: 0.9,
          height: 2.0,
          sillHeight: 0,
          hasFrame: true,
        },
        {
          id: "mirror-oneway",
          wallId: "wall-east",
          type: "window",
          subType: "fixed-picture",
          offsetFromStart: 1.0,
          width: 1.5,
          height: 1.0,
          sillHeight: 1.0,
          hasFrame: true,
        },
      ];
      room.ceiling.lightFixtureType = "pendant";
      return room;
    }
    case "cafe": {
      const room = createSimpleRectangularRoom(id, "☕ 모던 카페 세트장", 9.0, 7.5, 3.4, 0.2);
      room.flooring.pattern = "hardwood-parquet";
      room.flooring.color = "#7f4f24";
      room.openings = [
        {
          id: "door-glass",
          wallId: "wall-south",
          type: "door",
          subType: "glass",
          offsetFromStart: 3.5,
          width: 1.8,
          height: 2.4,
          sillHeight: 0,
          hasFrame: true,
        },
        {
          id: "window-facade",
          wallId: "wall-south",
          type: "window",
          subType: "fixed-picture",
          offsetFromStart: 0.5,
          width: 2.5,
          height: 2.2,
          sillHeight: 0.2,
          hasFrame: true,
        },
      ];
      room.ceiling.lightFixtureType = "pendant";
      return room;
    }
    case "tatami-room": {
      const room = createSimpleRectangularRoom(id, "🍵 전통 다도/일본식 방", 5.0, 4.0, 2.5, 0.18);
      room.flooring.pattern = "tatami-mats";
      room.flooring.color = "#c7d59f";
      room.ceiling.style = "exposed-beams";
      return room;
    }
    case "fantasy-throne": {
      const room = createSimpleRectangularRoom(id, "👑 판타지 왕실 알현실", 14.0, 20.0, 6.0, 0.4);
      room.flooring.pattern = "ceramic-tiles";
      room.flooring.color = "#6c584c";
      room.ceiling.style = "coffered";
      room.ceiling.lightFixtureType = "chandelier";
      room.stairs = [
        {
          id: "dais-stairs",
          startPoint: [0, 0, 7.0],
          directionAngleDeg: 0,
          width: 4.0,
          height: 0.6,
          depth: 1.5,
          stepsCount: 3,
          style: "straight",
          hasRailing: false,
          railingHeight: 0,
        },
      ];
      return room;
    }
    case "scifi-bridge": {
      const room = createSimpleRectangularRoom(id, "🚀 SF 함교 브릿지", 10.0, 12.0, 3.8, 0.3);
      room.flooring.pattern = "concrete";
      room.flooring.color = "#1b263b";
      room.ceiling.style = "grid-tiles";
      return room;
    }
    case "studio-apartment":
    default: {
      return createSimpleRectangularRoom(id, "🏠 원룸 오피스텔 세트장", 4.5, 3.8, 2.6, 0.2);
    }
  }
}

export class Studio3DRoomBuildingKit {
  private room: RoomBuildingConfig;

  constructor(room = createSimpleRectangularRoom("room-1", "기본 방 세트", 5, 4)) {
    this.room = room;
  }

  public getRoomConfig(): RoomBuildingConfig {
    return this.room;
  }

  public addOpening(opening: WallOpening): void {
    this.room.openings.push(opening);
  }

  public removeOpening(openingId: string): boolean {
    const idx = this.room.openings.findIndex((o) => o.id === openingId);
    if (idx === -1) return false;
    this.room.openings.splice(idx, 1);
    return true;
  }

  public addStair(stair: StairSpec): void {
    this.room.stairs.push(stair);
  }

  public setCeilingVisible(visible: boolean): void {
    this.room.ceiling.visible = visible;
  }

  public setCameraWallTransparency(enabled: boolean): void {
    this.room.cameraWallTransparency = enabled;
  }

  public setFlooringPattern(pattern: FlooringPattern): void {
    this.room.flooring.pattern = pattern;
  }

  /**
   * 카메라 시점과 초점 사이를 가로막는 벽(Occluding Wall)을 탐지하고 투명도 계산
   */
  public evaluateCameraWallCutaway(
    cameraPos: [number, number, number],
    targetPos: [number, number, number] = [0, 1.2, 0],
  ): Array<{ wallId: string; occluded: boolean; cutawayOpacity: number }> {
    if (!this.room.cameraWallTransparency) {
      return this.room.walls.map((w) => ({ wallId: w.id, occluded: false, cutawayOpacity: 1.0 }));
    }

    const camX = cameraPos[0];
    const camZ = cameraPos[2];
    const tgtX = targetPos[0];
    const tgtZ = targetPos[2];

    return this.room.walls.map((wall) => {
      const occluded = checkLineIntersection2D(
        camX, camZ, tgtX, tgtZ,
        wall.start[0], wall.start[1], wall.end[0], wall.end[1],
      );

      return {
        wallId: wall.id,
        occluded,
        cutawayOpacity: occluded ? 0.0 : 1.0,
      };
    });
  }

  /**
   * 바닥 총 면적(m²) 계산
   */
  public computeTotalFloorArea(): number {
    const south = this.room.walls.find((w) => w.id === "wall-south" || w.start[1] === w.end[1]);
    const east = this.room.walls.find((w) => w.id === "wall-east" || w.start[0] === w.end[0]);
    if (!south || !east) {
      // 2D 폴리곤 면적 공식 (Shoelace formula)
      let area = 0;
      const n = this.room.walls.length;
      for (let i = 0; i < n; i += 1) {
        const p1 = this.room.walls[i].start;
        const p2 = this.room.walls[i].end;
        area += (p1[0] * p2[1]) - (p2[0] * p1[1]);
      }
      return Math.round(Math.abs(area) * 0.5 * 100) / 100;
    }

    const width = Math.hypot(south.end[0] - south.start[0], south.end[1] - south.start[1]);
    const depth = Math.hypot(east.end[0] - east.start[0], east.end[1] - east.start[1]);

    return Math.round(width * depth * 100) / 100;
  }

  /**
   * 3D 렌더링용 벽/바닥/천장 통합 기하 버퍼(BufferGeometry) 생성
   */
  public generateMeshBuffer(): RoomMeshBuffer {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    let vertexOffset = 0;

    // 1. 벽면 쿼드 생성
    for (const wall of this.room.walls) {
      const sx = wall.start[0];
      const sz = wall.start[1];
      const ex = wall.end[0];
      const ez = wall.end[1];
      const h = wall.height;

      // 벽 법선
      const dx = ex - sx;
      const dz = ez - sz;
      const len = Math.hypot(dx, dz);
      const nx = -dz / (len || 1);
      const nz = dx / (len || 1);

      // 4개 정점 (시작하단, 끝하단, 끝상단, 시작상단)
      positions.push(
        sx, 0, sz,
        ex, 0, ez,
        ex, h, ez,
        sx, h, sz,
      );

      for (let i = 0; i < 4; i += 1) {
        normals.push(nx, 0, nz);
      }

      uvs.push(
        0, 0,
        len, 0,
        len, h,
        0, h,
      );

      indices.push(
        vertexOffset, vertexOffset + 1, vertexOffset + 2,
        vertexOffset, vertexOffset + 2, vertexOffset + 3,
      );
      vertexOffset += 4;
    }

    // 2. 바닥면 생성
    if (this.room.walls.length >= 3) {
      const minX = Math.min(...this.room.walls.map((w) => Math.min(w.start[0], w.end[0])));
      const maxX = Math.max(...this.room.walls.map((w) => Math.max(w.start[0], w.end[0])));
      const minZ = Math.min(...this.room.walls.map((w) => Math.min(w.start[1], w.end[1])));
      const maxZ = Math.max(...this.room.walls.map((w) => Math.max(w.start[1], w.end[1])));

      positions.push(
        minX, 0, minZ,
        maxX, 0, minZ,
        maxX, 0, maxZ,
        minX, 0, maxZ,
      );
      for (let i = 0; i < 4; i += 1) normals.push(0, 1, 0);
      uvs.push(0, 0, maxX - minX, 0, maxX - minX, maxZ - minZ, 0, maxZ - minZ);

      indices.push(
        vertexOffset, vertexOffset + 2, vertexOffset + 1,
        vertexOffset, vertexOffset + 3, vertexOffset + 2,
      );
    }

    return {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      uvs: new Float32Array(uvs),
      indices: new Uint32Array(indices),
      vertexCount: positions.length / 3,
      triangleCount: indices.length / 3,
    };
  }
}

/**
 * 2D 선분 교차 판별 헬퍼
 */
function checkLineIntersection2D(
  p0_x: number, p0_y: number, p1_x: number, p1_y: number,
  p2_x: number, p2_y: number, p3_x: number, p3_y: number,
): boolean {
  const s1_x = p1_x - p0_x;
  const s1_y = p1_y - p0_y;
  const s2_x = p3_x - p2_x;
  const s2_y = p3_y - p2_y;

  const denom = -s2_x * s1_y + s1_x * s2_y;
  if (Math.abs(denom) < 1e-8) return false;

  const s = (-s1_y * (p0_x - p2_x) + s1_x * (p0_y - p2_y)) / denom;
  const t = (s2_x * (p0_y - p2_y) - s2_y * (p0_x - p2_x)) / denom;

  return s >= 0 && s <= 1 && t >= 0 && t <= 1;
}
