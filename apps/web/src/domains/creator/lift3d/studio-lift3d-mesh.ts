/**
 * Studio Lift 3D — 마스크와 깊이장을 실제 편집 가능 메시로 굳히는 단계.
 *
 * 두 가지 위상을 만든다.
 *
 * - `inflate`: 앞껍질 + 뒤껍질. 실루엣 테두리 정점은 **하나를 공유**해서 두 껍질이 그 선에서
 *   자동으로 봉합된다. 별도 옆벽(rim wall)을 세우지 않으므로 두께 0 인 퇴화 사각형이 생기지
 *   않고, 결과가 곧바로 닫힌 solid 가 된다.
 * - `relief`: 변위된 앞면 + 평평한 뒷판 + 두 면을 잇는 옆벽. 배경 원화처럼 뒤가 보이지 않는
 *   부조에 쓴다.
 *
 * 결과 메시는 저장소의 정식 편집 권위 포맷(`StudioEditableMesh`)이라 DCC 편집·GLB 내보내기·
 * 기존 진단 도구를 그대로 태울 수 있다.
 */

import {
  STUDIO_EDITABLE_MESH_LIMITS,
  createStudioEditableMeshFromPolygons,
  type StudioEditableMesh,
} from "../studio-editable-half-edge-mesh";

import {
  clampStudioLift3dUnit,
  studioLift3dFailure,
  studioLift3dSuccess,
  studioLift3dWarning,
  type StudioLift3dGeometryMode,
  type StudioLift3dResult,
  type StudioLift3dUv,
  type StudioLift3dVec3,
  type StudioLift3dWarning,
} from "./studio-lift3d-contract";
import {
  STUDIO_LIFT3D_MAX_DEPTH_BANDS,
  buildStudioLift3dDepthBands,
  clampStudioLift3dBandCount,
  studioLift3dBandBuckets,
} from "./studio-lift3d-depth";

import type { StudioLift3dDepthBand, StudioLift3dDepthField } from "./studio-lift3d-depth";
import type { StudioLift3dMask } from "./studio-lift3d-mask";

/** 내부 정점의 최소 두께 비율. 0 이면 앞뒤 껍질이 겹쳐 부피가 사라진다. */
const MIN_INTERIOR_HEIGHT = 0.05;
/**
 * 실루엣 테두리의 최소 두께 비율.
 *
 * 앞뒤 껍질을 테두리에서 **같은 정점으로 봉합**하던 이전 방식은 얇은 부위에서 깨졌다. 폭이
 * 사각형 두 칸뿐인 팔·꼬리·머리카락은 모든 정점이 테두리라, 이웃한 두 사각형이 공유하는 변을
 * 앞뒤가 똑같은 정점쌍으로 잡아 half-edge 가 네 번 쓰인다(비다양체). 지금은 테두리도 앞뒤를
 * 각각 두고 그 사이를 옆벽으로 막는다 — 얇든 두껍든 위상이 같은 방식으로 닫힌다.
 */
const MIN_RIM_HEIGHT = 0.03;
/**
 * 코너(= 면 루프 길이의 합) 예산. `createStudioEditableMeshFromPolygons` 의 preflight 는
 * 코너 합을 `maxEdges` 와 비교하므로, 사각형만 쓰는 이 빌더의 실질 상한은 면 125,000개다.
 * 면 개수만 보고 통과시키면 그 preflight 가 사유 코드 대신 예외를 던진다.
 */
const QUAD_CORNERS = 4;

export interface StudioLift3dGeometryOptions {
  readonly mode: StudioLift3dGeometryMode;
  /** 피사체 최대 변 대비 두께 비율(0..1). inflate 에서는 전체 두께, relief 에서는 돌출 깊이. */
  readonly depthScale: number;
  /** relief 뒷판 두께(같은 비율 기준). */
  readonly baseScale?: number;
  /**
   * 전체 두께 중 앞쪽이 가져갈 비율(0..1, 기본 0.5).
   *
   * 정면을 보는 캐릭터는 가슴이 등보다 더 나온다. 0.5 를 넘기면 그 비대칭을 만들 수 있고,
   * 총 두께는 바뀌지 않는다. `inflate` 에서만 의미가 있다.
   */
  readonly frontRatio?: number;
  /** `parallax` 에서 쌓을 깊이 밴드 수(기본 6). 1~24 의 **정수**. */
  readonly layerBands?: number;
  /** 완성 모델의 세로 높이(scene unit). 캐릭터 1.7 = 사람 키. */
  readonly targetHeight: number;
}

export interface StudioLift3dGeometry {
  readonly mesh: StudioEditableMesh;
  /** `mesh.vertices` 와 인덱스가 1:1 로 맞는 UV. 원화가 그대로 베이스컬러가 된다. */
  readonly uvs: readonly StudioLift3dUv[];
  readonly bounds: { readonly min: StudioLift3dVec3; readonly max: StudioLift3dVec3 };
  readonly quadCount: number;
  /** 서로 떨어진 조각 수. `parallax` 가 아니면 1 이다. */
  readonly layerCount: number;
  readonly mode: StudioLift3dGeometryMode;
}

interface FaceGrid {
  readonly present: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly droppedPinches: number;
}

/**
 * 사각형 격자를 세우고, 대각선으로만 이어진 꼬집힘(pinch)을 없앤다.
 *
 * 정점 하나를 사이에 두고 대각 방향 두 사각형만 존재하면 그 정점 주변 면이 두 개의 팬으로
 * 갈라져 non-manifold 가 된다. glTF 로는 나가지만 CSG·섭디비전·법선 계산이 전부 어긋나므로
 * 한 쪽 면을 떨어뜨려 위상을 지킨다.
 */
/** 2×2 셀이 모두 피사체인 자리에만 사각형이 선다. */
function facePresenceFromCells(
  cells: Uint8Array,
  gridWidth: number,
  gridHeight: number,
): Uint8Array {
  const width = gridWidth - 1;
  const height = gridHeight - 1;
  const present = new Uint8Array(Math.max(0, width * height));
  for (let j = 0; j < height; j += 1) {
    for (let i = 0; i < width; i += 1) {
      const a = cells[j * gridWidth + i]!;
      const b = cells[j * gridWidth + i + 1]!;
      const c = cells[(j + 1) * gridWidth + i + 1]!;
      const d = cells[(j + 1) * gridWidth + i]!;
      present[j * width + i] = a === 1 && b === 1 && c === 1 && d === 1 ? 1 : 0;
    }
  }
  return present;
}

/** 대각으로만 이어진 사각형 하나를 떨어뜨려 위상을 지킨다. 떨어뜨린 개수를 돌려준다. */
function removeFacePinches(present: Uint8Array, gridWidth: number, gridHeight: number): number {
  const width = gridWidth - 1;
  let droppedPinches = 0;
  for (let y = 1; y < gridHeight - 1; y += 1) {
    for (let x = 1; x < gridWidth - 1; x += 1) {
      const nw = present[(y - 1) * width + (x - 1)]!;
      const ne = present[(y - 1) * width + x]!;
      const sw = present[y * width + (x - 1)]!;
      const se = present[y * width + x]!;
      if (nw === 1 && se === 1 && ne === 0 && sw === 0) {
        present[y * width + x] = 0;
        droppedPinches += 1;
      } else if (ne === 1 && sw === 1 && nw === 0 && se === 0) {
        present[y * width + (x - 1)] = 0;
        droppedPinches += 1;
      }
    }
  }
  return droppedPinches;
}

function faceGridFromPresence(
  present: Uint8Array,
  gridWidth: number,
  gridHeight: number,
): FaceGrid {
  return {
    present,
    width: gridWidth - 1,
    height: gridHeight - 1,
    droppedPinches: removeFacePinches(present, gridWidth, gridHeight),
  };
}

function buildFaceGrid(cells: Uint8Array, gridWidth: number, gridHeight: number): FaceGrid {
  return faceGridFromPresence(facePresenceFromCells(cells, gridWidth, gridHeight), gridWidth, gridHeight);
}

/**
 * 사각형 네 개에 모두 둘러싸인 정점(=안쪽 정점)이 하나라도 있는지.
 *
 * 없으면 실루엣이 어디서나 두 칸 이하라 모든 정점이 테두리다. 그때 앞뒤 두께는 정점마다
 * `MIN_RIM_HEIGHT` 로 같아, `frontRatio` 는 두 껍질을 통째로 z 로 평행이동시킬 뿐 형태를
 * 바꾸지 못한다. 그 평행이동은 `normalizeStudioLift3dPositions` 의 z 중심 맞추기가 곧바로
 * 되돌린다 — 나눌 부피가 애초에 없기 때문이다.
 */
function hasInteriorVertex(grid: FaceGrid): boolean {
  for (let y = 1; y < grid.height; y += 1) {
    for (let x = 1; x < grid.width; x += 1) {
      if (grid.present[(y - 1) * grid.width + (x - 1)] === 1
        && grid.present[(y - 1) * grid.width + x] === 1
        && grid.present[y * grid.width + (x - 1)] === 1
        && grid.present[y * grid.width + x] === 1) {
        return true;
      }
    }
  }
  return false;
}

/** 정점이 속한 사각형 개수. 4 면 내부, 1~3 이면 껍질 경계, 0 이면 미사용. */
function faceDegree(grid: FaceGrid, x: number, y: number): number {
  let degree = 0;
  const has = (i: number, j: number): boolean => (
    i >= 0 && j >= 0 && i < grid.width && j < grid.height && grid.present[j * grid.width + i] === 1
  );
  if (has(x - 1, y - 1)) degree += 1;
  if (has(x, y - 1)) degree += 1;
  if (has(x - 1, y)) degree += 1;
  if (has(x, y)) degree += 1;
  return degree;
}

/**
 * 격자 하나가 방출할 사각형 수를 **방출 전에** 정확히 센다.
 *
 * `emitStudioLift3dShell` 과 같은 규칙이다 — 살아남은 사각형마다 앞뒤 2개, 이웃 사각형이 없는
 * 변마다 옆벽 1개. 시차 레이어는 밴드가 몇 개로 잘리느냐에 따라 옆벽 총량이 크게 달라져
 * 해상도만으로는 예산을 예측할 수 없다(밴드가 잘게 번갈아 나오는 원화는 옆벽이 면적에 비례한다).
 * 여기서 먼저 세면 정점 배열을 수십만 개 쌓은 뒤에야 예산 초과를 알리는 일이 없다.
 */
function countShellQuads(grid: FaceGrid): number {
  const has = (i: number, j: number): boolean => (
    i >= 0 && j >= 0 && i < grid.width && j < grid.height && grid.present[j * grid.width + i] === 1
  );
  let quads = 0;
  for (let j = 0; j < grid.height; j += 1) {
    for (let i = 0; i < grid.width; i += 1) {
      if (grid.present[j * grid.width + i] === 0) continue;
      quads += 2;
      if (!has(i - 1, j)) quads += 1;
      if (!has(i, j + 1)) quads += 1;
      if (!has(i + 1, j)) quads += 1;
      if (!has(i, j - 1)) quads += 1;
    }
  }
  return quads;
}

interface Accumulator {
  readonly positions: StudioLift3dVec3[];
  readonly uvs: StudioLift3dUv[];
  readonly faces: number[][];
}

function pushVertex(
  accumulator: Accumulator,
  x: number,
  y: number,
  z: number,
  u: number,
  v: number,
): number {
  accumulator.positions.push({ x, y, z });
  accumulator.uvs.push({ u, v });
  return accumulator.positions.length - 1;
}

/**
 * 레이어 `layerBands` 장을 쌓을 때 코너 예산 안에 들어오는 작업 격자 한 변의 상한.
 *
 * **상한이 아니라 보정값이다.** 실제 비용은 밴드 수가 아니라 밴드 경계의 **길이**로 정해지는데,
 * 그 길이는 원화를 리샘플하기 전에는 알 수 없다. 한 밴드가 여러 조각으로 흩어지면 경계는
 * 밴드 수와 무관하게 길어진다 — 측정하면 대각 줄무늬 깊이는 밴드 2 개에서도 n=204 가 한계다.
 * 예산을 실제로 지키는 것은 `countStudioLift3dPlannedQuads` 의 정확한 사전 집계이고, 이 값은
 * 흔한 입력에서 두 슬라이더의 최대값이 함께 통하도록 맞춰 둔 것뿐이다.
 *
 * 매끄러운 깊이를 기준으로 잡는다. 카드는 마스크 사각형을 **나눠 갖지 겹쳐 갖지 않으므로**
 * 앞뒤 껍질은 밴드 수와 무관하게 2u² 이고, 밴드 수에 비례하는 것은 옆벽뿐이라 4uB 안팎이다.
 * 사각형 하나가 코너 4개를 쓰니 8u² + 16uB ≤ maxEdges 를 푼다.
 *
 *   u ≤ −B + √(B² + maxEdges/8)
 *
 * B=1 이면 249 라 `maxResolution`(248) 이 그대로 남고, B=24 에서 228 이다. 측정한 실제 한계와
 * 맞는다 — 같은 조건에서 세로 그라데이션 238, 동심 고리 228. 잡음이 많은 깊이는 이 값을 넘지
 * 못하지만, 그때는 사전 집계가 `budget-exceeded` 로 두 손잡이를 함께 짚어 준다.
 *
 * 밴드 수는 지오메트리와 **같은 함수**로 조인다. 여기서만 원값을 쓰면 24 를 넘는 요청이
 * 필요 없이 해상도를 깎고, `Number.MAX_VALUE` 근처에서는 4B² 가 Infinity 로 넘쳐 식이 NaN 이
 * 되어 상한 자체가 무시된다.
 */
export function maxStudioLift3dResolutionForLayers(layerBands: number): number {
  const bands = clampStudioLift3dBandCount(layerBands);
  const quarter = STUDIO_EDITABLE_MESH_LIMITS.maxEdges / 8;
  const span = -bands + Math.sqrt(bands * bands + quarter);
  return Math.max(2, Math.floor(span) + 1);
}

function estimatedVertexBudget(mask: StudioLift3dMask): number {
  let inside = 0;
  for (let index = 0; index < mask.cells.length; index += 1) inside += mask.cells[index]!;
  return inside * 2;
}

interface ShellContext {
  readonly gridWidth: number;
  readonly gridHeight: number;
  readonly centerX: number;
  readonly centerY: number;
  readonly uScale: number;
  readonly vScale: number;
}

/** 한 샘플 점의 앞/뒤 z. `rim` 은 이 점이 껍질 경계에 닿아 있는지다. */
type ShellDepthAt = (key: number, rim: boolean) => readonly [number, number];

/**
 * 사각형 격자 하나를 앞면 + 뒷면 + 옆벽으로 굳혀 누산기에 덧붙인다.
 *
 * 세 모드가 이 한 벌을 공유한다. 셸을 여러 번 부르면(시차 밴드) 서로 떨어진 조각들이 한
 * 메시 안에 함께 담긴다 — 조각끼리는 정점을 나누지 않으므로 각자 닫힌 solid 로 남는다.
 */
function emitStudioLift3dShell(
  accumulator: Accumulator,
  context: ShellContext,
  grid: FaceGrid,
  depthAt: ShellDepthAt,
): number {
  const { gridWidth, gridHeight, centerX, centerY, uScale, vScale } = context;
  const frontIndex = new Int32Array(gridWidth * gridHeight).fill(-1);
  const backIndex = new Int32Array(gridWidth * gridHeight).fill(-1);

  for (let y = 0; y < gridHeight; y += 1) {
    for (let x = 0; x < gridWidth; x += 1) {
      const key = y * gridWidth + x;
      const degree = faceDegree(grid, x, y);
      if (degree === 0) continue;
      const worldX = x - centerX;
      const worldY = centerY - y;
      const u = (x + 0.5) * uScale;
      const v = (y + 0.5) * vScale;
      const [frontZ, backZ] = depthAt(key, degree < 4);
      frontIndex[key] = pushVertex(accumulator, worldX, worldY, frontZ, u, v);
      backIndex[key] = pushVertex(accumulator, worldX, worldY, backZ, u, v);
    }
  }

  const corner = (x: number, y: number): number => y * gridWidth + x;
  const hasFace = (i: number, j: number): boolean => (
    i >= 0 && j >= 0 && i < grid.width && j < grid.height && grid.present[j * grid.width + i] === 1
  );
  let quadCount = 0;

  for (let j = 0; j < grid.height; j += 1) {
    for (let i = 0; i < grid.width; i += 1) {
      if (grid.present[j * grid.width + i] === 0) continue;
      const a = corner(i, j);
      const b = corner(i + 1, j);
      const c = corner(i + 1, j + 1);
      const d = corner(i, j + 1);
      // +Z 에서 봤을 때 CCW: 좌상 → 좌하 → 우하 → 우상.
      accumulator.faces.push([frontIndex[a]!, frontIndex[d]!, frontIndex[c]!, frontIndex[b]!]);
      // 뒷면은 −Z 를 향해야 하므로 같은 루프를 뒤집는다.
      accumulator.faces.push([backIndex[a]!, backIndex[b]!, backIndex[c]!, backIndex[d]!]);
      quadCount += 2;

      // 껍질 경계(이웃 사각형이 없는 변)를 옆벽으로 막는다. 앞면 CCW 루프 a→d→c→b 의 각 변과,
      // 그 변 너머 이웃 사각형.
      const edges: readonly (readonly [number, number, boolean])[] = [
        [a, d, hasFace(i - 1, j)],
        [d, c, hasFace(i, j + 1)],
        [c, b, hasFace(i + 1, j)],
        [b, a, hasFace(i, j - 1)],
      ];
      for (const [from, to, shared] of edges) {
        if (shared) continue;
        // 바깥을 향하도록: 앞(from) → 뒤(from) → 뒤(to) → 앞(to).
        accumulator.faces.push([
          frontIndex[from]!,
          backIndex[from]!,
          backIndex[to]!,
          frontIndex[to]!,
        ]);
        quadCount += 1;
      }
    }
  }
  return quadCount;
}

/** 꼬집힘을 옮겨 풀 때 도는 최대 횟수. 한 번 옮기면 다른 자리가 생길 수 있어 몇 번 반복한다. */
const PINCH_RELOCATION_PASSES = 4;

/**
 * 마스크 사각형을 밴드에 **하나씩** 나눠 준다 — 겹치지도, 빠지지도 않는 분할.
 *
 * 네 꼭짓점의 밴드가 갈리는 경계 사각형은 **가장 앞 밴드**(번호 최대)가 가져간다. 앞 카드의
 * 실루엣이 온전해지고, 뒤 카드는 그만큼만 물러난다 — 가까운 물체가 먼 물체를 가리는 실제
 * 순서와 같다.
 *
 * 예전에는 각 밴드를 한 칸 부풀려 경계 사각형을 양쪽에 다 넣었다. 구멍은 막혔지만 깊이가 셀
 * 단위로 번갈아 나오는 원화에서 그 한 칸이 밴드를 마스크 전체로 넓혔고(체커보드 100%,
 * `(x+3y)%12` 74.5%), 불투명 카드끼리 서로를 통째로 가려 시차가 사라졌다. 분할은 그 두 가지를
 * 동시에 없앤다: 모든 마스크 사각형이 정확히 한 카드에 들어가므로 구멍도 겹침도 없다.
 *
 * 분할이 만드는 새 문제는 하나뿐이다 — 한 밴드의 사각형끼리 대각으로만 이어지는 자리(꼬집힘)가
 * 생길 수 있다. 그 사각형을 **버리면 구멍**이 되므로, 직교로 맞닿은 이웃 사각형이 속한 밴드로
 * **옮긴다**. 면 개수가 보존되니 덮임은 그대로고, 옮겨 간 쪽에서는 이웃이 생겨 꼬집히지 않는다.
 * 옮길 이웃이 아예 없는 자리만 마지막 `removeFacePinches` 가 떨어뜨리고 경고를 남긴다.
 */
export function partitionStudioLift3dBandFaces(
  mask: StudioLift3dMask,
  buckets: Int32Array,
  bandCount: number,
): readonly Uint8Array[] {
  // 버킷과 **같은 함수로** 조인다. 호출자가 둘에 다른 수를 넘기면 배열 길이가 어긋나
  // 밴드 번호가 배열 밖을 가리킬 수 있다.
  const bands = clampStudioLift3dBandCount(bandCount);
  const gridWidth = mask.width;
  const gridHeight = mask.height;
  const width = gridWidth - 1;
  const height = gridHeight - 1;
  const maskFaces = facePresenceFromCells(mask.cells, gridWidth, gridHeight);
  const owner = new Int32Array(Math.max(0, width * height)).fill(-1);

  for (let j = 0; j < height; j += 1) {
    for (let i = 0; i < width; i += 1) {
      const face = j * width + i;
      if (maskFaces[face] === 0) continue;
      const corners = [
        buckets[j * gridWidth + i]!,
        buckets[j * gridWidth + i + 1]!,
        buckets[(j + 1) * gridWidth + i]!,
        buckets[(j + 1) * gridWidth + i + 1]!,
      ];
      owner[face] = Math.max(...corners);
    }
  }

  for (let pass = 0; pass < PINCH_RELOCATION_PASSES; pass += 1) {
    let moved = 0;
    for (let y = 1; y < height; y += 1) {
      for (let x = 1; x < width; x += 1) {
        const nw = (y - 1) * width + (x - 1);
        const ne = (y - 1) * width + x;
        const sw = y * width + (x - 1);
        const se = y * width + x;
        // 같은 밴드가 대각으로만 마주 본 자리를 찾는다. 옮길 면과, 그 면이 갈 곳을 정한다.
        let stranded = -1;
        let orthogonal: readonly number[] = [];
        if (owner[nw] !== -1 && owner[nw] === owner[se] && owner[ne] !== owner[nw]
          && owner[sw] !== owner[nw]) {
          stranded = se;
          orthogonal = [ne, sw];
        } else if (owner[ne] !== -1 && owner[ne] === owner[sw] && owner[nw] !== owner[ne]
          && owner[se] !== owner[ne]) {
          stranded = sw;
          orthogonal = [nw, se];
        }
        if (stranded === -1) continue;
        for (const neighbour of orthogonal) {
          if (owner[neighbour] === -1) continue;
          owner[stranded] = owner[neighbour]!;
          moved += 1;
          break;
        }
      }
    }
    if (moved === 0) break;
  }

  const out: Uint8Array[] = Array.from(
    { length: bands },
    () => new Uint8Array(Math.max(0, width * height)),
  );
  for (let face = 0; face < owner.length; face += 1) {
    const band = owner[face]!;
    if (band >= 0) out[band]![face] = 1;
  }
  return out;
}

/**
 * 옆으로 맞닿았는데 z 에서 **두 층 이상** 떨어진 카드 경계를 센다.
 *
 * 카드는 이웃 카드와의 중점까지 뻗으므로 **순번이 이웃한** 카드끼리는 z 에서 맞닿는다. 그런데
 * 맞닿음은 순번으로 성립하고 갈라짐은 **위치**로 생긴다 — 옆으로 맞닿은 두 사각형이 0번과 5번
 * 카드에 속하면, 그 경계에서 1~4번 카드가 차지하는 z 구간은 아무도 채우지 않는다. 정면에서는
 * 멀쩡하다가 카메라를 돌리는 순간 그 자리가 틈으로 벌어진다.
 *
 * 빈 밴드가 이미 버려진 뒤의 **순번**으로 세야 한다. 밴드 번호로 세면 절벽처럼 중간 밴드가
 * 통째로 빈 원화가 전부 걸리는데, 그런 원화는 카드 두 장이 순번상 이웃이라 실제로는 맞닿는다.
 *
 * 분모는 인접 사각형 **전부**가 아니라 **카드가 갈리는 경계**(`crossings`)다. 한 카드 안쪽
 * 경계까지 세면 분모가 해상도의 제곱으로 늘고 균열 길이는 한 제곱만 늘어, 화면을 세로로 가르는
 * 균열조차 해상도를 올릴수록 비율이 내려간다 — 지오메트리는 그대로인데 경고만 조용해진다.
 * 실측으로도 그랬다: 절벽 원화의 전체 높이 균열이 전체 쌍 대비로는 해상도 64 에서 0.78%,
 * 160 에서 0.31% 로 **임계 아래로 가라앉는데**, 카드 경계 대비로는 91.0% → 96.3% 로 눕는다.
 *
 * 카드는 방출 순서(= z 순서)대로, **면을 내지 못한 밴드는 빼고** 와야 한다. 배열 순서가 곧
 * 순번이다. `partitionStudioLift3dBandFaces` 가 돌려준 존재 배열을 그대로 받는다.
 */
export function countStudioLift3dCardDepthGaps(
  cards: readonly Uint8Array[],
  width: number,
  height: number,
): { readonly crossings: number; readonly gaps: number; readonly maxGap: number } {
  if (width < 1 || height < 1) return { crossings: 0, gaps: 0, maxGap: 0 };
  const owner = new Int32Array(width * height).fill(-1);
  for (let index = 0; index < cards.length; index += 1) {
    const present = cards[index]!;
    for (let face = 0; face < present.length; face += 1) {
      if (present[face] === 1) owner[face] = index;
    }
  }
  let crossings = 0;
  let gaps = 0;
  let maxGap = 0;
  const visit = (here: number, there: number): void => {
    if (there < 0 || here === there) return;
    crossings += 1;
    const distance = Math.abs(here - there);
    if (distance < 2) return;
    gaps += 1;
    if (distance > maxGap) maxGap = distance;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const here = owner[y * width + x]!;
      if (here < 0) continue;
      // 오른쪽·아래만 본다. 네 방향을 다 보면 같은 경계를 두 번 센다.
      if (x + 1 < width) visit(here, owner[y * width + x + 1]!);
      if (y + 1 < height) visit(here, owner[(y + 1) * width + x]!);
    }
  }
  return { crossings, gaps, maxGap };
}

/**
 * 틈을 경고로 올릴 최소 비율.
 *
 * 카드 경계 중 **틈으로 벌어진 경계**의 비율이다. **실제로 예산 안에 들어오는 설정**에서 쟀다 —
 * 배경 프리셋의 기본 해상도 224 는 잔결이 고운 원화에서 6층부터 예산 초과로 아예 실패하므로,
 * 그 구간 수치로 임계를 잡으면 만들어질 수 없는 설정에 맞춘 값이 된다.
 *
 * | 잔결 있는 숲 | 4층 | 6층 | 8층 | 12층 | 16층 | 24층 |
 * | --- | --- | --- | --- | --- | --- | --- |
 * | 해상도 64 | 0% | 3.1% | 15.5% | 44.3% | 60.7% | 73.5% |
 * | 해상도 96 | 0% | 0.3% | 5.4% | 28.1% | 47.4% | 65.9% |
 * | 해상도 128 | 0% | 0% | 0.1% | 15.7% | 35.0% | 57.6% |
 * | 해상도 160 | 0% | 0% | 0.0% | 4.8% | 22.2% | 49.0% |
 *
 * 매끄러운 배경은 어느 칸에서도 0% 이고, 화면을 세로로 가르는 절벽은 6층에서 91~96% 다. 즉 이
 * 값은 원화의 성질이 아니라 **층수·해상도가 원화의 깊이 잔결과 맞는지**를 잰다. 0.3% 아래는
 * 경계 몇 줄이라 눈에 띄지 않고, 몇 %대부터 카메라를 돌릴 때 실제로 갈라져 보인다. 1% 는 그
 * 사이다.
 *
 * 층수는 어느 원화에서도 듣는다(내리면 비율이 단조롭게 내려간다). 해상도는 잔결이 고운 원화의
 * 표본화 부족을 풀어 주지만 원화에 진짜 단차가 있는 절벽에서는 듣지 않으므로, 문구도 그 둘을
 * 같은 무게로 말하지 않는다.
 */
const DEPTH_GAP_WARNING_RATIO = 0.01;

interface PlannedShell {
  readonly grid: FaceGrid;
  readonly depthAt: ShellDepthAt;
}

interface PlannedGrids {
  readonly grids: readonly FaceGrid[];
  readonly bands: readonly StudioLift3dDepthBand[];
  /** 빈 밴드를 버리기 **전** 개수. 카드 두께와 간격이 같은 수에서 나와야 한다. */
  readonly bandCount: number;
}

/**
 * 방출할 격자를 세운다. 정점은 아직 만들지 않는다.
 *
 * 시차는 밴드마다 독립된 카드를 쌓는다. 한 파일 안에서 서로 떨어져 있으므로 카메라가
 * 움직이면 층이 다른 속도로 흐르고, DCC 로 가져가 층별로 분리하기도 쉽다.
 */
function planStudioLift3dShellGrids(
  mask: StudioLift3dMask,
  depth: StudioLift3dDepthField,
  mode: StudioLift3dGeometryMode,
  layerBands: number | undefined,
): PlannedGrids {
  if (mode !== "parallax") {
    return {
      grids: [buildFaceGrid(mask.cells, mask.width, mask.height)],
      bands: [],
      bandCount: 1,
    };
  }
  const bandCount = clampStudioLift3dBandCount(layerBands ?? 6);
  // 카드는 셀이 아니라 **면**으로 나눈다. 셀 집합에서 사각형을 다시 따면 경계 사각형이 어느
  // 밴드에도 들어가지 못해 구멍이 생기고, 그걸 부풀리기로 막으면 카드가 서로를 가린다.
  const buckets = studioLift3dBandBuckets(mask, depth, bandCount);
  const faces = partitionStudioLift3dBandFaces(mask, buckets, bandCount);
  const bands = buildStudioLift3dDepthBands(mask, depth, bandCount);
  // 밴드 번호로 맞춘다 — 빈 밴드가 빠진 `bands` 와 면 배열의 순서가 어긋나면 카드가 엉뚱한
  // 깊이에 놓인다.
  const grids: FaceGrid[] = [];
  const placed: StudioLift3dDepthBand[] = [];
  for (const band of bands) {
    grids.push(faceGridFromPresence(faces[band.index]!, mask.width, mask.height));
    placed.push(band);
  }
  return { grids, bands: placed, bandCount };
}

/**
 * 방출하면 나올 사각형 수. **정점을 하나도 만들기 전에** 정확히 센다.
 *
 * 해상도 상한(`maxStudioLift3dResolutionForLayers`)은 밴드 경계 길이가 O(uB) 라는 가정 위에
 * 서 있다. 밴드가 화면 전체에서 잘게 번갈아 나오는 원화는 옆벽이 면적에 비례해 그 가정을
 * 깨뜨린다. 그런 입력도 격자 단계에서 걸러야 수십만 개를 쌓은 뒤에야 예산 초과를 알리는 일이
 * 없다. 화면이 예산을 미리 보여줄 때도 이 값을 쓴다.
 */
export function countStudioLift3dPlannedQuads(
  mask: StudioLift3dMask,
  depth: StudioLift3dDepthField,
  options: Pick<StudioLift3dGeometryOptions, "mode" | "layerBands">,
): number {
  const planned = planStudioLift3dShellGrids(mask, depth, options.mode, options.layerBands);
  let quads = 0;
  for (const grid of planned.grids) quads += countShellQuads(grid);
  return quads;
}

/** 사각형 수가 편집 메시의 면·코너 예산을 넘는지. 사각형 하나가 코너 4개를 쓴다. */
function exceedsFaceBudget(quads: number): boolean {
  return quads > STUDIO_EDITABLE_MESH_LIMITS.maxFaces
    || quads * QUAD_CORNERS > STUDIO_EDITABLE_MESH_LIMITS.maxEdges;
}

/**
 * 마스크·깊이장을 삼각형화 이전의 사각형 메시로 굳힌다.
 *
 * 좌표계: 이미지 x 는 월드 +X, 이미지 y 는 월드 −Y(위가 +Y), 두께는 ±Z.
 * 앞면 사각형은 +Z 에서 봤을 때 CCW 가 되도록 감는다.
 */
export function buildStudioLift3dGeometry(
  mask: StudioLift3dMask,
  depth: StudioLift3dDepthField,
  options: StudioLift3dGeometryOptions,
): StudioLift3dResult<StudioLift3dGeometry> {
  if (mask.bounds === null) {
    return studioLift3dFailure("empty-subject", "실루엣을 찾지 못했습니다");
  }
  if (!Number.isFinite(options.targetHeight) || options.targetHeight <= 0) {
    return studioLift3dFailure("invalid-option", "targetHeight 는 양수여야 합니다");
  }
  // 유한성 검사를 건너뛰면 NaN 이 두께를 타고 정점 좌표까지 흘러가, 이 모듈이 약속한
  // "실패는 사유 코드로" 대신 createStudioEditableMeshFromPolygons 가 예외를 던진다.
  if (!Number.isFinite(options.depthScale) || options.depthScale < 0) {
    return studioLift3dFailure("invalid-option", "depthScale 은 0 이상의 유한한 값이어야 합니다");
  }
  // depthScale 0 이 뜻을 갖는 건 부조뿐이다 — 뒷판(baseScale)이 따로 두께를 주므로 납작한 판이
  // 나온다. inflate·parallax 는 모든 두께가 depthScale 에서 나오므로 0 이면 앞껍질과 뒷껍질이
  // 같은 평면에 겹치고 옆벽 넓이도 0 이 된다. 그런데도 "닫힌 메시" 로 보고되어 부피 0 짜리
  // GLB 가 라이브러리까지 흘러가므로, 만들기 전에 막는다.
  if (options.mode !== "relief" && options.depthScale <= 0) {
    return studioLift3dFailure(
      "invalid-option",
      "depthScale 은 0보다 커야 합니다(두께 0 은 부피 없는 메시가 됩니다)",
    );
  }
  if (options.baseScale !== undefined
    && (!Number.isFinite(options.baseScale) || options.baseScale < 0)) {
    return studioLift3dFailure("invalid-option", "baseScale 은 0 이상의 유한한 값이어야 합니다");
  }
  // clampStudioLift3dUnit 은 비유한 값을 조용히 0 으로 떨어뜨린다. 여기서 걸러내지 않으면
  // NaN 을 넣은 호출이 "앞쪽 두께 0" 이라는 엉뚱한 결과로 성공해 버린다.
  if (options.frontRatio !== undefined
    && (!Number.isFinite(options.frontRatio) || options.frontRatio < 0 || options.frontRatio > 1)) {
    return studioLift3dFailure("invalid-option", "frontRatio 는 0..1 사이의 유한한 값이어야 합니다");
  }
  // 이 함수는 파이프라인을 거치지 않고도 불릴 수 있다. clampStudioLift3dBandCount 는 비유한 값을
  // 조용히 1 로 떨어뜨리므로, 여기서 걸러내지 않으면 "카드 한 장짜리 시차 레이어" 라는 앞뒤 안
  // 맞는 결과가 parallax 로 성공해 버린다. 다른 수치 옵션과 같은 자리에서 같은 방식으로 막는다.
  // 위쪽 한도도 같이 본다. planStudioLift3dShellGrids 가 조용히 조이면 요청한 층 수와 다른
  // 결과가 성공으로 나가는데, 이 경계에는 파이프라인 같은 경고 통로를 두지 않는다 —
  // frontRatio 가 범위를 벗어날 때와 같이 거절하는 것이 이 함수의 규칙이다.
  if (options.layerBands !== undefined
    && (!Number.isInteger(options.layerBands)
      || options.layerBands < 1
      || options.layerBands > STUDIO_LIFT3D_MAX_DEPTH_BANDS)) {
    return studioLift3dFailure(
      "invalid-option",
      `layerBands 는 1~${STUDIO_LIFT3D_MAX_DEPTH_BANDS} 사이의 정수여야 합니다`,
    );
  }
  if (estimatedVertexBudget(mask) > STUDIO_EDITABLE_MESH_LIMITS.maxVertices) {
    return studioLift3dFailure("budget-exceeded", "해상도를 낮춰 주세요(정점 예산 초과)");
  }

  const warnings: StudioLift3dWarning[] = [];

  const gridWidth = mask.width;
  const gridHeight = mask.height;
  const spanX = Math.max(1, mask.bounds.maxX - mask.bounds.minX);
  const spanY = Math.max(1, mask.bounds.maxY - mask.bounds.minY);
  const thickness = Math.max(spanX, spanY) * Math.max(0, options.depthScale);
  const baseThickness = Math.max(spanX, spanY) * Math.max(0, options.baseScale ?? 0.05);
  const context: ShellContext = {
    gridWidth,
    gridHeight,
    // 정점은 작업 격자 **셀의 중심**에 놓인다. 셀 x 가 덮는 원본 열은 [x·W/gw, (x+1)·W/gw) 이므로
    // 그 중심의 정규화 좌표는 (x+0.5)/gw 다. x/(gw−1) 로 잡으면 텍스처가 gw/(gw−1) 배로 늘어나고
    // 반 칸 밀려, 낮은 해상도일수록 선화가 실루엣에서 눈에 띄게 어긋난다.
    uScale: 1 / gridWidth,
    vScale: 1 / gridHeight,
    centerX: (gridWidth - 1) / 2,
    centerY: (gridHeight - 1) / 2,
  };

  const accumulator: Accumulator = { positions: [], uvs: [], faces: [] };
  let quadCount = 0;
  let droppedPinches = 0;

  // 앞뒤를 반씩 나누는 것이 기본이지만, 정면을 보는 캐릭터는 가슴이 등보다 더 나온다.
  // frontRatio 로 그 비율을 옮겨도 총 두께는 그대로다.
  const frontRatio = clampStudioLift3dUnit(options.frontRatio ?? 0.5);
  // 격자를 먼저 다 세운다. 방출은 그 다음이다 — 실제로 나올 사각형 수를 정확히 알기 전에
  // 정점을 쌓기 시작하면, 예산 초과를 수십만 개를 만든 뒤에야 알게 된다.
  const planned = planStudioLift3dShellGrids(mask, depth, options.mode, options.layerBands);

  // 사각형을 하나도 못 만드는 껍질을 **먼저** 걸러 낸다. 밴드가 한 칸 폭 부위에만 걸리면 셀은
  // 있어도 2×2 가 안 나와 정점이 하나도 안 나간다. 그런 밴드를 세어만 두면 존재하지 않는 층이
  // 지표에 광고되고, 무엇보다 **아래 카드 깊이 계산이 그 유령을 이웃으로 삼아** 실제로는 아무도
  // 채우지 않는 z 구간을 남긴다 — 카메라를 돌리면 그 자리가 갈라진다.
  let plannedQuads = 0;
  const live: { readonly grid: FaceGrid; readonly center: number }[] = [];
  for (let index = 0; index < planned.grids.length; index += 1) {
    const grid = planned.grids[index]!;
    droppedPinches += grid.droppedPinches;
    const quads = countShellQuads(grid);
    if (quads === 0) continue;
    plannedQuads += quads;
    live.push({ grid, center: planned.bands[index]?.center ?? 0.5 });
  }

  const shells: readonly PlannedShell[] = options.mode === "parallax"
    ? live.map((entry, index) => {
      // 카드는 **이웃 카드와 맞닿는 깊이까지** 뻗는다. 얇은 판을 각자의 밴드 중앙에만 띄우면
      // 카드 사이 z 간격이 그대로 빈 공간이 되어, 정면에서는 멀쩡하다가 카메라가 좌우로
      // 돌아가는 순간 밴드 경계마다 배경이 비쳐 보인다 — 시차를 보려고 돌리는 바로 그
      // 움직임에서 갈라진다. 이웃과의 중점까지 뻗으면 층이 계단처럼 이어져 틈이 없다.
      //
      // 이웃은 **실제로 면을 내는** 카드여야 한다. 셀만 있고 면이 없는 밴드를 이웃으로 삼으면,
      // 그 밴드가 버려진 뒤 아무도 채우지 않는 z 구간이 남는다. 양 끝만 요청한 밴드 폭의
      // 절반씩 더 뻗는다.
      const halfBand = 0.5 / planned.bandCount;
      const here = entry.center;
      const previous = live[index - 1]?.center;
      const next = live[index + 1]?.center;
      const back = previous === undefined ? here - halfBand : (previous + here) / 2;
      const front = next === undefined ? here + halfBand : (here + next) / 2;
      // 이웃과 정확히 같은 값을 공유하므로 카드끼리 파고들지도, 벌어지지도 않는다.
      const span: readonly [number, number] = [
        thickness * (front - 0.5),
        thickness * (back - 0.5),
      ];
      return { grid: entry.grid, depthAt: (): readonly [number, number] => span };
    })
    : live.map((entry) => ({
      grid: entry.grid,
      depthAt: (key: number, rim: boolean): readonly [number, number] => {
        if (options.mode === "inflate") {
          // 테두리도 앞뒤를 따로 둔다. 정점을 공유하면 얇은 부위에서 비다양체가 되고
          // (MIN_RIM_HEIGHT 주석 참고), 여기서 벌려 둔 만큼이 옆벽의 폭이 된다.
          const height = rim
            ? MIN_RIM_HEIGHT
            : Math.max(MIN_INTERIOR_HEIGHT, depth.heights[key]!);
          return [thickness * frontRatio * height, -thickness * (1 - frontRatio) * height];
        }
        return [thickness * depth.heights[key]!, -baseThickness];
      },
    }));

  const layerCount = options.mode === "parallax" ? shells.length : 1;

  if (plannedQuads === 0) {
    return studioLift3dFailure("degenerate-geometry", "면을 하나도 만들지 못했습니다");
  }
  if (exceedsFaceBudget(plannedQuads)) {
    // 시차 레이어는 해상도와 레이어 수가 **함께** 예산을 먹는다. "해상도를 낮추라" 고만 하면
    // 레이어를 줄이는 쪽이 더 나은 경우에도 사용자가 그 손잡이를 못 찾는다.
    return studioLift3dFailure(
      "budget-exceeded",
      options.mode === "parallax"
        // 살아남은 층이 아니라 **요청한** 층 수를 적는다. 사용자가 돌리는 손잡이가 그것이다 —
        // 24 를 요청했는데 "8 을 낮추라" 고 하면 어디를 만져야 할지 알 수 없다.
        ? `해상도(${gridWidth}) 또는 레이어 수(${planned.bandCount})를 낮춰 주세요(면 예산 초과)`
        : "해상도를 낮춰 주세요(면 예산 초과)",
    );
  }

  for (const shell of shells) {
    quadCount += emitStudioLift3dShell(accumulator, context, shell.grid, shell.depthAt);
  }

  // 틈은 **살아남은 카드**끼리의 순번으로만 판정할 수 있으므로 여기서 센다. 격자 크기는 셀
  // 크기에서 다시 빼지 말고 격자 자신에게서 읽는다 — 어긋나면 조용히 엉뚱한 칸을 본다.
  const firstCard = options.mode === "parallax" ? live[0]?.grid : undefined;
  if (firstCard) {
    const { crossings, gaps, maxGap } = countStudioLift3dCardDepthGaps(
      live.map((entry) => entry.grid.present),
      firstCard.width,
      firstCard.height,
    );
    if (crossings > 0 && gaps / crossings >= DEPTH_GAP_WARNING_RATIO) {
      warnings.push(studioLift3dWarning(
        "layer-depth-gap",
        `옆으로 맞닿은 카드가 ${gaps}곳에서 최대 ${maxGap}층 떨어져 있습니다. `
        + "그 자리는 카메라를 돌리면 틈으로 벌어집니다 — 레이어 수를 낮추면 단차가 한 층으로 "
        + "합쳐집니다(잔결이 고운 원화라면 해상도를 올려도 듣습니다). 끊김 없는 깊이가 "
        + "필요하면 relief 위상을 쓰세요",
      ));
    }
  }

  if (droppedPinches > 0) {
    warnings.push(studioLift3dWarning(
      "pinch-faces-dropped",
      `위상이 꼬이는 대각 연결 ${droppedPinches}곳을 정리했습니다`,
    ));
  }
  // 앞쪽 두께를 옮겨 달라고 했는데 나눌 부피가 없으면 조용히 넘기지 않는다. 슬라이더를 끝까지
  // 밀어도 화면이 그대로인 이유를 사용자가 알 수 있어야 한다.
  if (options.mode === "inflate" && frontRatio !== 0.5 && !hasInteriorVertex(shells[0]!.grid)) {
    warnings.push(studioLift3dWarning(
      "front-ratio-inert",
      "실루엣이 어디서나 두 칸 이하라 앞쪽 두께 비율이 형태를 바꾸지 못합니다. 해상도를 올려 보세요",
    ));
  }

  // 예산은 위에서 이미 봤다. 이 검사는 countShellQuads 와 방출기가 어긋났을 때를 위한 그물이다 —
  // 어긋난 채로 넘기면 createStudioEditableMeshFromPolygons 가 사유 코드 대신 예외를 던진다.
  if (exceedsFaceBudget(accumulator.faces.length)) {
    return studioLift3dFailure("budget-exceeded", "해상도를 낮춰 주세요(면 예산 초과)");
  }

  const scaled = normalizeStudioLift3dPositions(accumulator.positions, options.targetHeight);
  const mesh = createStudioEditableMeshFromPolygons(scaled.positions, accumulator.faces);

  return studioLift3dSuccess(
    {
      mesh,
      uvs: Object.freeze([...accumulator.uvs]),
      bounds: scaled.bounds,
      quadCount,
      layerCount,
      mode: options.mode,
    },
    warnings,
  );
}

/**
 * 모델을 요청한 키에 맞춰 균일 스케일하고, XZ 중심·바닥(y=0) 기준으로 옮긴다.
 * bg3d 씬은 지면 위에 놓인 모델을 전제하므로 여기서 접지시켜 두면 배치가 곧바로 맞는다.
 */
export function normalizeStudioLift3dPositions(
  positions: readonly StudioLift3dVec3[],
  targetHeight: number,
): {
  readonly positions: readonly StudioLift3dVec3[];
  readonly bounds: { readonly min: StudioLift3dVec3; readonly max: StudioLift3dVec3 };
} {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const position of positions) {
    if (position.x < minX) minX = position.x;
    if (position.y < minY) minY = position.y;
    if (position.z < minZ) minZ = position.z;
    if (position.x > maxX) maxX = position.x;
    if (position.y > maxY) maxY = position.y;
    if (position.z > maxZ) maxZ = position.z;
  }
  const extentY = maxY - minY;
  const scale = extentY > 1e-9 ? targetHeight / extentY : 1;
  const offsetX = (minX + maxX) / 2;
  const offsetZ = (minZ + maxZ) / 2;
  const moved = positions.map((position) => ({
    x: (position.x - offsetX) * scale,
    y: (position.y - minY) * scale,
    z: (position.z - offsetZ) * scale,
  }));
  return {
    positions: moved,
    bounds: {
      min: { x: (minX - offsetX) * scale, y: 0, z: (minZ - offsetZ) * scale },
      max: { x: (maxX - offsetX) * scale, y: extentY * scale, z: (maxZ - offsetZ) * scale },
    },
  };
}
