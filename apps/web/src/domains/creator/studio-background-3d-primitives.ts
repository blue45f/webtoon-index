// "3D 배경" 블록아웃 도구의 Three.js 런타임 헬퍼 모음(스폰 규칙·지오메트리).
// React/three.js JSX와 분리해 두면 StudioBackground3D.tsx가 렌더링/상호작용에만 집중할 수 있고,
// 장면 모델 로직을 단위 테스트하기도 쉬워진다.
import * as THREE from "three";

import { PRIMITIVE_DEFS, type BgPrimitive, type BgPrimitiveKind } from "./studio-background-3d-metadata";

// 기존 import 경로의 공개 API를 유지하되, 새 경량 모듈을 직접 import하는 caller는 Three.js를
// 정적 그래프에 포함하지 않는다.
export {
  encodeBg3dSceneHash,
  parseBg3dSceneFromDataUrl,
  parseStudio3dTool,
  PRIMITIVE_DEFS,
  type Bg3dSceneMetadata,
  type BgPrimitive,
  type BgPrimitiveDef,
  type BgPrimitiveKind,
  type BgSceneState,
  type Studio3dTool,
} from "./studio-background-3d-metadata";

const BG3D_EXPORT_HEIGHT = 640;
const BG3D_FALLBACK_EXPORT_WIDTH = 640;

export function uid(): string {
  return `bg3d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// 반복 추가 시 새 도형이 매번 원점에 완전히 겹쳐 쌓이지 않도록 x축으로 결정적 지터를 준다.
// 물리 기반 배치가 아니라 "찾기 쉬운 위치에 떨어뜨려 준다" 수준의 단순 나열이며,
// 새로 추가된 도형은 곧바로 선택돼 TransformControls가 붙으므로 정확한 위치는 사용자가 드래그로 잡는다.
export function createPrimitive(kind: BgPrimitiveKind, existingCount: number): BgPrimitive {
  const def = PRIMITIVE_DEFS[kind];
  const offsetX = (existingCount % 5) * 0.8;
  return {
    id: uid(),
    kind,
    position: [offsetX, def.position[1], def.position[2]],
    rotation: [...def.rotation],
    scale: [...def.scale],
    color: def.color,
  };
}

export function duplicatePrimitive(prim: BgPrimitive): BgPrimitive {
  return {
    ...prim,
    id: uid(),
    position: [prim.position[0] + 0.4, prim.position[1], prim.position[2] + 0.4],
    // 복제본은 편집 가능·표시 상태로 둔다(잠긴 원본을 복제해 곧바로 못 움직이는 함정 방지).
    locked: false,
    visible: prim.visible !== false,
  };
}

// undo/redo 스냅샷용 깊은 복제. BgPrimitive는 배열/문자열/숫자만 갖는 평평한 구조라
// JSON 왕복보다 필드별 스프레드가 더 저렴하다.
export function clonePrimitives(primitives: BgPrimitive[]): BgPrimitive[] {
  return primitives.map((p) => ({
    ...p,
    position: [...p.position] as [number, number, number],
    rotation: [...p.rotation] as [number, number, number],
    scale: [...p.scale] as [number, number, number],
    name: p.name,
    visible: p.visible,
    locked: p.locked,
    parentId: p.parentId,
  }));
}

export function makeGeometry(kind: BgPrimitiveKind): THREE.BufferGeometry {
  switch (kind) {
    case "box":
      return new THREE.BoxGeometry(1, 1, 1);
    case "cylinder":
      return new THREE.CylinderGeometry(0.3, 0.3, 1, 16);
    case "plane":
      return new THREE.PlaneGeometry(1, 1);
    case "sphere":
      return new THREE.SphereGeometry(0.5, 24, 16);
    case "hemisphere":
      // SphereGeometry의 thetaLength를 절반(π)으로 잘라 위쪽 반구만 남긴다 — 돔 지붕용.
      return new THREE.SphereGeometry(0.5, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    case "cone":
      return new THREE.ConeGeometry(0.4, 1, 24);
    case "pyramid":
      // radialSegments=4인 원뿔 = 밑면이 정사각형인 각뿔.
      return new THREE.ConeGeometry(0.5, 1, 4);
    case "triangularPrism":
      // radialSegments=3인 원기둥 = 삼각기둥. 눕혀서 회전시키면 지붕 경사면으로 쓰기 좋다.
      return new THREE.CylinderGeometry(0.5, 0.5, 1, 3);
    case "hexPrism":
      return new THREE.CylinderGeometry(0.5, 0.5, 1, 6);
    case "torus":
      return new THREE.TorusGeometry(0.4, 0.15, 12, 24);
    case "tube":
      // openEnded 원기둥 — 속이 빈 파이프 실루엣(선화 추출 시 안쪽 테두리도 함께 드러난다).
      return new THREE.CylinderGeometry(0.4, 0.4, 1, 24, 1, true);
    case "ring":
      return new THREE.RingGeometry(0.2, 0.5, 32);
    case "capsule":
      return new THREE.CapsuleGeometry(0.3, 0.7, 8, 16);
  }
}

export function roundExportSize(canvas: HTMLCanvasElement): { width: number; height: number } {
  if (canvas.width <= 0 || canvas.height <= 0) {
    return { width: BG3D_FALLBACK_EXPORT_WIDTH, height: BG3D_EXPORT_HEIGHT };
  }
  const aspect = canvas.width / canvas.height;
  return { width: Math.round(BG3D_EXPORT_HEIGHT * aspect), height: BG3D_EXPORT_HEIGHT };
}
