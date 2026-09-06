/**
 * Studio 3D Parametric Room Builder 2.0 & Auto Cutaway Engine (SketchUp / Homestyler Benchmark).
 * Generates room layouts with door/window punch-out framing, and computes auto-cutaway for camera sightlines.
 */

export interface RoomWall {
  readonly id: "north" | "south" | "east" | "west";
  readonly position: readonly [number, number, number];
  readonly size: readonly [number, number, number]; // width, height, thickness
  readonly openings: readonly WallOpening[];
}

export interface WallOpening {
  readonly id: string;
  readonly type: "door" | "window";
  readonly offsetAlongWall: number; // distance from wall start
  readonly width: number;
  readonly height: number;
  readonly elevation: number; // height from floor
}

export interface RoomSpecV2 {
  readonly width: number; // meters (X)
  readonly depth: number; // meters (Z)
  readonly height: number; // meters (Y)
  readonly wallThickness: number;
  readonly hasCeiling: boolean;
  readonly hasFloor: boolean;
  readonly openings: readonly {
    readonly wall: "north" | "south" | "east" | "west";
    readonly opening: WallOpening;
  }[];
}

export interface WebtoonRoomArchetype {
  readonly id: string;
  readonly name: string;
  readonly category: "school" | "commercial" | "urban" | "fantasy" | "medical";
  readonly description: string;
  readonly dimensions: { readonly width: number; readonly depth: number; readonly height: number };
  readonly keyProps: readonly string[];
}

export const WEBTOON_ROOM_ARCHETYPES: readonly WebtoonRoomArchetype[] = Object.freeze([
  {
    id: "archetype-classroom",
    name: "고등학교 교실 (Anime Classroom)",
    category: "school",
    description: "칠판, 교탁, 2인 1조 책걸상 배열 및 대형 채광창이 있는 전형적인 학원물 교실",
    dimensions: { width: 9.0, depth: 7.5, height: 3.2 },
    keyProps: ["blackboard", "teacher-podium", "student-desks", "lockers", "large-windows"],
  },
  {
    id: "archetype-rooftop",
    name: "한국식 옥상 (Webtoon Rooftop)",
    category: "urban",
    description: "초록색 우레탄 방수 바닥, 원형 물탱크, 빨랫줄, 난간이 있는 청춘/학원물 명소",
    dimensions: { width: 12.0, depth: 10.0, height: 1.2 },
    keyProps: ["green-waterproof-floor", "cylindrical-water-tank", "metal-railing", "ac-outdoor-units"],
  },
  {
    id: "archetype-cafe",
    name: "감성 베이커리 카페 (Cozy Cafe)",
    category: "commercial",
    description: "에스프레소 바 카운터, 팬던트 조명, 통창 유리, 2인 티테이블이 어우러진 로맨스 배경",
    dimensions: { width: 8.5, depth: 6.0, height: 3.5 },
    keyProps: ["espresso-bar", "counter-stools", "pendant-lights", "wooden-tables", "glass-facade"],
  },
  {
    id: "archetype-office",
    name: "현대식 기획사 오피스 (Modern Office)",
    category: "commercial",
    description: "파티션 데스크, 유리 회의실, 화이트보드, 정수기 코너가 있는 오피스물 세트",
    dimensions: { width: 14.0, depth: 9.0, height: 2.8 },
    keyProps: ["office-cubicles", "ergonomic-chairs", "glass-meeting-room", "whiteboard"],
  },
  {
    id: "archetype-hospital",
    name: "종합병원 1인 병실 (Hospital Ward)",
    category: "medical",
    description: "조절식 환자 침대, 링거 수액 걸이대, 커튼 레일, 심전도 모니터가 있는 병동",
    dimensions: { width: 5.5, depth: 4.5, height: 2.8 },
    keyProps: ["hospital-bed", "iv-pole", "medical-monitor", "bedside-cabinet", "curtain-track"],
  },
  {
    id: "archetype-throne-room",
    name: "황궁 알현실 (Imperial Throne Room)",
    category: "fantasy",
    description: "대리석 기둥, 붉은 카펫 런웨이, 고딕 아치형 스테인드글라스 창문과 황금 옥좌",
    dimensions: { width: 16.0, depth: 22.0, height: 8.0 },
    keyProps: ["marble-columns", "red-carpet", "golden-throne", "stained-glass-arches", "chandeliers"],
  },
]);

/**
 * Calculates wall segments, positions, and openings for a room.
 */
export function buildParametricRoom(spec: RoomSpecV2): {
  readonly walls: readonly RoomWall[];
  readonly floor: { readonly size: readonly [number, number] };
  readonly ceiling?: { readonly size: readonly [number, number] };
} {
  const halfW = spec.width / 2;
  const halfD = spec.depth / 2;
  const halfH = spec.height / 2;
  const t = spec.wallThickness;

  const walls: RoomWall[] = [
    {
      id: "north",
      position: [0, halfH, -halfD],
      size: [spec.width, spec.height, t],
      openings: spec.openings.filter((o) => o.wall === "north").map((o) => o.opening),
    },
    {
      id: "south",
      position: [0, halfH, halfD],
      size: [spec.width, spec.height, t],
      openings: spec.openings.filter((o) => o.wall === "south").map((o) => o.opening),
    },
    {
      id: "east",
      position: [halfW, halfH, 0],
      size: [t, spec.height, spec.depth],
      openings: spec.openings.filter((o) => o.wall === "east").map((o) => o.opening),
    },
    {
      id: "west",
      position: [-halfW, halfH, 0],
      size: [t, spec.height, spec.depth],
      openings: spec.openings.filter((o) => o.wall === "west").map((o) => o.opening),
    },
  ];

  return {
    walls: Object.freeze(walls),
    floor: { size: [spec.width, spec.depth] },
    ceiling: spec.hasCeiling ? { size: [spec.width, spec.depth] } : undefined,
  };
}

/**
 * Evaluates Auto-Cutaway: determines which walls obstruct the camera's view of the interior target.
 */
export function evaluateAutoCutawayWalls(options: {
  readonly cameraPosition: readonly [number, number, number];
  readonly focusPoint: readonly [number, number, number];
  readonly roomWidth: number;
  readonly roomDepth: number;
}): {
  readonly cutawayWallIds: ReadonlySet<"north" | "south" | "east" | "west">;
} {
  const { cameraPosition, focusPoint, roomWidth, roomDepth } = options;
  const cutaway = new Set<"north" | "south" | "east" | "west">();

  const halfW = roomWidth / 2;
  const halfD = roomDepth / 2;

  const [camX, , camZ] = cameraPosition;
  const [focX, , focZ] = focusPoint;

  // If camera is outside South wall (+Z) looking North towards interior
  if (camZ > halfD && focZ < camZ) {
    cutaway.add("south");
  }
  // If camera is outside North wall (-Z) looking South towards interior
  if (camZ < -halfD && focZ > camZ) {
    cutaway.add("north");
  }
  // If camera is outside East wall (+X) looking West towards interior
  if (camX > halfW && focX < camX) {
    cutaway.add("east");
  }
  // If camera is outside West wall (-X) looking East towards interior
  if (camX < -halfW && focX > camX) {
    cutaway.add("west");
  }

  return {
    cutawayWallIds: Object.freeze(cutaway),
  };
}
