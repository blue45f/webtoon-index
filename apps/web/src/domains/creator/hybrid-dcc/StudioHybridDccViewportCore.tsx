/**
 * THESIS: 실제 편집 메시를 한눈에 읽는 정밀 검사대이며, 버튼 로그가 3D 결과를 대신하지 않는다.
 * OWN-WORLD: warm-ink 캔버스, 절제된 persimmon 선택선, 계측 그리드와 단단한 세그먼트 컨트롤.
 * STORY: 작가는 권위 메시를 회전·이동·확대하고, 에셋과 투영·표현 모드를 즉시 확인한다.
 * FIRST VIEWPORT: 실제 PBR 장면이 화면을 차지하고 상태·통계는 가장자리의 얇은 도구층에 머문다.
 * FORM: 기존 Studio 편집기 세계를 잇는 Operate형 로컬 확장; 파생 렌더 자원은 문서 권위를 갖지 않는다.
 */

import { ContactShadows } from "@react-three/drei/core/ContactShadows.js";
import { OrbitControls } from "@react-three/drei/core/OrbitControls.js";
import { OrthographicCamera } from "@react-three/drei/core/OrthographicCamera.js";
import { PerformanceMonitor } from "@react-three/drei/core/PerformanceMonitor.js";
import { PerspectiveCamera } from "@react-three/drei/core/PerspectiveCamera.js";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import {
  AlertTriangle,
  Boxes,
  Camera,
  CircleDashed,
  Expand,
  Layers,
  Move3d,
  Rotate3d,
  Triangle,
} from "lucide-react";
import {
  Component,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

import {
  hashStudioEditableMesh,
  studioEditableMeshToTriangleSoup,
  type StudioEditableMesh,
} from "../studio-editable-half-edge-mesh";
import {
  assertRenderCacheIsNotAuthority,
  type StudioGeometryAuthorityRecord,
  type StudioRenderMeshCache,
} from "../studio-geometry-authority";

import {
  deriveStudioHybridDccAssetLayout,
  STUDIO_HYBRID_DCC_ASSET_LAYOUT_LIMITS,
} from "./studio-hybrid-dcc-asset-layout";
import {
  mapStudioHybridDccRayFaceIndex,
  type StudioHybridDccComponentMode,
  type StudioHybridDccComponentSelection,
  type StudioHybridDccMeshSelectionSource,
  type StudioHybridDccSelectionMode,
  type StudioHybridDccSelectionOperation,
} from "./studio-hybrid-dcc-component-selection";
import {
  STUDIO_HYBRID_DCC_OBJECT_TRANSFORM_REVISION,
  type StudioHybridDccObjectTransform,
} from "./studio-hybrid-dcc-object-transform";
import { validateStudioHybridDccFanPolygon } from "./studio-hybrid-dcc-polygon-validation";
import { resolveStudioHybridDccScreenComponentCandidate } from "./studio-hybrid-dcc-screen-selection";
import { createStudioHybridDccSelectionGate } from "./studio-hybrid-dcc-selection-gate";
import {
  resolveStudioHybridDccViewportShortcut,
  type StudioHybridDccStandardView,
  type StudioHybridDccViewportPreferences,
} from "./studio-hybrid-dcc-viewport-interaction";
import { StudioHybridDccCameraRig } from "./StudioHybridDccCameraRig";
import { StudioHybridDccTransformGizmo } from "./StudioHybridDccTransformGizmo";
import { StudioHybridDccViewportInteractionBar } from "./StudioHybridDccViewportInteractionBar";
import { useStudioHybridDccViewportPreferences } from "./useStudioHybridDccViewportPreferences";

import type { StudioHybridDccWorkspace } from "./studio-hybrid-dcc-workspace";

export type StudioHybridDccViewportProjection = "perspective" | "orthographic";
export type StudioHybridDccViewportOverlay = "material" | "material-wire" | "wireframe";
export type StudioHybridDccTransformMode = "translate" | "rotate" | "scale";
export type StudioHybridDccTransformSpace = "world" | "local";
export type StudioHybridDccViewportView = StudioHybridDccStandardView;
export type StudioHybridDccViewportRenderSource =
  | "authority-source"
  | "authority-edit-cage"
  | "authority-cache-fallback"
  | "modifier-cache";

export interface StudioHybridDccViewportProps {
  readonly workspace: StudioHybridDccWorkspace;
  readonly onSelectAsset: (assetId: string | null) => void;
  readonly projection?: StudioHybridDccViewportProjection;
  readonly defaultProjection?: StudioHybridDccViewportProjection;
  readonly onProjectionChange?: (projection: StudioHybridDccViewportProjection) => void;
  readonly overlay?: StudioHybridDccViewportOverlay;
  readonly defaultOverlay?: StudioHybridDccViewportOverlay;
  readonly onOverlayChange?: (overlay: StudioHybridDccViewportOverlay) => void;
  readonly reducedMotion?: boolean;
  readonly onCommitAssetTransform?: (
    assetId: string,
    transform: StudioHybridDccObjectTransform,
  ) => void;
  /** Reversible object commands supplied by the workspace shell. */
  readonly onDuplicateSelected?: () => void;
  readonly onDeleteSelected?: () => void;
  readonly componentSelection?: StudioHybridDccComponentSelection;
  readonly onComponentSelectionModeChange?: (mode: StudioHybridDccSelectionMode) => void;
  readonly onSelectComponent?: (
    assetId: string,
    mode: StudioHybridDccComponentMode,
    elementId: number,
    operation: StudioHybridDccSelectionOperation,
  ) => void;
  readonly onClearComponentSelection?: () => void;
  readonly onComponentSelectionError?: (message: string) => void;
  /** Keeps camera inspection available while preventing stale edits during async engine work. */
  readonly editingDisabled?: boolean;
  /**
   * 활성 조형 브러시. 주어지면 선택 오브젝트 위에서의 포인터 드래그가 로컬 좌표 스트로크로 전달된다.
   */
  readonly onSculptStroke?: (assetId: string, localPoint: {
    x: number;
    y: number;
    z: number;
  }) => void;
  readonly defaultTransformMode?: StudioHybridDccTransformMode;
  readonly defaultTransformSpace?: StudioHybridDccTransformSpace;
  /** Test/embedding override. `undefined` performs a browser WebGL capability probe after mount. */
  readonly webglAvailable?: boolean;
  readonly className?: string;
}

export interface StudioHybridDccViewportAssetSnapshot {
  readonly assetId: string;
  readonly meshHash: string;
  readonly meshRevision: number;
  readonly mesh: StudioEditableMesh;
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  readonly renderHash: string;
  readonly renderSource: StudioHybridDccViewportRenderSource;
  readonly materialId: string;
  readonly materialColor: `#${string}` | null;
  readonly position: readonly [number, number, number];
  readonly rotationEulerRad: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
  readonly worldMin: readonly [number, number, number];
  readonly worldMax: readonly [number, number, number];
  readonly normalMode: "flat" | "smooth";
  readonly vertexCount: number;
  readonly triangleCount: number;
}

export interface StudioHybridDccViewportSnapshot {
  readonly assets: readonly StudioHybridDccViewportAssetSnapshot[];
  readonly errors: readonly { readonly assetId: string; readonly message: string }[];
  readonly warnings: readonly { readonly assetId: string; readonly message: string }[];
  readonly center: readonly [number, number, number];
  readonly radius: number;
  readonly gridSize: number;
  readonly signature: string;
  readonly totalVertices: number;
  readonly totalTriangles: number;
}

const STUDIO_HYBRID_DCC_RENDER_PROFILE = Object.freeze({
  colorSpace: THREE.SRGBColorSpace,
  toneMapping: THREE.ACESFilmicToneMapping,
  exposure: 1.08,
  shadowMapType: THREE.PCFShadowMap,
  minDpr: 1,
  maxDpr: 2,
  maxDetailedEdgeTriangles: 120_000,
  maxSynchronousFacesPerAsset: 120_000,
  maxSynchronousTrianglesPerAsset: 120_000,
  maxSynchronousLinearWorkPerAsset: 1_250_000,
  maxSynchronousPolygonPairWorkPerAsset: 2_000_000,
  maxSynchronousLinearWorkTotal: 2_000_000,
  maxSynchronousPolygonPairWorkTotal: 3_000_000,
  maxSynchronousTrianglesTotal: 180_000,
  maxFaceLoopVertices: 128,
});

export interface StudioHybridDccRendererProfileTarget {
  outputColorSpace: THREE.WebGLRenderer["outputColorSpace"];
  toneMapping: THREE.WebGLRenderer["toneMapping"];
  toneMappingExposure: number;
  readonly shadowMap: {
    enabled: boolean;
    type: THREE.WebGLRenderer["shadowMap"]["type"];
  };
}

interface StudioHybridDccMeshRenderData {
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
}

interface StudioHybridDccRenderProjection extends StudioHybridDccMeshRenderData {
  readonly renderHash: string;
  readonly renderSource: StudioHybridDccViewportRenderSource;
  readonly validationWork: number;
}

type StudioHybridDccRenderCacheValidation =
  | { readonly ok: true; readonly value: StudioHybridDccRenderProjection }
  | { readonly ok: false; readonly message: string };

interface StudioHybridDccMeshPreflight {
  readonly faceCount: number;
  readonly triangleCount: number;
  readonly normalMode: "flat" | "smooth";
  /** Exact O(V + H + F + corners) preflight/conversion work proxy. */
  readonly linearWork: number;
  /** Safe upper bound for the per-polygon segment-pair checks: Σ(cornerCount²). */
  readonly polygonPairWork: number;
}

type StudioHybridDccMeshPreflightResult =
  | { readonly ok: true; readonly value: StudioHybridDccMeshPreflight }
  | { readonly ok: false; readonly message: string };

export interface StudioHybridDccGeometryResource {
  readonly geometry: THREE.BufferGeometry;
  readonly edges: THREE.EdgesGeometry;
  readonly edgeDetail: "silhouette" | "bounds";
  dispose(): void;
}

const meshRenderDataCache = new WeakMap<StudioEditableMesh, StudioHybridDccMeshRenderData>();
const meshPreflightCache = new WeakMap<StudioEditableMesh, StudioHybridDccMeshPreflightResult>();

const VIEWPORT_COLORS = Object.freeze({
  background: new THREE.Color().setHSL(0.105, 0.08, 0.105, THREE.SRGBColorSpace),
  gridMajor: new THREE.Color().setHSL(0.105, 0.08, 0.34, THREE.SRGBColorSpace),
  gridMinor: new THREE.Color().setHSL(0.105, 0.06, 0.23, THREE.SRGBColorSpace),
  material: new THREE.Color().setHSL(0.095, 0.24, 0.64, THREE.SRGBColorSpace),
  materialSelected: new THREE.Color().setHSL(0.065, 0.76, 0.57, THREE.SRGBColorSpace),
  wire: new THREE.Color().setHSL(0.105, 0.08, 0.72, THREE.SRGBColorSpace),
  wireSelected: new THREE.Color().setHSL(0.065, 0.92, 0.62, THREE.SRGBColorSpace),
  key: new THREE.Color().setHSL(0.10, 0.30, 0.88, THREE.SRGBColorSpace),
  fill: new THREE.Color().setHSL(0.58, 0.32, 0.72, THREE.SRGBColorSpace),
  rim: new THREE.Color().setHSL(0.065, 0.72, 0.65, THREE.SRGBColorSpace),
});

const OVERLAY_OPTIONS = Object.freeze([
  { id: "material", label: "재질" },
  { id: "material-wire", label: "재질+선" },
  { id: "wireframe", label: "와이어" },
] as const satisfies readonly {
  readonly id: StudioHybridDccViewportOverlay;
  readonly label: string;
}[]);

function classes(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function inspectStudioHybridDccMeshForSynchronousProjection(
  mesh: StudioEditableMesh,
): StudioHybridDccMeshPreflightResult {
  const cached = meshPreflightCache.get(mesh);
  if (cached) return cached;
  let result: StudioHybridDccMeshPreflightResult;
  try {
    const faceCount = mesh.faces.length;
    if (faceCount === 0) throw new Error("렌더링할 면이 없습니다.");
    if (faceCount > STUDIO_HYBRID_DCC_RENDER_PROFILE.maxSynchronousFacesPerAsset) {
      throw new Error(
        `동기 변환 면 예산을 초과했습니다 (${faceCount.toLocaleString("en-US")}). `
          + "대용량 삼각화 worker가 필요합니다.",
      );
    }
    const hasSmoothFaces = mesh.faces.some((face) => face.smooth);
    const hasFlatFaces = mesh.faces.some((face) => !face.smooth);
    if (hasSmoothFaces && hasFlatFaces) {
      throw new Error("혼합 flat/smooth 면에는 split-normal 렌더 경로가 필요합니다.");
    }
    if (hasSmoothFaces && (
      mesh.vertices.some((vertex) => vertex.crease > 0)
      || mesh.halfEdges.some((halfEdge) => halfEdge.crease > 0)
    )) {
      throw new Error("crease가 있는 smooth 메시에는 smoothing-island 렌더 경로가 필요합니다.");
    }
    const verticesById = new Map(mesh.vertices.map((vertex) => [vertex.id, vertex]));
    if (verticesById.size !== mesh.vertices.length) {
      throw new Error("메시에 중복된 정점 ID가 있습니다.");
    }
    if (mesh.vertices.some((vertex) => (
      !Number.isInteger(vertex.id)
      || !Number.isFinite(vertex.position.x)
      || !Number.isFinite(vertex.position.y)
      || !Number.isFinite(vertex.position.z)
    ))) {
      throw new Error("메시에 유효하지 않은 정점 ID 또는 좌표가 있습니다.");
    }
    if (new Set(mesh.faces.map((face) => face.id)).size !== mesh.faces.length) {
      throw new Error("메시에 중복된 면 ID가 있습니다.");
    }
    if (mesh.faces.some((face) => !Number.isInteger(face.id))) {
      throw new Error("메시에 유효하지 않은 면 ID가 있습니다.");
    }
    if (mesh.halfEdges.some((halfEdge, index) => halfEdge.id !== index)) {
      throw new Error("half-edge ID와 저장 인덱스가 일치하지 않습니다.");
    }
    const baseLinearWork = mesh.vertices.length + mesh.halfEdges.length + faceCount;
    if (baseLinearWork > STUDIO_HYBRID_DCC_RENDER_PROFILE.maxSynchronousLinearWorkPerAsset) {
      throw new Error("동기 선형 메시 검사 예산을 초과했습니다. 대용량 worker가 필요합니다.");
    }
    let triangleCount = 0;
    let cornerCount = 0;
    let polygonPairWork = 0;
    for (const face of mesh.faces) {
      const points: Array<readonly [number, number, number]> = [];
      const vertexIds = new Set<number>();
      const halfEdgeIds = new Set<number>();
      let halfEdgeId = face.he;
      while (true) {
        if (!Number.isInteger(halfEdgeId) || halfEdgeId < 0 || halfEdgeId >= mesh.halfEdges.length) {
          throw new Error(`면 ${face.id}의 half-edge 연결이 잘못되었습니다.`);
        }
        if (halfEdgeIds.has(halfEdgeId)) {
          if (halfEdgeId === face.he) break;
          throw new Error(`면 ${face.id}의 half-edge 순환이 닫히지 않습니다.`);
        }
        halfEdgeIds.add(halfEdgeId);
        if (halfEdgeIds.size > STUDIO_HYBRID_DCC_RENDER_PROFILE.maxFaceLoopVertices) {
          throw new Error(`면 ${face.id}의 꼭짓점 수가 동기 삼각화 예산을 초과했습니다.`);
        }
        const halfEdge = mesh.halfEdges[halfEdgeId]!;
        const previous = mesh.halfEdges[halfEdge.prev];
        const next = mesh.halfEdges[halfEdge.next];
        if (halfEdge.face !== face.id || previous?.next !== halfEdgeId || next?.prev !== halfEdgeId) {
          throw new Error(`면 ${face.id}의 half-edge 양방향 연결이 일치하지 않습니다.`);
        }
        const vertex = previous ? verticesById.get(previous.vertex) : undefined;
        if (!vertex || vertexIds.has(vertex.id)) {
          throw new Error(`면 ${face.id}에 없거나 중복된 정점이 있습니다.`);
        }
        vertexIds.add(vertex.id);
        points.push([vertex.position.x, vertex.position.y, vertex.position.z]);
        halfEdgeId = halfEdge.next;
      }
      if (points.length < 3) throw new Error(`면 ${face.id}의 정점이 3개보다 적습니다.`);
      cornerCount += points.length;
      polygonPairWork += points.length * points.length;
      if (baseLinearWork + cornerCount
        > STUDIO_HYBRID_DCC_RENDER_PROFILE.maxSynchronousLinearWorkPerAsset) {
        throw new Error("동기 선형 메시 검사 예산을 초과했습니다. 대용량 worker가 필요합니다.");
      }
      if (polygonPairWork
        > STUDIO_HYBRID_DCC_RENDER_PROFILE.maxSynchronousPolygonPairWorkPerAsset) {
        throw new Error(
          "동기 다각형 교차 검사 예산을 초과했습니다. 고차 면을 나누거나 worker를 사용해 주세요.",
        );
      }
      validateStudioHybridDccFanPolygon(points, face.id);
      triangleCount += points.length - 2;
      if (triangleCount > STUDIO_HYBRID_DCC_RENDER_PROFILE.maxSynchronousTrianglesPerAsset) {
        throw new Error("동기 변환 삼각형 예산을 초과했습니다. 대용량 삼각화 worker가 필요합니다.");
      }
    }
    result = {
      ok: true,
      value: {
        faceCount,
        triangleCount,
        normalMode: hasFlatFaces ? "flat" : "smooth",
        linearWork: baseLinearWork + cornerCount,
        polygonPairWork,
      },
    };
  } catch (error) {
    result = {
      ok: false,
      message: error instanceof Error ? error.message : "메시 삼각화 사전 검증에 실패했습니다.",
    };
  }
  meshPreflightCache.set(mesh, result);
  return result;
}

function meshRenderData(mesh: StudioEditableMesh): StudioHybridDccMeshRenderData {
  const cached = meshRenderDataCache.get(mesh);
  if (cached) return cached;
  const soup = studioEditableMeshToTriangleSoup(mesh);
  if (soup.indices.length === 0 || soup.indices.length % 3 !== 0) {
    throw new Error("렌더링할 삼각형 표면이 없습니다.");
  }
  const vertexCount = soup.positions.length / 3;
  for (const index of soup.indices) {
    if (index >= vertexCount) throw new Error("삼각형 인덱스가 정점 범위를 벗어났습니다.");
  }
  const data: StudioHybridDccMeshRenderData = {
    positions: soup.positions,
    indices: soup.indices,
  };
  meshRenderDataCache.set(mesh, data);
  return data;
}

function resolveStudioHybridDccRoomMaterialColor(materialId: string): `#${string}` | null {
  const match = /^room-color:(#[0-9a-f]{6})$/iu.exec(materialId);
  const color = match?.[1];
  return color ? color.toLowerCase() as `#${string}` : null;
}

function validateStudioHybridDccRenderCache(
  record: StudioGeometryAuthorityRecord,
  cache: StudioRenderMeshCache,
  expectedGeometryHash: string | null,
): StudioHybridDccRenderCacheValidation {
  let modifierSourceHash: string;
  try {
    modifierSourceHash = hashStudioEditableMesh(record.modifierStack.source);
  } catch {
    return {
      ok: false,
      message: "변형 스택의 원본 구조를 검증하지 못해 현재 권위 메시로 표시합니다.",
    };
  }
  if (modifierSourceHash !== record.meshHash) {
    return {
      ok: false,
      message: "변형 스택의 원본 해시가 현재 권위 메시와 달라 원본 메시로 표시합니다.",
    };
  }
  if (!expectedGeometryHash) {
    return {
      ok: false,
      message: "공유 장면에 화면용 메시의 provenance가 없어 원본 메시로 표시합니다.",
    };
  }
  if (!/^(?:mesh:[0-9a-f]{8}|mesh:sha256:[0-9a-f]{64}|sha256:[0-9a-f]{64})$/iu.test(cache.derivedFromHash)
    || cache.derivedFromHash !== expectedGeometryHash) {
    return {
      ok: false,
      message: "화면용 메시의 파생 해시가 현재 장면과 달라 원본 메시로 표시합니다.",
    };
  }
  if (!(cache.positions instanceof Float32Array)
    || cache.positions.length === 0
    || cache.positions.length % 3 !== 0) {
    return {
      ok: false,
      message: "화면용 메시의 정점 배열이 잘못되어 원본 메시로 표시합니다.",
    };
  }
  if (!(cache.indices instanceof Uint32Array)
    || cache.indices.length === 0
    || cache.indices.length % 3 !== 0) {
    return {
      ok: false,
      message: "화면용 메시의 삼각형 배열이 잘못되어 원본 메시로 표시합니다.",
    };
  }
  const vertexCount = cache.positions.length / 3;
  const triangleCount = cache.indices.length / 3;
  if (vertexCount > STUDIO_HYBRID_DCC_ASSET_LAYOUT_LIMITS.maxVerticesPerAsset
    || triangleCount > STUDIO_HYBRID_DCC_RENDER_PROFILE.maxSynchronousTrianglesPerAsset) {
    return {
      ok: false,
      message: "화면용 메시가 안전한 동기 표시 예산을 넘어 원본 메시로 표시합니다.",
    };
  }
  const validationWork = cache.positions.length + cache.indices.length;
  if (validationWork > STUDIO_HYBRID_DCC_RENDER_PROFILE.maxSynchronousLinearWorkPerAsset) {
    return {
      ok: false,
      message: "화면용 메시 검사 예산을 넘어 원본 메시로 표시합니다.",
    };
  }
  for (const coordinate of cache.positions) {
    if (!Number.isFinite(coordinate)) {
      return {
        ok: false,
        message: "화면용 메시에 유한하지 않은 좌표가 있어 원본 메시로 표시합니다.",
      };
    }
    if (Math.abs(coordinate) > STUDIO_HYBRID_DCC_ASSET_LAYOUT_LIMITS.maxAbsoluteCoordinate) {
      return {
        ok: false,
        message: "화면용 메시 좌표가 안전 범위를 넘어 원본 메시로 표시합니다.",
      };
    }
  }
  for (let offset = 0; offset < cache.indices.length; offset += 3) {
    const a = cache.indices[offset]!;
    const b = cache.indices[offset + 1]!;
    const c = cache.indices[offset + 2]!;
    if (a >= vertexCount || b >= vertexCount || c >= vertexCount) {
      return {
        ok: false,
        message: "화면용 메시 인덱스가 정점 범위를 넘어 원본 메시로 표시합니다.",
      };
    }
    if (a === b || b === c || a === c) {
      return {
        ok: false,
        message: "화면용 메시의 퇴화 삼각형을 감지해 원본 메시로 표시합니다.",
      };
    }
  }
  if (record.renderCache !== cache || !assertRenderCacheIsNotAuthority(record)) {
    return {
      ok: false,
      message: "화면용 메시의 원본·변형·내용 해시가 현재 권위 상태와 달라 원본 메시로 표시합니다.",
    };
  }
  return {
    ok: true,
    value: {
      positions: cache.positions,
      indices: cache.indices,
      renderHash: cache.derivedFromHash,
      renderSource: "modifier-cache",
      validationWork,
    },
  };
}

function sourceStudioHybridDccRenderProjection(
  record: StudioGeometryAuthorityRecord,
  renderSource: Exclude<StudioHybridDccViewportRenderSource, "modifier-cache">,
): StudioHybridDccRenderProjection {
  return {
    ...meshRenderData(record.mesh),
    renderHash: record.meshHash,
    renderSource,
    validationWork: 0,
  };
}

/**
 * Pure renderer projection. Object mode may read a validated disposable modifier cache; component
 * modes always return the source authority cage so ray face indices keep their stable-ID mapping.
 * The workspace and every typed array it owns remain read-only.
 */
// eslint-disable-next-line react-refresh/only-export-components -- deterministic projection contract
export function deriveStudioHybridDccViewportSnapshot(
  workspace: StudioHybridDccWorkspace,
  selectionMode: StudioHybridDccSelectionMode = "object",
): StudioHybridDccViewportSnapshot {
  const sharedObjectById = new Map(workspace.bridge.set.objects.map((object) => [object.id, object]));
  const records = Object.values(workspace.session.state.geometry.records)
    .filter((record) => sharedObjectById.get(record.assetId)?.visible !== false)
    .toSorted((a, b) => compareCodeUnits(a.assetId, b.assetId));
  const errors: Array<{ readonly assetId: string; readonly message: string }> = [];
  const warnings: Array<{ readonly assetId: string; readonly message: string }> = [];
  const boundedRecords = records.slice(0, STUDIO_HYBRID_DCC_ASSET_LAYOUT_LIMITS.maxAssets);
  for (const record of records.slice(boundedRecords.length)) {
    errors.push({ assetId: record.assetId, message: "동시 표시 에셋 예산을 초과했습니다." });
  }
  const accepted: StudioGeometryAuthorityRecord[] = [];
  const acceptedByAsset = new Map<string, StudioGeometryAuthorityRecord>();
  const preflightByAsset = new Map<string, StudioHybridDccMeshPreflight>();
  const projectionByAsset = new Map<string, StudioHybridDccRenderProjection>();
  let cumulativeLinearWork = 0;
  let cumulativePolygonPairWork = 0;
  let cumulativeTriangles = 0;
  for (const record of boundedRecords) {
    const preflight = inspectStudioHybridDccMeshForSynchronousProjection(record.mesh);
    if (!preflight.ok) {
      errors.push({ assetId: record.assetId, message: preflight.message });
      continue;
    }
    let projection: StudioHybridDccRenderProjection;
    try {
      if (selectionMode === "object" && record.renderCache) {
        const validated = validateStudioHybridDccRenderCache(
          record,
          record.renderCache,
          sharedObjectById.get(record.assetId)?.geometryHash ?? null,
        );
        if (validated.ok) {
          projection = validated.value;
        } else {
          warnings.push({ assetId: record.assetId, message: validated.message });
          projection = sourceStudioHybridDccRenderProjection(record, "authority-cache-fallback");
        }
      } else {
        projection = sourceStudioHybridDccRenderProjection(
          record,
          selectionMode === "object" ? "authority-source" : "authority-edit-cage",
        );
      }
    } catch (error) {
      errors.push({
        assetId: record.assetId,
        message: error instanceof Error ? error.message : "메시 변환에 실패했습니다.",
      });
      continue;
    }
    const projectionTriangles = projection.indices.length / 3;
    if (projection.renderSource !== "modifier-cache"
      && projectionTriangles !== preflight.value.triangleCount) {
      errors.push({
        assetId: record.assetId,
        message: "권위 메시와 파생 삼각형 수가 일치하지 않습니다.",
      });
      continue;
    }
    const nextLinearWork = cumulativeLinearWork
      + preflight.value.linearWork
      + projection.validationWork;
    const nextPolygonPairWork = cumulativePolygonPairWork + preflight.value.polygonPairWork;
    const nextTriangles = cumulativeTriangles + projectionTriangles;
    if (nextLinearWork > STUDIO_HYBRID_DCC_RENDER_PROFILE.maxSynchronousLinearWorkTotal
      || nextPolygonPairWork
        > STUDIO_HYBRID_DCC_RENDER_PROFILE.maxSynchronousPolygonPairWorkTotal
      || nextTriangles > STUDIO_HYBRID_DCC_RENDER_PROFILE.maxSynchronousTrianglesTotal) {
      errors.push({
        assetId: record.assetId,
        message: "동시 표시 변환 예산을 초과했습니다. 에셋을 나누거나 대용량 worker 경로를 사용해 주세요.",
      });
      continue;
    }
    cumulativeLinearWork = nextLinearWork;
    cumulativePolygonPairWork = nextPolygonPairWork;
    cumulativeTriangles = nextTriangles;
    accepted.push(record);
    acceptedByAsset.set(record.assetId, record);
    preflightByAsset.set(record.assetId, preflight.value);
    projectionByAsset.set(record.assetId, projection);
  }
  const layout = deriveStudioHybridDccAssetLayout(accepted.map((record) => ({
    assetId: record.assetId,
    meshHash: record.meshHash,
    mesh: record.mesh,
    transform: workspace.session.state.objectTransforms[record.assetId],
    presentation: projectionByAsset.get(record.assetId)?.renderSource === "modifier-cache"
      ? {
          positions: projectionByAsset.get(record.assetId)!.positions,
          derivedFromHash: projectionByAsset.get(record.assetId)!.renderHash,
        }
      : undefined,
  })));
  errors.push(...layout.errors);
  const assets: StudioHybridDccViewportAssetSnapshot[] = [];
  for (const item of layout.items) {
    try {
      const record = acceptedByAsset.get(item.assetId);
      const projection = projectionByAsset.get(item.assetId);
      const preflight = preflightByAsset.get(item.assetId);
      if (!record || !projection || !preflight) {
        throw new Error("뷰포트 메시 projection을 찾지 못했습니다.");
      }
      if (projection.renderHash !== item.presentationHash) {
        throw new Error("뷰포트 경계와 화면용 메시의 파생 해시가 일치하지 않습니다.");
      }
      const sharedObject = sharedObjectById.get(item.assetId);
      const materialId = sharedObject?.materialId ?? "default";
      assets.push({
        assetId: item.assetId,
        meshHash: item.meshHash,
        meshRevision: record.revision,
        mesh: item.mesh,
        positions: projection.positions,
        indices: projection.indices,
        renderHash: projection.renderHash,
        renderSource: projection.renderSource,
        materialId,
        materialColor: resolveStudioHybridDccRoomMaterialColor(materialId),
        position: item.position,
        rotationEulerRad: item.rotationEulerRad,
        scale: item.scale,
        worldMin: item.worldMin,
        worldMax: item.worldMax,
        normalMode: preflight.normalMode,
        vertexCount: projection.positions.length / 3,
        triangleCount: projection.indices.length / 3,
      });
    } catch (error) {
      errors.push({
        assetId: item.assetId,
        message: error instanceof Error ? error.message : "메시 변환에 실패했습니다.",
      });
    }
  }

  return {
    assets,
    errors,
    warnings,
    center: layout.center,
    radius: layout.radius,
    gridSize: layout.gridSize,
    signature: layout.signature,
    totalVertices: assets.reduce((sum, asset) => sum + asset.vertexCount, 0),
    totalTriangles: assets.reduce((sum, asset) => sum + asset.triangleCount, 0),
  };
}

function createStudioHybridDccGeometryResource(
  asset: Pick<StudioHybridDccViewportAssetSnapshot, "positions" | "indices" | "normalMode">,
): StudioHybridDccGeometryResource {
  const indexedGeometry = new THREE.BufferGeometry();
  indexedGeometry.setAttribute("position", new THREE.BufferAttribute(asset.positions, 3));
  indexedGeometry.setIndex(new THREE.BufferAttribute(asset.indices, 1));
  const geometry = asset.normalMode === "flat"
    ? indexedGeometry.toNonIndexed()
    : indexedGeometry;
  if (geometry !== indexedGeometry) indexedGeometry.dispose();
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  let edgeDetail: StudioHybridDccGeometryResource["edgeDetail"] = "silhouette";
  let edges: THREE.EdgesGeometry;
  if (asset.indices.length / 3 <= STUDIO_HYBRID_DCC_RENDER_PROFILE.maxDetailedEdgeTriangles) {
    edges = new THREE.EdgesGeometry(geometry, 24);
  } else {
    edgeDetail = "bounds";
    const bounds = geometry.boundingBox;
    const size = bounds?.getSize(new THREE.Vector3()) ?? new THREE.Vector3(1, 1, 1);
    const center = bounds?.getCenter(new THREE.Vector3()) ?? new THREE.Vector3();
    const box = new THREE.BoxGeometry(
      Math.max(size.x, 1e-5),
      Math.max(size.y, 1e-5),
      Math.max(size.z, 1e-5),
    );
    box.translate(center.x, center.y, center.z);
    edges = new THREE.EdgesGeometry(box);
    box.dispose();
  }
  return {
    geometry,
    edges,
    edgeDetail,
    dispose: () => {
      edges.dispose();
      geometry.dispose();
    },
  };
}

function applyStudioHybridDccRendererProfile(
  renderer: StudioHybridDccRendererProfileTarget,
): void {
  renderer.outputColorSpace = STUDIO_HYBRID_DCC_RENDER_PROFILE.colorSpace;
  renderer.toneMapping = STUDIO_HYBRID_DCC_RENDER_PROFILE.toneMapping;
  renderer.toneMappingExposure = STUDIO_HYBRID_DCC_RENDER_PROFILE.exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = STUDIO_HYBRID_DCC_RENDER_PROFILE.shadowMapType;
}

function resolveStudioHybridDccDpr(
  devicePixelRatio: number,
  qualityFactor: number,
): number {
  const device = Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1;
  const factor = Number.isFinite(qualityFactor) ? qualityFactor : 1;
  return Math.min(
    STUDIO_HYBRID_DCC_RENDER_PROFILE.maxDpr,
    Math.max(STUDIO_HYBRID_DCC_RENDER_PROFILE.minDpr, device * factor),
  );
}

interface StudioHybridDccComponentOverlayResource {
  readonly geometry: THREE.BufferGeometry;
  readonly mode: StudioHybridDccComponentMode;
  dispose(): void;
}

function createStudioHybridDccComponentOverlayResource(
  asset: StudioHybridDccViewportAssetSnapshot,
  mode: StudioHybridDccComponentMode,
  elementIds: readonly number[],
): StudioHybridDccComponentOverlayResource | null {
  if (elementIds.length === 0) return null;
  const selected = new Set(elementIds);
  const verticesById = new Map(asset.mesh.vertices.map((vertex) => [vertex.id, vertex]));
  const geometry = new THREE.BufferGeometry();

  if (mode === "face") {
    const selectedIndices: number[] = [];
    let triangleOffset = 0;
    for (const face of asset.mesh.faces) {
      let corners = 0;
      let halfEdgeId = face.he;
      const visited = new Set<number>();
      while (!visited.has(halfEdgeId)) {
        visited.add(halfEdgeId);
        corners += 1;
        const halfEdge = asset.mesh.halfEdges[halfEdgeId];
        if (!halfEdge) break;
        halfEdgeId = halfEdge.next;
      }
      const triangleCount = Math.max(0, corners - 2);
      if (selected.has(face.id)) {
        for (let triangle = 0; triangle < triangleCount; triangle += 1) {
          const indexOffset = (triangleOffset + triangle) * 3;
          const a = asset.indices[indexOffset];
          const b = asset.indices[indexOffset + 1];
          const c = asset.indices[indexOffset + 2];
          if (a !== undefined && b !== undefined && c !== undefined) {
            selectedIndices.push(a, b, c);
          }
        }
      }
      triangleOffset += triangleCount;
    }
    if (selectedIndices.length === 0) {
      geometry.dispose();
      return null;
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(asset.positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(Uint32Array.from(selectedIndices), 1));
  } else if (mode === "edge") {
    const halfEdgesById = new Map(asset.mesh.halfEdges.map((halfEdge) => [halfEdge.id, halfEdge]));
    const positions: number[] = [];
    for (const edgeId of elementIds) {
      const halfEdge = halfEdgesById.get(edgeId);
      const previous = halfEdge ? halfEdgesById.get(halfEdge.prev) : undefined;
      const start = previous ? verticesById.get(previous.vertex) : undefined;
      const end = halfEdge ? verticesById.get(halfEdge.vertex) : undefined;
      if (!start || !end) continue;
      positions.push(
        start.position.x,
        start.position.y,
        start.position.z,
        end.position.x,
        end.position.y,
        end.position.z,
      );
    }
    if (positions.length === 0) {
      geometry.dispose();
      return null;
    }
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  } else {
    const positions: number[] = [];
    for (const vertexId of elementIds) {
      const vertex = verticesById.get(vertexId);
      if (!vertex) continue;
      positions.push(vertex.position.x, vertex.position.y, vertex.position.z);
    }
    if (positions.length === 0) {
      geometry.dispose();
      return null;
    }
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  }

  geometry.computeBoundingSphere();
  return {
    geometry,
    mode,
    dispose: () => geometry.dispose(),
  };
}

function StudioHybridDccComponentOverlay({
  asset,
  elementIds,
  mode,
}: {
  readonly asset: StudioHybridDccViewportAssetSnapshot;
  readonly elementIds: readonly number[];
  readonly mode: StudioHybridDccComponentMode;
}) {
  const [resource, setResource] = useState<StudioHybridDccComponentOverlayResource | null>(null);
  const elementSignature = elementIds.join(",");

  useEffect(() => {
    const next = createStudioHybridDccComponentOverlayResource(asset, mode, elementIds);
    setResource(next);
    return () => next?.dispose();
  }, [asset, elementIds, elementSignature, mode]);

  if (!resource) return null;
  if (resource.mode === "face") {
    return (
      <mesh geometry={resource.geometry} renderOrder={6}>
        <meshBasicMaterial
          color={VIEWPORT_COLORS.wireSelected}
          depthTest
          polygonOffset
          polygonOffsetFactor={-4}
          polygonOffsetUnits={-4}
          transparent
          opacity={0.42}
          side={THREE.DoubleSide}
        />
      </mesh>
    );
  }
  if (resource.mode === "edge") {
    return (
      <lineSegments geometry={resource.geometry} renderOrder={7}>
        <lineBasicMaterial
          color={VIEWPORT_COLORS.wireSelected}
          depthTest={false}
          transparent
          opacity={1}
        />
      </lineSegments>
    );
  }
  return (
    <points geometry={resource.geometry} renderOrder={8}>
      <pointsMaterial
        color={VIEWPORT_COLORS.wireSelected}
        depthTest={false}
        size={8}
        sizeAttenuation={false}
      />
    </points>
  );
}

function StudioHybridDccAssetMesh({
  asset,
  onCommitTransform,
  overlay,
  selected,
  onSelect,
  onSelectComponent,
  onSelectionError,
  selectionElementIds,
  selectionMode,
  editingDisabled,
  transformMode,
  transformSpace,
  preferences,
  onDraggingChange,
  onNotice,
  sculptStroke,
}: {
  readonly asset: StudioHybridDccViewportAssetSnapshot;
  readonly onCommitTransform?: (
    assetId: string,
    transform: StudioHybridDccObjectTransform,
  ) => void;
  readonly overlay: StudioHybridDccViewportOverlay;
  readonly selected: boolean;
  readonly onSelect: (assetId: string) => void;
  readonly onSelectComponent?: (
    assetId: string,
    mode: StudioHybridDccComponentMode,
    elementId: number,
    operation: StudioHybridDccSelectionOperation,
  ) => void;
  readonly onSelectionError?: (message: string) => void;
  readonly selectionElementIds: readonly number[];
  readonly selectionMode: StudioHybridDccSelectionMode;
  readonly editingDisabled: boolean;
  readonly transformMode: StudioHybridDccTransformMode;
  readonly transformSpace: StudioHybridDccTransformSpace;
  readonly preferences: StudioHybridDccViewportPreferences;
  readonly onDraggingChange: (dragging: boolean) => void;
  readonly onNotice: (message: string) => void;
  /** 활성화되면 포인터 드래그가 오브젝트 로컬 좌표로 조형 스트로크를 보낸다. */
  readonly sculptStroke?: (localPoint: { x: number; y: number; z: number }) => void;
}) {
  const [resource, setResource] = useState<StudioHybridDccGeometryResource | null>(null);
  const objectRef = useRef<THREE.Group>(null);
  const viewportSize = useThree((state) => state.size);
  const { indices, normalMode, positions } = asset;

  useEffect(() => {
    const next = createStudioHybridDccGeometryResource({ indices, normalMode, positions });
    setResource(next);
    return () => next.dispose();
  }, [indices, normalMode, positions]);

  if (!resource) return null;
  const componentCage = selectionMode !== "object";
  const showMaterial = overlay !== "wireframe";
  const showWireOverlay = overlay === "material-wire" || componentCage;

  const object = (
    <group
      ref={objectRef}
      position={asset.position}
      rotation={asset.rotationEulerRad}
      scale={asset.scale}
    >
      <mesh
        geometry={resource.geometry}
        castShadow
        receiveShadow
        onPointerDown={(event: ThreeEvent<PointerEvent>) => {
          const group = objectRef.current;
          if (!sculptStroke || !group) return;
          event.stopPropagation();
          (event.target as Element | null)?.setPointerCapture?.(event.pointerId);
          sculptStroke(group.worldToLocal(event.point.clone()));
        }}
        onPointerMove={(event: ThreeEvent<PointerEvent>) => {
          const group = objectRef.current;
          if (!sculptStroke || !group) return;
          if ((event.nativeEvent.buttons & 1) !== 1) return;
          event.stopPropagation();
          sculptStroke(group.worldToLocal(event.point.clone()));
        }}
        onClick={(event: ThreeEvent<MouseEvent>) => {
          event.stopPropagation();
          if (editingDisabled) return;
          if (selectionMode === "object" || !onSelectComponent) {
            onSelect(asset.assetId);
            return;
          }
          if (!Number.isSafeInteger(event.faceIndex) || (event.faceIndex ?? -1) < 0) {
            onSelect(asset.assetId);
            onSelectionError?.("클릭한 삼각형을 편집 메시의 점·선·면으로 찾지 못했습니다.");
            return;
          }
          const source: StudioHybridDccMeshSelectionSource = {
            assetId: asset.assetId,
            mesh: asset.mesh,
            meshRevision: asset.meshRevision,
            sourceHash: asset.meshHash,
          };
          const mapping = mapStudioHybridDccRayFaceIndex(source, event.faceIndex!);
          if (!mapping.ok) {
            onSelect(asset.assetId);
            onSelectionError?.(mapping.diagnostics.map(({ message }) => message).join(" · "));
            return;
          }
          const nativeEvent = event.nativeEvent;
          const operation: StudioHybridDccSelectionOperation = nativeEvent.altKey
            ? "subtract"
            : nativeEvent.ctrlKey || nativeEvent.metaKey
              ? "toggle"
              : nativeEvent.shiftKey
                ? "add"
                : "replace";
          let elementId = mapping.value.faceId;
          if (selectionMode === "vertex" || selectionMode === "edge") {
            const nearest = resolveStudioHybridDccScreenComponentCandidate(
              asset.mesh,
              selectionMode,
              {
                vertexIds: mapping.value.vertexCandidateIds,
                edges: mapping.value.edgeCandidates,
              },
              event.pointer,
              event.camera,
              event.object.matrixWorld,
              viewportSize,
            );
            if (nearest === null) {
              onSelectionError?.(
                selectionMode === "vertex"
                  ? "꼭짓점 가까이를 클릭해 주세요. 면 가운데는 임의의 점으로 선택하지 않습니다."
                  : "모서리 가까이를 클릭해 주세요. 면 가운데는 임의의 선으로 선택하지 않습니다.",
              );
              return;
            }
            elementId = nearest;
          }
          onSelectComponent(asset.assetId, selectionMode, elementId, operation);
        }}
      >
        {showMaterial ? (
          <meshPhysicalMaterial
            color={asset.materialColor
              ?? (selected ? VIEWPORT_COLORS.materialSelected : VIEWPORT_COLORS.material)}
            roughness={0.62}
            metalness={0.08}
            clearcoat={0.12}
            clearcoatRoughness={0.78}
            side={THREE.DoubleSide}
          />
        ) : (
          <meshStandardMaterial
            color={selected ? VIEWPORT_COLORS.wireSelected : VIEWPORT_COLORS.wire}
            roughness={0.72}
            metalness={0.02}
            wireframe
          />
        )}
      </mesh>
      {showWireOverlay ? (
        <mesh geometry={resource.geometry} renderOrder={3}>
          <meshBasicMaterial
            color={selected ? VIEWPORT_COLORS.wireSelected : VIEWPORT_COLORS.wire}
            depthTest
            polygonOffset
            polygonOffsetFactor={-1}
            polygonOffsetUnits={-1}
            transparent
            opacity={selected ? 0.84 : componentCage ? 0.58 : 0.42}
            wireframe
          />
        </mesh>
      ) : null}
      {selected ? (
        <lineSegments geometry={resource.edges} renderOrder={4}>
          <lineBasicMaterial
            color={VIEWPORT_COLORS.wireSelected}
            depthTest={false}
            transparent
            opacity={1}
          />
        </lineSegments>
      ) : null}
      {selected && selectionMode !== "object" && selectionElementIds.length > 0 ? (
        <StudioHybridDccComponentOverlay
          asset={asset}
          elementIds={selectionElementIds}
          mode={selectionMode}
        />
      ) : null}
    </group>
  );
  if (editingDisabled || sculptStroke || !selected || !onCommitTransform || selectionMode !== "object") {
    return object;
  }
  return (
    <StudioHybridDccTransformGizmo
      objectRef={objectRef}
      source={{
        assetId: asset.assetId,
        geometryStamp: `${asset.meshHash}:${asset.meshRevision}:${asset.renderHash}`,
        transform: {
          revision: STUDIO_HYBRID_DCC_OBJECT_TRANSFORM_REVISION,
          position: asset.position, rotationEulerRad: asset.rotationEulerRad, scale: asset.scale,
        },
      }}
      mode={transformMode}
      space={transformSpace}
      preferences={preferences}
      onCommit={onCommitTransform}
      onDraggingChange={onDraggingChange}
      onNotice={onNotice}
    >
      {object}
    </StudioHybridDccTransformGizmo>
  );
}

function StudioHybridDccAdaptiveDpr() {
  const setDpr = useThree((state) => state.setDpr);
  const devicePixelRatio = typeof window === "undefined" ? 1 : window.devicePixelRatio;
  return (
    <PerformanceMonitor
      flipflops={3}
      bounds={(refreshRate) => [Math.min(42, refreshRate * 0.72), refreshRate * 0.92]}
      onChange={({ factor }) => setDpr(resolveStudioHybridDccDpr(devicePixelRatio, 0.58 + factor * 0.42))}
      onFallback={() => setDpr(STUDIO_HYBRID_DCC_RENDER_PROFILE.minDpr)}
    />
  );
}

function assignStudioHybridDccEnvironment(
  scene: THREE.Scene,
  environment: THREE.Texture | null,
): void {
  scene.environment = environment;
}

function StudioHybridDccLocalEnvironment() {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);

  useEffect(() => {
    const room = new RoomEnvironment();
    const generator = new THREE.PMREMGenerator(gl);
    generator.compileCubemapShader();
    const target = generator.fromScene(room, 0.04);
    const previousEnvironment = scene.environment;
    assignStudioHybridDccEnvironment(scene, target.texture);
    return () => {
      if (scene.environment === target.texture) {
        assignStudioHybridDccEnvironment(scene, previousEnvironment);
      }
      target.dispose();
      generator.dispose();
      room.dispose();
    };
  }, [gl, scene]);

  return null;
}

function StudioHybridDccWebglLifecycle({
  onContextLostChange,
}: {
  readonly onContextLostChange: (lost: boolean) => void;
}) {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    const canvas = gl.domElement;
    const onLost = (event: Event) => {
      event.preventDefault();
      onContextLostChange(true);
    };
    const onRestored = () => {
      applyStudioHybridDccRendererProfile(gl);
      onContextLostChange(false);
      invalidate();
    };
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
    return () => {
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
    };
  }, [gl, invalidate, onContextLostChange]);

  return null;
}

function StudioHybridDccLightRig({ radius }: { readonly radius: number }) {
  const reach = Math.max(4, radius * 2.6);
  const shadowSpan = Math.max(8, radius * 1.8);
  return (
    <>
      <hemisphereLight args={[VIEWPORT_COLORS.key, VIEWPORT_COLORS.background, 0.72]} />
      <directionalLight
        castShadow
        color={VIEWPORT_COLORS.key}
        intensity={3.6}
        position={[reach, reach * 1.35, reach * 0.72]}
        shadow-bias={-0.00018}
        shadow-camera-bottom={-shadowSpan}
        shadow-camera-far={reach * 5}
        shadow-camera-left={-shadowSpan}
        shadow-camera-near={0.1}
        shadow-camera-right={shadowSpan}
        shadow-camera-top={shadowSpan}
        shadow-mapSize-height={1024}
        shadow-mapSize-width={1024}
        shadow-radius={2}
      />
      <directionalLight
        color={VIEWPORT_COLORS.fill}
        intensity={1.35}
        position={[-reach, reach * 0.58, reach * 0.4]}
      />
      <directionalLight
        color={VIEWPORT_COLORS.rim}
        intensity={2.1}
        position={[0, reach, -reach]}
      />
    </>
  );
}

class StudioHybridDccCanvasBoundary extends Component<
  { readonly children: ReactNode },
  { readonly error: Error | null }
> {
  state: { readonly error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { readonly error: Error } {
    return { error };
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="absolute inset-0 grid place-items-center bg-canvas px-5 text-center" role="alert">
          <div className="max-w-sm">
            <AlertTriangle className="mx-auto mb-3 text-bad" size={24} aria-hidden="true" />
            <p className="text-sm font-semibold text-fg">3D 뷰포트를 시작하지 못했습니다.</p>
            <p className="mt-1 text-xs leading-relaxed text-fg-2">
              그래픽 가속을 확인한 뒤 뷰포트를 다시 열어 주세요.
            </p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function usePrefersReducedMotion(explicit: boolean | undefined): boolean {
  const [systemPreference, setSystemPreference] = useState(false);
  useEffect(() => {
    if (explicit !== undefined || typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setSystemPreference(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, [explicit]);
  return explicit ?? systemPreference;
}

function detectStudioHybridDccWebglCapability(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  if (/jsdom/iu.test(window.navigator.userAgent)) return false;
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2");
    if (!context) return false;
    context.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

function SegmentedButton({
  active,
  children,
  disabled = false,
  label,
  onClick,
}: {
  readonly active: boolean;
  readonly children: ReactNode;
  readonly disabled?: boolean;
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={classes(
        "inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-lg border px-2.5 text-[0.7rem] font-semibold transition-colors motion-reduce:transition-none sm:min-h-9",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        "disabled:cursor-not-allowed disabled:opacity-40",
        active
          ? "border-accent/55 bg-accent-soft text-accent"
          : "border-line bg-card text-fg-2 hover:bg-raised hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

export function StudioHybridDccViewport({
  workspace,
  onSelectAsset,
  projection,
  defaultProjection = "perspective",
  onProjectionChange,
  overlay,
  defaultOverlay = "material",
  onOverlayChange,
  reducedMotion,
  onCommitAssetTransform,
  componentSelection,
  onClearComponentSelection,
  onComponentSelectionError,
  onComponentSelectionModeChange,
  onDeleteSelected,
  onDuplicateSelected,
  onSelectComponent,
  editingDisabled = false,
  onSculptStroke,
  defaultTransformMode = "translate",
  defaultTransformSpace = "world",
  webglAvailable,
  className,
}: StudioHybridDccViewportProps) {
  const [uncontrolledProjection, setUncontrolledProjection] =
    useState<StudioHybridDccViewportProjection>(defaultProjection);
  const [uncontrolledOverlay, setUncontrolledOverlay] =
    useState<StudioHybridDccViewportOverlay>(defaultOverlay);
  const [contextLost, setContextLost] = useState(false);
  const [transformMode, setTransformMode] =
    useState<StudioHybridDccTransformMode>(defaultTransformMode);
  const [transformSpace, setTransformSpace] =
    useState<StudioHybridDccTransformSpace>(defaultTransformSpace);
  const [viewPreset, setViewPreset] = useState<StudioHybridDccViewportView>("isometric");
  const [frameTarget, setFrameTarget] = useState<"scene" | "selection">("scene");
  const [frameRevision, setFrameRevision] = useState(0);
  const [orientationRevision, setOrientationRevision] = useState(0);
  const [isolatedAssetId, setIsolatedAssetId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [interactionNotice, setInteractionNotice] = useState("");
  const draggingRef = useRef(false);
  const selectionGateRef = useRef<ReturnType<typeof createStudioHybridDccSelectionGate<ReturnType<typeof setTimeout>>> | null>(null);
  useEffect(() => {
    const gate = createStudioHybridDccSelectionGate(setTimeout, clearTimeout);
    selectionGateRef.current = gate;
    return () => { gate.dispose(); };
  }, []);
  const { preferences, patchPreferences, setPreferences } = useStudioHybridDccViewportPreferences();
  const [detectedWebgl, setDetectedWebgl] = useState<boolean | null>(webglAvailable ?? null);
  const viewportRef = useRef<HTMLElement>(null);
  const descriptionId = useId();
  const effectiveProjection = projection ?? uncontrolledProjection;
  const effectiveOverlay = overlay ?? uncontrolledOverlay;
  const effectiveTransformSpace = transformMode === "scale" ? "local" : transformSpace;
  const prefersReducedMotion = usePrefersReducedMotion(reducedMotion);
  const effectiveSelectionMode = componentSelection?.mode ?? "object";
  const snapshot = useMemo(
    () => deriveStudioHybridDccViewportSnapshot(workspace, effectiveSelectionMode),
    [workspace, effectiveSelectionMode],
  );
  const isolationMatchesSelection = !workspace.activeAssetId || workspace.activeAssetId === isolatedAssetId;
  const isolatedAsset = isolationMatchesSelection
    ? snapshot.assets.find((asset) => asset.assetId === isolatedAssetId) ?? null : null;
  const renderedAssets = isolatedAsset ? [isolatedAsset] : snapshot.assets;
  const selectedAssetId = snapshot.assets.some((asset) => asset.assetId === workspace.activeAssetId)
    ? workspace.activeAssetId
    : null;
  const selectedAsset = selectedAssetId
    ? snapshot.assets.find((asset) => asset.assetId === selectedAssetId) ?? null
    : null;
  const selectedElementIds = componentSelection
    && componentSelection.mode !== "object"
    && componentSelection.provenance?.assetId === selectedAssetId
    && componentSelection.provenance.meshRevision === selectedAsset?.meshRevision
    && componentSelection.provenance.sourceHash === selectedAsset?.meshHash
      ? componentSelection.elementIds
      : [];
  useEffect(() => {
    if (isolatedAssetId && !isolatedAsset) {
      setIsolatedAssetId(null);
      setInteractionNotice("격리 대상이나 선택이 바뀌어 전체 보기로 돌아왔습니다.");
    }
  }, [isolatedAssetId, isolatedAsset]);
  const effectiveFrameTarget = frameTarget === "selection" && selectedAsset ? "selection" : "scene";
  const framedCenter: readonly [number, number, number] = effectiveFrameTarget === "selection"
    ? [
        (selectedAsset!.worldMin[0] + selectedAsset!.worldMax[0]) / 2,
        (selectedAsset!.worldMin[1] + selectedAsset!.worldMax[1]) / 2,
        (selectedAsset!.worldMin[2] + selectedAsset!.worldMax[2]) / 2,
      ]
    : snapshot.center;
  const framedRadius = effectiveFrameTarget === "selection"
    ? Math.max(0.25, Math.hypot(
        selectedAsset!.worldMax[0] - selectedAsset!.worldMin[0],
        selectedAsset!.worldMax[1] - selectedAsset!.worldMin[1],
        selectedAsset!.worldMax[2] - selectedAsset!.worldMin[2],
      ) / 2)
    : snapshot.radius;
  const renderSources = new Set(snapshot.assets.map((asset) => asset.renderSource));
  const viewportRenderSource = snapshot.assets.length === 0
    ? "empty"
    : renderSources.size === 1
      ? snapshot.assets[0]!.renderSource
      : "mixed";
  const leadingDiagnostic = snapshot.errors[0] ?? snapshot.warnings[0] ?? null;
  const devicePixelRatio = typeof window === "undefined" ? 1 : window.devicePixelRatio;
  const maxDpr = resolveStudioHybridDccDpr(devicePixelRatio, 1);

  useEffect(() => {
    if (webglAvailable !== undefined) {
      setDetectedWebgl(webglAvailable);
      return;
    }
    setDetectedWebgl(detectStudioHybridDccWebglCapability());
  }, [webglAvailable]);

  const changeProjection = (next: StudioHybridDccViewportProjection) => {
    if (projection === undefined) setUncontrolledProjection(next);
    onProjectionChange?.(next);
  };
  const changeOverlay = (next: StudioHybridDccViewportOverlay) => {
    if (overlay === undefined) setUncontrolledOverlay(next);
    onOverlayChange?.(next);
  };
  const changeView = (next: StudioHybridDccViewportView) => {
    setViewPreset(next);
    setOrientationRevision((current) => current + 1);
    setFrameRevision((current) => current + 1);
    if (next !== "isometric") changeProjection("orthographic");
  };
  const frameScene = () => {
    setFrameTarget("scene");
    setFrameRevision((current) => current + 1);
  };
  const frameSelection = () => {
    if (!selectedAsset) return;
    setFrameTarget("selection");
    setFrameRevision((current) => current + 1);
  };

  const toggleIsolation = () => {
    if (draggingRef.current) return;
    if (isolatedAssetId) {
      setIsolatedAssetId(null);
      setFrameTarget("scene");
      setInteractionNotice("전체 보기 · 문서의 숨김 상태는 변경하지 않았습니다.");
    } else if (selectedAsset) {
      setIsolatedAssetId(selectedAsset.assetId);
      setFrameTarget("selection");
      setInteractionNotice(`${selectedAsset.assetId}만 보기 · / 키로 전체 보기`);
    } else return;
    setFrameRevision((current) => current + 1);
  };
  const changeDragging = (active: boolean) => {
    draggingRef.current = active;
    setDragging(active);
    if (!active) selectionGateRef.current?.suppress();
  };
  const selectionAllowed = () => !editingDisabled && !draggingRef.current
    && (selectionGateRef.current?.allows() ?? true);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const handleViewportShortcut = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || !viewport.contains(target)) return;
      // Shift+Tab remains normal backwards focus navigation on toolbar controls.
      if (event.shiftKey && event.key === "Tab" && !(target instanceof HTMLCanvasElement)
        && !target.closest('[role="application"]')) return;
      const action = resolveStudioHybridDccViewportShortcut(event, {
        textEntry: Boolean(target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="spinbutton"]')),
        selected: Boolean(selectedAsset), editingDisabled: editingDisabled || Boolean(onSculptStroke),
        objectMode: effectiveSelectionMode === "object", canTransform: Boolean(onCommitAssetTransform),
        canSelectComponents: Boolean(onComponentSelectionModeChange), canDuplicate: Boolean(onDuplicateSelected),
        canDelete: Boolean(onDeleteSelected), dragging: draggingRef.current,
      });
      if (!action) return;
      if (action.kind === "toggle-isolation" && !isolatedAssetId && !selectedAsset) return;
      event.preventDefault();
      switch (action.kind) {
        case "view":
          setViewPreset(action.view);
          setOrientationRevision((current) => current + 1);
          setFrameRevision((current) => current + 1);
          if (projection === undefined) setUncontrolledProjection("orthographic");
          onProjectionChange?.("orthographic");
          break;
        case "frame":
          setFrameTarget(action.target);
          setFrameRevision((current) => current + 1);
          break;
        case "toggle-projection": {
          const next = effectiveProjection === "perspective" ? "orthographic" : "perspective";
          if (projection === undefined) setUncontrolledProjection(next);
          onProjectionChange?.(next);
          break;
        }
        case "toggle-snap": setPreferences((current) => ({ ...current, snapping: !current.snapping })); break;
        case "toggle-isolation":
          setIsolatedAssetId(isolatedAssetId ? null : selectedAsset!.assetId);
          setFrameTarget(isolatedAssetId ? "scene" : "selection");
          setFrameRevision((current) => current + 1);
          break;
        case "transform": setTransformMode(action.mode); break;
        case "selection": onComponentSelectionModeChange?.(action.mode); break;
        case "duplicate": onDuplicateSelected?.(); break;
        case "delete": onDeleteSelected?.(); break;
      }
    };
    viewport.addEventListener("keydown", handleViewportShortcut);
    return () => viewport.removeEventListener("keydown", handleViewportShortcut);
  }, [onCommitAssetTransform, onDeleteSelected, onDuplicateSelected,
    onComponentSelectionModeChange, onProjectionChange, projection, effectiveProjection,
    selectedAsset, editingDisabled, effectiveSelectionMode, onSculptStroke, isolatedAssetId, setPreferences]);

  return (
    <>
    <section
      ref={viewportRef}
      aria-label="Hybrid DCC 3D 작업 뷰포트"
      aria-describedby={descriptionId}
      className={classes(
        "relative isolate h-[clamp(20rem,58dvh,42rem)] min-h-80 w-full overflow-hidden rounded-2xl border border-line bg-canvas text-fg",
        "shadow-[0_18px_48px_oklch(0.08_0.008_70/0.34)]",
        className,
      )}
      data-studio-hybrid-dcc-viewport="true"
      data-projection={effectiveProjection}
      data-overlay={effectiveOverlay}
      data-context-lost={contextLost ? "true" : "false"}
      data-transform-mode={transformMode}
      data-transform-space={effectiveTransformSpace}
      data-selection-mode={effectiveSelectionMode}
      data-selected-elements={selectedElementIds.length}
      data-editing-disabled={editingDisabled ? "true" : "false"}
      data-view-preset={viewPreset}
      data-frame-target={effectiveFrameTarget}
      data-render-source={viewportRenderSource}
      data-render-signature={snapshot.signature}
      data-isolated-asset={isolatedAsset?.assetId ?? ""}
      data-visible-assets={renderedAssets.length}
      data-snapping={preferences.snapping ? "true" : "false"}
      data-dragging={dragging ? "true" : "false"}
      data-frame-revision={frameRevision}
    >
      <p id={descriptionId} className="sr-only">
        마우스 왼쪽 드래그로 회전하고, 오른쪽 드래그로 이동하며, 휠로 확대하거나 축소합니다.
        선택 오브젝트는 G 이동, R 회전, S 크기 조절 기즈모로 편집합니다.
        Shift와 D는 선택 오브젝트 복제, Delete는 되돌릴 수 있는 삭제입니다.
        숫자 1, 2, 3, 4는 꼭짓점, 모서리, 면, 오브젝트 선택 모드입니다.
        숫자 키패드 1, 3, 7은 정면, 우측, 상단, Ctrl 조합은 반대편 보기입니다.
        키패드 5는 투영 전환, /는 선택 격리, Home은 전체, F 또는 마침표는 선택 화면 맞춤입니다.
        캔버스에서 Shift+Tab은 스냅 전환, Esc는 진행 중인 변형 취소입니다.
      </p>

      {snapshot.assets.length > 0 && detectedWebgl === true ? (
        <StudioHybridDccCanvasBoundary>
          <Canvas
            aria-label="편집 메시 3D 렌더"
            aria-describedby={descriptionId}
            tabIndex={0}
            dpr={[STUDIO_HYBRID_DCC_RENDER_PROFILE.minDpr, maxDpr]}
            frameloop="demand"
            gl={{
              alpha: false,
              antialias: true,
              powerPreference: "high-performance",
            }}
            shadows={{ enabled: true, type: STUDIO_HYBRID_DCC_RENDER_PROFILE.shadowMapType }}
            onCreated={({ gl }) => {
              applyStudioHybridDccRendererProfile(gl);
              // React Three Fiber keeps several DOM props on its wrapper instead of forwarding
              // them to the authoritative WebGL canvas. The canvas itself owns pointer and
              // keyboard editing, so expose the same accessible name and instructions there.
              gl.domElement.setAttribute("role", "application");
              gl.domElement.setAttribute("aria-label", "편집 메시 3D 렌더");
              gl.domElement.setAttribute("aria-describedby", descriptionId);
              gl.domElement.tabIndex = 0;
            }}
            onPointerMissed={() => {
              if (!selectionAllowed()) return;
              if (effectiveSelectionMode === "object") onSelectAsset(null);
              else onClearComponentSelection?.();
            }}
          >
            <color attach="background" args={[VIEWPORT_COLORS.background]} />
            {effectiveProjection === "orthographic" ? (
              <OrthographicCamera makeDefault near={0.001} far={10_000} position={[5, 4, 6]} />
            ) : (
              <PerspectiveCamera makeDefault fov={42} near={0.001} far={10_000} position={[5, 4, 6]} />
            )}
            <OrbitControls
              makeDefault
              enableDamping={!prefersReducedMotion}
              dampingFactor={0.08}
              enablePan
              enableRotate
              enableZoom
              minDistance={0.05}
              maxDistance={Math.max(120, snapshot.radius * 24)}
              regress
            />
            <StudioHybridDccCameraRig
              center={framedCenter}
              radius={framedRadius}
              intent={{ revision: frameRevision, orientationRevision, view: viewPreset }}
              sceneCenter={snapshot.center}
              sceneRadius={snapshot.radius}
            />
            <StudioHybridDccAdaptiveDpr />
            <StudioHybridDccLocalEnvironment />
            <StudioHybridDccWebglLifecycle onContextLostChange={setContextLost} />
            <StudioHybridDccLightRig radius={snapshot.radius} />

            <group>
              {preferences.showGrid ? <gridHelper
                args={[
                  snapshot.gridSize,
                  Math.min(96, Math.max(12, snapshot.gridSize * 2)),
                  VIEWPORT_COLORS.gridMajor,
                  VIEWPORT_COLORS.gridMinor,
                ]}
                position={[0, -0.002, 0]}
              /> : null}
              {preferences.showAxes ? <axesHelper args={[Math.max(1.2, snapshot.radius * 0.22)]} position={[0, 0.012, 0]} /> : null}
              {preferences.showGround ? <mesh
                receiveShadow
                rotation-x={-Math.PI / 2}
                position={[0, -0.006, 0]}
              >
                <planeGeometry args={[snapshot.gridSize, snapshot.gridSize]} />
                <shadowMaterial transparent opacity={0.2} depthWrite={false} />
              </mesh> : null}
            </group>

            {renderedAssets.map((asset) => (
              <StudioHybridDccAssetMesh
                key={`${asset.assetId}:${asset.renderHash}:${asset.renderSource}`}
                asset={asset}
                overlay={effectiveOverlay}
                selected={asset.assetId === selectedAssetId}
                onSelect={(assetId) => { if (selectionAllowed()) onSelectAsset(assetId); }}
                onSelectComponent={onSelectComponent
                  ? (...args) => { if (selectionAllowed()) onSelectComponent(...args); }
                  : undefined}
                onSelectionError={onComponentSelectionError}
                selectionElementIds={selectedElementIds}
                selectionMode={effectiveSelectionMode}
                editingDisabled={editingDisabled}
                onCommitTransform={onCommitAssetTransform}
                transformMode={transformMode}
                transformSpace={effectiveTransformSpace}
                preferences={preferences}
                onDraggingChange={changeDragging}
                onNotice={setInteractionNotice}
                sculptStroke={onSculptStroke && asset.assetId === selectedAssetId
                  ? (localPoint) => onSculptStroke(asset.assetId, localPoint)
                  : undefined}
              />
            ))}
            {preferences.showGround ? <ContactShadows
              key={snapshot.signature}
              position={[snapshot.center[0], 0.004, snapshot.center[2]]}
              color={VIEWPORT_COLORS.background}
              opacity={0.38}
              scale={snapshot.gridSize * 0.82}
              blur={2.4}
              far={Math.max(4, snapshot.radius * 3)}
              resolution={prefersReducedMotion ? 256 : 512}
              frames={1}
              depthWrite={false}
            /> : null}
          </Canvas>
        </StudioHybridDccCanvasBoundary>
      ) : snapshot.assets.length > 0 && detectedWebgl === null ? (
        <div className="absolute inset-0 grid place-items-center px-5 text-center" role="status">
          <div className="max-w-sm">
            <CircleDashed className="mx-auto mb-3 animate-spin text-fg-3 motion-reduce:animate-none" size={26} aria-hidden="true" />
            <p className="text-sm font-semibold text-fg">3D 렌더러를 확인하는 중입니다.</p>
          </div>
        </div>
      ) : snapshot.assets.length > 0 && detectedWebgl === false ? (
        <div className="absolute inset-0 grid place-items-center px-5 text-center" role="alert">
          <div className="max-w-sm">
            <AlertTriangle className="mx-auto mb-3 text-warn" size={26} aria-hidden="true" />
            <p className="text-sm font-semibold text-fg">WebGL 3D 렌더링을 사용할 수 없습니다.</p>
            <p className="mt-1 text-xs leading-relaxed text-fg-2">
              브라우저의 하드웨어 가속을 켠 뒤 뷰포트를 다시 열어 주세요. 편집 메시 원본은 변경되지 않았습니다.
            </p>
          </div>
        </div>
      ) : (
        <div className="absolute inset-0 grid place-items-center px-5 text-center">
          <div className="max-w-sm">
            {snapshot.errors.length > 0 ? (
              <AlertTriangle className="mx-auto mb-3 text-bad" size={26} aria-hidden="true" />
            ) : (
              <CircleDashed className="mx-auto mb-3 text-fg-3" size={26} aria-hidden="true" />
            )}
            <p className="text-sm font-semibold text-fg">
              {snapshot.errors.length > 0 ? "표시할 수 있는 메시가 없습니다." : "3D 작업대가 비어 있습니다."}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-fg-2">
              {snapshot.errors.length > 0
                ? snapshot.errors[0]?.message
                  ?? "메시 진단을 실행해 잘못된 정점 또는 면을 복구해 주세요."
                : "큐브를 추가하거나 모델을 가져오면 실제 편집 메시가 여기에 나타납니다."}
            </p>
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-wrap items-start justify-between gap-2 p-2 sm:p-3">
        <div className="pointer-events-auto rounded-xl border border-line bg-panel/95 px-3 py-2 shadow-[0_8px_22px_oklch(0.08_0.008_70/0.28)]">
          <div className="flex items-center gap-2">
            <Boxes size={15} className="text-accent" aria-hidden="true" />
            <span className="text-xs font-semibold text-fg">3D 작업 뷰</span>
          </div>
          <p className="mt-0.5 font-[var(--font-display)] text-[0.66rem] tabular-nums text-fg-2" aria-live="polite">
            V {snapshot.totalVertices.toLocaleString("ko-KR")} · △ {snapshot.totalTriangles.toLocaleString("ko-KR")}
          </p>
          <p className="mt-0.5 text-[0.62rem] text-fg-3">
            {effectiveSelectionMode === "object"
              ? snapshot.assets.some(({ renderSource }) => renderSource === "modifier-cache")
                ? "검증된 변형 결과 표시"
                : "편집 원본 표시"
              : "안정 ID 원본 케이지"}
          </p>
        </div>

        <div className="pointer-events-auto flex max-w-full gap-1 overflow-x-auto rounded-xl border border-line bg-panel/95 p-1 shadow-[0_8px_22px_oklch(0.08_0.008_70/0.28)]">
          {onComponentSelectionModeChange ? (
            <>
              <div className="flex gap-1" role="group" aria-label="메시 선택 모드">
                {([
                  { id: "object", label: "오브젝트", accessible: "오브젝트 선택 모드 (4)" },
                  { id: "vertex", label: "점", accessible: "꼭짓점 선택 모드 (1)" },
                  { id: "edge", label: "선", accessible: "모서리 선택 모드 (2)" },
                  { id: "face", label: "면", accessible: "면 선택 모드 (3)" },
                ] as const).map((option) => (
                  <SegmentedButton
                    key={option.id}
                    active={effectiveSelectionMode === option.id}
                    disabled={editingDisabled || (option.id !== "object" && !selectedAsset)}
                    label={option.accessible}
                    onClick={() => onComponentSelectionModeChange(option.id)}
                  >
                    {option.label}
                  </SegmentedButton>
                ))}
              </div>
              <span className="my-1 w-px shrink-0 bg-line" aria-hidden="true" />
            </>
          ) : null}
          {onCommitAssetTransform && effectiveSelectionMode === "object" ? (
            <>
              <div className="flex gap-1" role="group" aria-label="오브젝트 변환 도구">
                <SegmentedButton
                  active={transformMode === "translate"}
                  disabled={editingDisabled}
                  label="이동 도구 (G)"
                  onClick={() => setTransformMode("translate")}
                >
                  <Move3d size={14} aria-hidden="true" /> 이동
                </SegmentedButton>
                <SegmentedButton
                  active={transformMode === "rotate"}
                  disabled={editingDisabled}
                  label="회전 도구 (R)"
                  onClick={() => setTransformMode("rotate")}
                >
                  <Rotate3d size={14} aria-hidden="true" /> 회전
                </SegmentedButton>
                <SegmentedButton
                  active={transformMode === "scale"}
                  disabled={editingDisabled}
                  label="크기 조절 도구 (S)"
                  onClick={() => setTransformMode("scale")}
                >
                  <Expand size={14} aria-hidden="true" /> 크기
                </SegmentedButton>
                <SegmentedButton
                  active={effectiveTransformSpace === "local"}
                  disabled={editingDisabled || transformMode === "scale"}
                  label={effectiveTransformSpace === "local" ? "로컬 좌표계" : "월드 좌표계"}
                  onClick={() => setTransformSpace((current) => current === "world" ? "local" : "world")}
                >
                  {effectiveTransformSpace === "local" ? "Local" : "World"}
                </SegmentedButton>
              </div>
              <span className="my-1 w-px shrink-0 bg-line" aria-hidden="true" />
            </>
          ) : null}
          <div className="flex gap-1" role="group" aria-label="투영 방식">
            <SegmentedButton
              active={effectiveProjection === "perspective"}
              label="원근 투영"
              onClick={() => changeProjection("perspective")}
            >
              <Camera size={14} aria-hidden="true" /> 원근
            </SegmentedButton>
            <SegmentedButton
              active={effectiveProjection === "orthographic"}
              label="직교 투영"
              onClick={() => changeProjection("orthographic")}
            >
              <Layers size={14} aria-hidden="true" /> 직교
            </SegmentedButton>
          </div>
          <span className="my-1 w-px shrink-0 bg-line" aria-hidden="true" />
          <div className="flex gap-1" role="group" aria-label="표준 보기와 화면 맞춤">
            {([
              { id: "isometric", label: "등각", accessible: "등각 보기" },
              { id: "front", label: "앞", accessible: "정면 보기 (숫자 키패드 1)" },
              { id: "right", label: "오른쪽", accessible: "우측 보기 (숫자 키패드 3)" },
              { id: "top", label: "위", accessible: "상단 보기 (숫자 키패드 7)" },
              { id: "back", label: "뒤", accessible: "후면 보기 (Ctrl+숫자 키패드 1)" },
              { id: "left", label: "왼쪽", accessible: "좌측 보기 (Ctrl+숫자 키패드 3)" },
              { id: "bottom", label: "아래", accessible: "하단 보기 (Ctrl+숫자 키패드 7)" },
            ] as const).map((option) => (
              <SegmentedButton
                key={option.id}
                active={viewPreset === option.id}
                label={option.accessible}
                onClick={() => changeView(option.id)}
              >
                {option.label}
              </SegmentedButton>
            ))}
            <SegmentedButton
              active={effectiveFrameTarget === "scene"}
              label="전체 장면 화면 맞춤 (Home)"
              onClick={frameScene}
            >
              전체 맞춤
            </SegmentedButton>
            <SegmentedButton
              active={effectiveFrameTarget === "selection"}
              disabled={!selectedAsset}
              label="선택 오브젝트 화면 맞춤 (마침표)"
              onClick={frameSelection}
            >
              선택 맞춤
            </SegmentedButton>
          </div>
          <span className="my-1 w-px shrink-0 bg-line" aria-hidden="true" />
          <div className="flex gap-1" role="group" aria-label="표현 모드">
            {OVERLAY_OPTIONS.map((option) => (
              <SegmentedButton
                key={option.id}
                active={effectiveOverlay === option.id}
                label={`${option.label} 표현`}
                onClick={() => changeOverlay(option.id)}
              >
                {option.id === "material" ? (
                  <Boxes size={14} aria-hidden="true" />
                ) : option.id === "material-wire" ? (
                  <Layers size={14} aria-hidden="true" />
                ) : (
                  <Triangle size={14} aria-hidden="true" />
                )}
                {option.label}
              </SegmentedButton>
            ))}
          </div>
        </div>
      </div>

      {snapshot.assets.length > 0 ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-2 p-2 sm:p-3">
          <div className="pointer-events-auto flex max-w-[min(72%,34rem)] gap-1 overflow-x-auto rounded-xl border border-line bg-panel/95 p-1 shadow-[0_8px_22px_oklch(0.08_0.008_70/0.28)]" aria-label="뷰포트 에셋">
            {renderedAssets.map((asset) => {
              const selected = asset.assetId === selectedAssetId;
              return (
                <button
                  key={asset.assetId}
                  type="button"
                  aria-pressed={selected}
                  data-material-id={asset.materialId}
                  data-render-hash={asset.renderHash}
                  data-render-source={asset.renderSource}
                  disabled={editingDisabled}
                  onClick={() => { if (selectionAllowed()) onSelectAsset(asset.assetId); }}
                  className={classes(
                    "min-h-11 max-w-40 shrink-0 rounded-lg border px-2.5 text-left transition-colors motion-reduce:transition-none sm:min-h-9",
                    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                    selected
                      ? "border-accent/55 bg-accent-soft text-accent"
                      : "border-transparent text-fg-2 hover:border-line hover:bg-raised hover:text-fg",
                  )}
                >
                  <span className="block truncate text-[0.7rem] font-semibold">{asset.assetId}</span>
                  <span className="block font-[var(--font-display)] text-[0.62rem] tabular-nums opacity-75">
                    {asset.triangleCount.toLocaleString("ko-KR")} tris · {
                      asset.renderSource === "modifier-cache"
                        ? "변형 결과"
                        : asset.renderSource === "authority-edit-cage"
                          ? "원본 케이지"
                          : asset.renderSource === "authority-cache-fallback"
                            ? "원본 대체"
                            : "편집 원본"
                    }
                  </span>
                </button>
              );
            })}
          </div>
          <div className="hidden rounded-lg border border-line bg-panel/95 px-2.5 py-1.5 text-[0.64rem] text-fg-2 min-[390px]:block">
            {effectiveSelectionMode === "object"
              ? "G 이동 · R 회전 · S 크기 · Shift+D 복제 · Delete 삭제"
              : `${effectiveSelectionMode === "vertex" ? "꼭짓점" : effectiveSelectionMode === "edge" ? "모서리" : "면"} ${selectedElementIds.length}개 선택 · Shift 추가 · Ctrl 전환 · Alt 빼기`}
          </div>
        </div>
      ) : null}

      <p className="sr-only" aria-live="polite" data-studio-hybrid-dcc-selection-announcement="true">
        {effectiveSelectionMode === "object"
          ? selectedAssetId
            ? `${selectedAssetId} 오브젝트 선택됨`
            : "선택한 오브젝트 없음"
          : `${effectiveSelectionMode === "vertex" ? "꼭짓점" : effectiveSelectionMode === "edge" ? "모서리" : "면"} ${selectedElementIds.length}개 선택됨`}
      </p>

      {(snapshot.errors.length > 0 || snapshot.warnings.length > 0)
        && snapshot.assets.length > 0 ? (
        <div className="absolute bottom-16 right-2 z-20 max-w-[min(calc(100%-1rem),24rem)] rounded-lg border border-warn/45 bg-panel px-3 py-2 text-xs text-warn sm:bottom-16 sm:right-3" role="status">
          <span className="flex items-center gap-1.5 font-semibold">
            <AlertTriangle size={14} aria-hidden="true" />
            {snapshot.errors.length > 0
              ? `${snapshot.errors.length}개 메시를 제외했습니다.`
              : `${snapshot.warnings.length}개 변형 미리보기를 원본으로 대체했습니다.`}
            {snapshot.errors.length > 0 && snapshot.warnings.length > 0
              ? ` · 원본 대체 ${snapshot.warnings.length}개`
              : null}
          </span>
          <span className="mt-0.5 block truncate text-[0.66rem] text-fg-2">
            {leadingDiagnostic?.assetId}: {leadingDiagnostic?.message}
          </span>
        </div>
      ) : null}

      {contextLost ? (
        <div className="absolute inset-0 z-30 grid place-items-center bg-canvas/95 px-5 text-center" role="alert">
          <div className="max-w-sm">
            <AlertTriangle className="mx-auto mb-3 text-warn" size={26} aria-hidden="true" />
            <p className="text-sm font-semibold text-fg">그래픽 컨텍스트가 중단되었습니다.</p>
            <p className="mt-1 text-xs leading-relaxed text-fg-2">
              브라우저가 WebGL을 복구할 때까지 3D 미리보기를 잠시 멈췄습니다.
            </p>
          </div>
        </div>
      ) : null}
    </section>
    <StudioHybridDccViewportInteractionBar
      preferences={preferences}
      onChange={patchPreferences}
      isolatedAssetId={isolatedAsset?.assetId ?? null}
      hasSelection={Boolean(selectedAsset)}
      dragging={dragging}
      onToggleIsolation={toggleIsolation}
      notice={interactionNotice}
    />
    </>
  );
}
