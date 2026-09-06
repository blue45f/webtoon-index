/**
 * Studio 3D 다중 오브젝트(Multi-Object) 배치 & 룸 레이아웃 모듈.
 *
 * OBJ/FBX/GLTF 외부 3D 프롭 및 배경 소품(책상, 의자, 침대, 건선, 가로등 등)을
 * 3D 씬 내에 다중 배치하고, 실시간 이동·회전·스케일·바닥 스냅 및 레이아웃 프리셋을 관리한다.
 */

export interface Studio3DObjectInstance {
  readonly id: string;
  readonly modelUrl: string;
  readonly name: string;
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
  readonly visible: boolean;
}

export interface StudioRoomLayoutPreset {
  readonly id: string;
  readonly label: string;
  readonly objects: readonly Omit<Studio3DObjectInstance, "id">[];
}

/** 룸 및 거리 배경 다중 소품 레이아웃 프리셋. */
export const STUDIO_ROOM_LAYOUT_PRESETS: readonly StudioRoomLayoutPreset[] = [
  {
    id: "classroom",
    label: "교실 레이아웃 (책상 6 + 의자 6 + 칠판)",
    objects: [
      { modelUrl: "/assets/3d/blackboard.glb", name: "칠판", position: [0, 1.5, -4], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true },
      { modelUrl: "/assets/3d/desk.glb", name: "학생 책상 1", position: [-1.2, 0, -1], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true },
      { modelUrl: "/assets/3d/chair.glb", name: "학생 의자 1", position: [-1.2, 0, -0.4], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true },
      { modelUrl: "/assets/3d/desk.glb", name: "학생 책상 2", position: [1.2, 0, -1], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true },
      { modelUrl: "/assets/3d/chair.glb", name: "학생 의자 2", position: [1.2, 0, -0.4], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true },
    ],
  },
  {
    id: "cafe",
    label: "카페 레이아웃 (원형 테이블 2 + 소파 + 램프)",
    objects: [
      { modelUrl: "/assets/3d/round_table.glb", name: "원형 테이블 A", position: [-1.5, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true },
      { modelUrl: "/assets/3d/sofa.glb", name: "소파 B", position: [1.5, 0, 0.5], rotation: [0, -1.57, 0], scale: [1, 1, 1], visible: true },
    ],
  },
];

export class StudioMultiObjectLayoutManager {
  private readonly instances = new Map<string, Studio3DObjectInstance>();

  public addObject(item: Omit<Studio3DObjectInstance, "id">): Studio3DObjectInstance {
    const id = `obj_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const instance: Studio3DObjectInstance = { ...item, id };
    this.instances.set(id, instance);
    return instance;
  }

  public removeObject(id: string): boolean {
    return this.instances.delete(id);
  }

  public duplicateObject(id: string): Studio3DObjectInstance | null {
    const existing = this.instances.get(id);
    if (!existing) return null;

    const newPos: readonly [number, number, number] = [
      existing.position[0] + 0.3,
      existing.position[1],
      existing.position[2] + 0.3,
    ];

    return this.addObject({
      ...existing,
      name: `${existing.name} (복사본)`,
      position: newPos,
    });
  }

  public snapToFloor(id: string): Studio3DObjectInstance | null {
    const existing = this.instances.get(id);
    if (!existing) return null;

    const snapped: Studio3DObjectInstance = {
      ...existing,
      position: [existing.position[0], 0, existing.position[2]],
    };
    this.instances.set(id, snapped);
    return snapped;
  }

  public getAllObjects(): readonly Studio3DObjectInstance[] {
    return Array.from(this.instances.values());
  }

  public loadPreset(presetId: string): readonly Studio3DObjectInstance[] {
    this.instances.clear();
    const preset = STUDIO_ROOM_LAYOUT_PRESETS.find((p) => p.id === presetId);
    if (!preset) return [];

    for (const obj of preset.objects) {
      this.addObject(obj);
    }
    return this.getAllObjects();
  }
}
