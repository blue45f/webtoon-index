import { describe, expect, it } from "vitest";

import { PRIMITIVE_DEFS, type BgPrimitiveKind } from "../studio-background-3d-metadata";

import {
  buildStudioBg3dRoomParts,
  clampStudioBg3dRoomSpec,
  getStudioBg3dRoomPreset,
  instantiateStudioBg3dRoomBuild,
  layoutStudioBg3dWallSegments,
  STUDIO_BG3D_ROOM_LIMITS,
  STUDIO_BG3D_ROOM_PRESETS,
  STUDIO_BG3D_ROOM_WALL_IDS,
  type StudioBg3dRoomSpec,
  type StudioBg3dWallSegment,
} from "./studio-bg3d-room-builder";

const VALID_KINDS = new Set(Object.keys(PRIMITIVE_DEFS) as BgPrimitiveKind[]);

function segmentArea(segments: readonly StudioBg3dWallSegment[]): number {
  return segments.reduce((sum, segment) => sum + segment.lengthU * segment.height, 0);
}

/** 세그먼트가 [l, r]×[b, t] 사각형과 면적을 공유하는지(경계 접촉은 허용). */
function overlapsRect(
  segment: StudioBg3dWallSegment,
  rect: { l: number; r: number; b: number; t: number },
): boolean {
  const sl = segment.centerU - segment.lengthU / 2;
  const sr = segment.centerU + segment.lengthU / 2;
  const sb = segment.centerY - segment.height / 2;
  const st = segment.centerY + segment.height / 2;
  const e = 1e-9;
  return sl < rect.r - e && sr > rect.l + e && sb < rect.t - e && st > rect.b + e;
}

describe("layoutStudioBg3dWallSegments", () => {
  it("오프닝이 없으면 벽 전체를 덮는 세그먼트 1개를 만든다", () => {
    const segments = layoutStudioBg3dWallSegments(8, 3, []);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual({ centerU: 0, centerY: 1.5, lengthU: 8, height: 3 });
  });

  it("문 1개는 [좌 벽체 | 인방 | 우 벽체] 3세그먼트로 쪼개고 문 구멍은 비운다", () => {
    const door = { centerOffset: 1, width: 1, height: 2.1, sillHeight: 0 };
    const segments = layoutStudioBg3dWallSegments(8, 3, [door]);
    expect(segments).toHaveLength(3);
    // 좌측 벽체: [-4, 0.5] 전체 높이
    expect(segments[0]).toEqual({ centerU: -1.75, centerY: 1.5, lengthU: 4.5, height: 3 });
    // 인방(문 위): [0.5, 1.5] × [2.1, 3]
    expect(segments[1].centerU).toBeCloseTo(1, 10);
    expect(segments[1].centerY).toBeCloseTo(2.55, 10);
    expect(segments[1].height).toBeCloseTo(0.9, 10);
    // 우측 벽체
    expect(segments[2]).toEqual({ centerU: 2.75, centerY: 1.5, lengthU: 2.5, height: 3 });
    // 문 구멍([0.5,1.5]×[0,2.1])에는 어떤 세그먼트도 침범하지 않는다.
    for (const segment of segments) {
      expect(overlapsRect(segment, { l: 0.5, r: 1.5, b: 0, t: 2.1 })).toBe(false);
    }
  });

  it("창문은 창턱(sill) 세그먼트가 추가되어 4세그먼트가 된다", () => {
    const window = { centerOffset: 0, width: 1.5, height: 1.1, sillHeight: 1 };
    const segments = layoutStudioBg3dWallSegments(6, 3, [window]);
    expect(segments).toHaveLength(4);
    const sill = segments.find((segment) => segment.centerY < 1 && segment.lengthU === 1.5);
    expect(sill).toEqual({ centerU: 0, centerY: 0.5, lengthU: 1.5, height: 1 });
    const header = segments.find((segment) => segment.centerY > 2 && segment.lengthU === 1.5);
    expect(header).toBeDefined();
    expect(header!.centerY).toBeCloseTo(2.55, 10);
    expect(header!.height).toBeCloseTo(0.9, 10);
    for (const segment of segments) {
      expect(overlapsRect(segment, { l: -0.75, r: 0.75, b: 1, t: 2.1 })).toBe(false);
    }
  });

  it("면적이 보존된다: 세그먼트 합 = 벽 면적 − 오프닝 면적", () => {
    const openings = [
      { centerOffset: -2, width: 0.9, height: 2.1, sillHeight: 0 },
      { centerOffset: 1.5, width: 1.5, height: 1.1, sillHeight: 1 },
    ];
    const segments = layoutStudioBg3dWallSegments(10, 3, openings);
    const openingArea = 0.9 * 2.1 + 1.5 * 1.1;
    expect(segmentArea(segments)).toBeCloseTo(10 * 3 - openingArea, 10);
  });

  it("겹치는 오프닝은 먼저 온 것을 남기고 결정적으로 탈락시킨다", () => {
    const first = { centerOffset: 0, width: 2, height: 2, sillHeight: 0 };
    const overlapping = { centerOffset: 0.5, width: 2, height: 1, sillHeight: 1 };
    const segments = layoutStudioBg3dWallSegments(8, 3, [first, overlapping]);
    // first만 반영: 좌·인방·우 3세그먼트
    expect(segments).toHaveLength(3);
    expect(segmentArea(segments)).toBeCloseTo(8 * 3 - 2 * 2, 10);
  });

  it("벽 밖으로 나가는 오프닝은 통째로 무시된다", () => {
    const outside = { centerOffset: 3.9, width: 1, height: 2, sillHeight: 0 };
    const segments = layoutStudioBg3dWallSegments(8, 3, [outside]);
    expect(segments).toHaveLength(1);
    expect(segmentArea(segments)).toBeCloseTo(24, 10);
  });
});

describe("clampStudioBg3dRoomSpec", () => {
  it("빈 입력에서 항상 유효한 기본 스펙을 만든다", () => {
    const spec = clampStudioBg3dRoomSpec(undefined);
    expect(spec.width).toBeGreaterThanOrEqual(STUDIO_BG3D_ROOM_LIMITS.minWidth);
    expect(spec.wallHeight).toBeGreaterThan(0);
    expect(spec.openings).toEqual([]);
    expect(spec.furniture).toEqual([]);
  });

  it("치수·색·오프닝을 한도 안으로 눌러 담는다", () => {
    const spec = clampStudioBg3dRoomSpec({
      width: 999,
      depth: -5,
      wallHeight: Number.NaN,
      wallThickness: 99,
      floorColor: "javascript:alert(1)",
      wallColor: "#ABCDEF",
      openings: [
        { wall: "north", type: "door", centerOffset: 999, width: 999, height: 999, sillHeight: 5 },
        { wall: "nope" as never, type: "door", centerOffset: 0, width: 1, height: 2, sillHeight: 0 },
      ],
      furniture: [
        { kind: "table", x: 999, z: -999, yawDeg: 9_999 },
        { kind: "chandelier" as never, x: 0, z: 0, yawDeg: 0 },
      ],
    });
    expect(spec.width).toBe(STUDIO_BG3D_ROOM_LIMITS.maxWidth);
    expect(spec.depth).toBe(STUDIO_BG3D_ROOM_LIMITS.minDepth);
    expect(spec.wallThickness).toBe(STUDIO_BG3D_ROOM_LIMITS.maxWallThickness);
    expect(spec.floorColor).toMatch(/^#[0-9a-f]{6}$/u);
    expect(spec.wallColor).toBe("#abcdef");
    expect(spec.openings).toHaveLength(1);
    const opening = spec.openings[0];
    expect(opening.type).toBe("door");
    expect(opening.sillHeight).toBe(0);
    expect(opening.width).toBeLessThanOrEqual(spec.width - STUDIO_BG3D_ROOM_LIMITS.openingEdgeMargin * 2);
    expect(opening.height).toBeLessThanOrEqual(spec.wallHeight - STUDIO_BG3D_ROOM_LIMITS.openingHeadMargin);
    expect(spec.furniture).toHaveLength(1);
    expect(spec.furniture[0].x).toBe(spec.width / 2);
    expect(spec.furniture[0].z).toBe(-spec.depth / 2);
  });
});

describe("buildStudioBg3dRoomParts", () => {
  const baseSpec: Partial<StudioBg3dRoomSpec> = {
    width: 6,
    depth: 5,
    wallHeight: 2.8,
    wallThickness: 0.2,
    openings: [],
    furniture: [],
  };

  it("빈 방은 바닥 1 + 벽 4 = 5파츠이며 배치가 정확하다", () => {
    const parts = buildStudioBg3dRoomParts(baseSpec);
    expect(parts).toHaveLength(5);
    const floor = parts[0];
    expect(floor.name).toBe("바닥");
    // 바닥 윗면이 y=0
    expect(floor.position[1] + floor.scale[1] / 2).toBeCloseTo(0, 10);
    const north = parts.find((part) => part.name.startsWith("뒷벽"))!;
    expect(north.position[2]).toBeCloseTo(-2.5, 10);
    expect(north.scale).toEqual([6, 2.8, 0.2]);
    const east = parts.find((part) => part.name.startsWith("오른벽"))!;
    expect(east.position[0]).toBeCloseTo(3, 10);
    expect(east.scale).toEqual([0.2, 2.8, 5]);
    // 벽 중심 y = 높이 절반(바닥 위에 선다)
    for (const wall of parts.slice(1)) {
      expect(wall.position[1]).toBeCloseTo(1.4, 10);
    }
  });

  it("남벽 문 오프닝의 +오프셋은 '안에서 볼 때 오른쪽'(-X)으로 간다", () => {
    const parts = buildStudioBg3dRoomParts({
      ...baseSpec,
      openings: [{ wall: "south", type: "door", centerOffset: 1.5, width: 1, height: 2, sillHeight: 0 }],
    });
    // 남벽 파츠: 좌 벽체·인방·우 벽체 3개
    const southParts = parts.filter((part) => part.name.startsWith("앞벽"));
    expect(southParts).toHaveLength(3);
    // 방 안(원점)에서 +Z 남벽을 바라보면 오른쪽 = -X. 문 중심 world x = -1.5.
    const header = southParts.find((part) => part.position[1] > 2)!;
    expect(header.position[0]).toBeCloseTo(-1.5, 10);
    expect(header.position[2]).toBeCloseTo(2.5, 10);
    // 문 구멍(worldX ∈ [-2, -1], y ∈ [0, 2])을 침범하는 남벽 파츠가 없어야 한다.
    for (const part of southParts) {
      const left = part.position[0] - part.scale[0] / 2;
      const right = part.position[0] + part.scale[0] / 2;
      const bottom = part.position[1] - part.scale[1] / 2;
      const top = part.position[1] + part.scale[1] / 2;
      const intersects = left < -1 - 1e-9 && right > -2 + 1e-9 && bottom < 2 - 1e-9 && top > 0 + 1e-9;
      expect(intersects).toBe(false);
    }
  });

  it("가구 yaw 회전은 오프셋을 함께 돌린다(의자 등받이 180°)", () => {
    const forward = buildStudioBg3dRoomParts({ ...baseSpec, furniture: [{ kind: "chair", x: 1, z: 1, yawDeg: 0 }] });
    const turned = buildStudioBg3dRoomParts({ ...baseSpec, furniture: [{ kind: "chair", x: 1, z: 1, yawDeg: 180 }] });
    const forwardBack = forward.find((part) => part.name === "의자 등받이")!;
    const turnedBack = turned.find((part) => part.name === "의자 등받이")!;
    expect(forwardBack.position[2]).toBeCloseTo(1 - 0.18, 10);
    expect(turnedBack.position[2]).toBeCloseTo(1 + 0.18, 10);
    expect(turnedBack.position[0]).toBeCloseTo(1, 10);
    expect(turnedBack.rotation[1]).toBeCloseTo(Math.PI, 10);
  });

  it("계단은 단수만큼 겹침 없는 층층 박스를 만들고 마지막 단이 가장 높다", () => {
    const parts = buildStudioBg3dRoomParts({ ...baseSpec, furniture: [{ kind: "stairs", x: 0, z: 0, yawDeg: 0 }] });
    const steps = parts.filter((part) => part.name.startsWith("계단"));
    expect(steps).toHaveLength(6);
    const tops = steps.map((step) => step.position[1] + step.scale[1] / 2);
    for (let index = 1; index < tops.length; index += 1) {
      expect(tops[index]).toBeGreaterThan(tops[index - 1]);
    }
    expect(tops.at(-1)).toBeCloseTo(1.2, 10);
    // 모든 단은 바닥에서 시작한다(층층 박스 규약).
    for (const step of steps) {
      expect(step.position[1] - step.scale[1] / 2).toBeCloseTo(0, 10);
    }
  });

  it("같은 스펙은 항상 같은 파츠를 만든다(결정성)", () => {
    const spec = getStudioBg3dRoomPreset("classroom")!.spec;
    expect(buildStudioBg3dRoomParts(spec)).toEqual(buildStudioBg3dRoomParts(spec));
  });
});

describe("STUDIO_BG3D_ROOM_PRESETS", () => {
  it("교실/카페/원룸/복도/옥상/서재 6종이 있고 id 조회가 동작한다", () => {
    expect(STUDIO_BG3D_ROOM_PRESETS.map((preset) => preset.id)).toEqual([
      "classroom",
      "cafe",
      "studio-flat",
      "corridor",
      "rooftop",
      "study",
    ]);
    expect(getStudioBg3dRoomPreset("cafe")?.label).toBe("카페");
    expect(getStudioBg3dRoomPreset("study")?.label).toBe("서재");
    expect(getStudioBg3dRoomPreset("unknown")).toBeNull();
    expect(getStudioBg3dRoomPreset(42)).toBeNull();
  });

  it("모든 프리셋은 clamp 고정점이고, 선언한 오프닝이 전부 벽 안에 실제로 반영된다", () => {
    for (const preset of STUDIO_BG3D_ROOM_PRESETS) {
      expect(clampStudioBg3dRoomSpec(preset.spec)).toEqual(preset.spec);
      const parts = buildStudioBg3dRoomParts(preset.spec);
      expect(parts.length).toBeGreaterThan(4);
      for (const part of parts) {
        expect(VALID_KINDS.has(part.kind)).toBe(true);
        expect(part.position.every(Number.isFinite)).toBe(true);
        expect(part.scale.every((value) => Number.isFinite(value) && value > 0)).toBe(true);
        expect(part.color).toMatch(/^#[0-9a-f]{6}$/u);
      }
      // 오프닝이 하나도 탈락하지 않았는지: 벽별 세그먼트 면적으로 역산한다.
      for (const wall of STUDIO_BG3D_ROOM_WALL_IDS) {
        const wallLength = wall === "north" || wall === "south" ? preset.spec.width : preset.spec.depth;
        const openings = preset.spec.openings.filter((opening) => opening.wall === wall);
        const segments = layoutStudioBg3dWallSegments(wallLength, preset.spec.wallHeight, openings);
        const openingArea = openings.reduce((sum, opening) => sum + opening.width * opening.height, 0);
        expect(segmentArea(segments)).toBeCloseTo(
          wallLength * preset.spec.wallHeight - openingArea,
          6,
        );
      }
    }
  });
});

describe("instantiateStudioBg3dRoomBuild", () => {
  it("주입한 idFactory로 완전 결정적인 BgPrimitive[]를 만들고 X 오프셋 규약을 따른다", () => {
    let counter = 0;
    const idFactory = () => `room-${counter++}`;
    const spec = getStudioBg3dRoomPreset("studio-flat")!.spec;
    const first = instantiateStudioBg3dRoomBuild(spec, 0, idFactory);
    expect(first[0].id).toBe("room-0");
    expect(new Set(first.map((primitive) => primitive.id)).size).toBe(first.length);
    // existingCount=0이면 오프셋 없음
    expect(first[0].position[0]).toBeCloseTo(0, 10);
    // existingCount>0이면 씬 템플릿과 같은 width/6 비례 오프셋
    const shifted = instantiateStudioBg3dRoomBuild(spec, 12, () => `s-${counter++}`);
    expect(shifted[0].position[0] - first[0].position[0]).toBeCloseTo(12 * (spec.width / 6), 10);
    // 이름이 파츠 이름으로 채워져 레이어 목록에서 읽힌다.
    expect(first[0].name).toBe("바닥");
  });
});
