/**
 * Studio PBR — 방향광 섀도우 맵 수학 (순수 TS)
 *
 * 단일 캐스케이드 직교 섀도우 맵의 행렬 구성과 PCF 필터링을 담는다. GPU 없이
 * Float32Array 깊이 맵만 있으면 전부 검증되므로 node 테스트에서 그대로 돈다.
 *
 * 【필터 선택 근거 — 왜 고정 격자 PCF 인가】
 *  1. 회전 포아송/노이즈 오프셋은 **쓰지 않는다.** 픽셀마다 난수 회전을 쓰면 같은 씬을
 *     두 번 렌더할 때 결과가 달라져 이 레포의 결정성 하드 계약을 정면으로 깬다.
 *  2. VSM/ESM 도 배제한다. 겹친 캐스터에서 light bleeding 이 생기는데, LT 톤 패스가
 *     휘도를 밴드로 양자화하면 그 새는 빛이 통째로 한 밴드를 옮겨버려 그림자 실루엣이
 *     뭉개진다. 웹툰 배경 가독성의 최대 단서가 그림자 실루엣이라 치명적이다.
 *  3. 그래서 **작고 고정된 커널**(3×3 균등 / 5×5 이항)만 제공한다. 넓은 소프트 필터는
 *     cel 양자화 뒤에 밴드 노이즈로 남는다 — 또렷한 실루엣이 부드러움보다 중요하다.
 *
 * 【텍셀 스냅】 직교 절두체를 씬 바운딩 **구**(회전 불변)로 잡고, 라이트 공간 중심을
 *  텍셀 크기의 정수배로 양자화한다. 카메라/바운즈가 텍셀 이하로 흔들려도 행렬이 바이트
 *  동일하게 유지되므로 그림자 가장자리가 기어다니는(shimmering) 현상이 사라진다.
 *  테스트가 "텍셀 미만 이동 → 행렬 동일, 텍셀 초과 이동 → 행렬 변화"를 직접 단언한다.
 *
 * 【정직한 한계】
 *  - 캐스케이드 1장뿐이다. CSM(다중 분할)·PSSM 없음. 넓은 야외 씬에서는 해상도가 모자란다.
 *  - 점광원/스포트 섀도우(큐브맵, 원근 투영) 없음. 방향광 전용.
 *  - 컨택트 하드닝(PCSS), 블로커 탐색 없음 — 페넘브라 폭이 거리에 따라 변하지 않는다.
 *  - 행렬은 열 우선(column-major) 16 요소 배열이다(WebGL/three 규약).
 */

export interface StudioPbrVec3Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface StudioPbrBounds {
  readonly min: StudioPbrVec3Like;
  readonly max: StudioPbrVec3Like;
}

export interface StudioPbrShadowMatrixOptions {
  /** 광원이 **향하는** 방향(정규화 전이어도 된다). */
  readonly direction: StudioPbrVec3Like;
  readonly sceneBounds: StudioPbrBounds;
  /** 섀도우 맵 한 변(2의 거듭제곱 권장: 256..4096). */
  readonly mapSize: number;
  /** true 면 라이트 공간 중심을 텍셀 격자에 스냅한다(기본 true). */
  readonly texelSnap?: boolean;
  /** 절두체 근평면 여유(캐스터가 절두체 밖으로 밀려나지 않게). 기본 반지름의 1배. */
  readonly depthPadding?: number;
}

export interface StudioPbrShadowMatrix {
  /** 열 우선 4×4 라이트 뷰 행렬. */
  readonly view: Float64Array;
  /** 열 우선 4×4 직교 투영 행렬. */
  readonly projection: Float64Array;
  /** projection · view (열 우선). 월드 → 라이트 클립. */
  readonly viewProjection: Float64Array;
  /** 텍셀 하나가 덮는 월드 크기. 노멀 오프셋 바이어스 계산에 쓴다. */
  readonly texelWorldSize: number;
  /** 절두체를 감싼 바운딩 구 반지름. */
  readonly radius: number;
}

function normalize(v: StudioPbrVec3Like): StudioPbrVec3Like {
  const length = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (!(length > 0)) throw new Error("studio-pbr: 광원 방향이 영벡터다");
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

function cross(a: StudioPbrVec3Like, b: StudioPbrVec3Like): StudioPbrVec3Like {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function dot(a: StudioPbrVec3Like, b: StudioPbrVec3Like): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/**
 * 방향광 섀도우 행렬을 만든다.
 *
 * 절두체 크기를 바운딩 **구** 지름으로 고정하는 것이 핵심이다. AABB 를 쓰면 광원이
 * 회전할 때 절두체 폭이 변해 텍셀 크기가 같이 변하고, 그러면 스냅 격자 자체가
 * 흔들려서 스냅이 무의미해진다. 구는 회전 불변이라 텍셀 크기가 상수로 고정된다.
 */
export function buildStudioPbrDirectionalShadowMatrix(
  options: StudioPbrShadowMatrixOptions,
): StudioPbrShadowMatrix {
  const { mapSize } = options;
  if (!Number.isInteger(mapSize) || mapSize < 2) {
    throw new Error(`studio-pbr: mapSize 는 2 이상 정수여야 한다 (${mapSize})`);
  }
  const forward = normalize(options.direction);
  const { min, max } = options.sceneBounds;
  const center: StudioPbrVec3Like = {
    x: (min.x + max.x) / 2,
    y: (min.y + max.y) / 2,
    z: (min.z + max.z) / 2,
  };
  const half = { x: (max.x - min.x) / 2, y: (max.y - min.y) / 2, z: (max.z - min.z) / 2 };
  const radius = Math.sqrt(half.x * half.x + half.y * half.y + half.z * half.z) || 1e-4;

  // 라이트 공간 기저: -forward 가 +Z(뷰 공간 관례상 카메라가 -Z 를 본다).
  const zAxis = { x: -forward.x, y: -forward.y, z: -forward.z };
  const upGuess = Math.abs(zAxis.y) > 0.999 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };
  const xAxis = normalize(cross(upGuess, zAxis));
  const yAxis = cross(zAxis, xAxis);

  const texelWorldSize = (2 * radius) / mapSize;
  // 라이트 공간에서의 중심 좌표(회전만 적용).
  let cx = dot(center, xAxis);
  let cy = dot(center, yAxis);
  let cz = dot(center, zAxis);
  if (options.texelSnap !== false) {
    // x/y 뿐 아니라 z 도 같은 양자로 스냅한다. z 를 놔두면 씬이 텍셀 이하로 움직여도
    // 깊이 원점이 따라 흘러 저장 깊이가 미세하게 바뀌고, 그게 그대로 가장자리
    // 기어다님으로 돌아온다(테스트가 이 구멍을 잡아냈다).
    cx = Math.round(cx / texelWorldSize) * texelWorldSize;
    cy = Math.round(cy / texelWorldSize) * texelWorldSize;
    cz = Math.round(cz / texelWorldSize) * texelWorldSize;
  }

  // view = R^T · T(-center). 열 우선 배치.
  const view = new Float64Array(16);
  view[0] = xAxis.x;
  view[4] = xAxis.y;
  view[8] = xAxis.z;
  view[12] = -cx;
  view[1] = yAxis.x;
  view[5] = yAxis.y;
  view[9] = yAxis.z;
  view[13] = -cy;
  view[2] = zAxis.x;
  view[6] = zAxis.y;
  view[10] = zAxis.z;
  view[14] = -cz;
  view[15] = 1;

  const padding = options.depthPadding ?? radius;
  const near = -(radius + padding);
  const far = radius + padding;
  // 직교 투영: x,y 는 ±radius, z 는 [near, far] → [-1, 1].
  const projection = new Float64Array(16);
  projection[0] = 1 / radius;
  projection[5] = 1 / radius;
  projection[10] = -2 / (far - near);
  projection[14] = -(far + near) / (far - near);
  projection[15] = 1;

  const viewProjection = multiply4x4(projection, view);
  return { view, projection, viewProjection, texelWorldSize, radius };
}

/** 열 우선 4×4 곱 (a·b). */
export function multiply4x4(a: Float64Array, b: Float64Array): Float64Array {
  const out = new Float64Array(16);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

/** 월드 좌표 → 섀도우 맵 UV(0..1) + 깊이(0..1). 절두체 밖이면 outside=true. */
export function projectStudioPbrShadowUv(
  viewProjection: Float64Array,
  point: StudioPbrVec3Like,
): { readonly u: number; readonly v: number; readonly depth: number; readonly outside: boolean } {
  const m = viewProjection;
  const x = m[0] * point.x + m[4] * point.y + m[8] * point.z + m[12];
  const y = m[1] * point.x + m[5] * point.y + m[9] * point.z + m[13];
  const z = m[2] * point.x + m[6] * point.y + m[10] * point.z + m[14];
  const u = x * 0.5 + 0.5;
  const v = 0.5 - y * 0.5; // 텍스처 v 는 아래로 증가
  const depth = z * 0.5 + 0.5;
  const outside = u < 0 || u > 1 || v < 0 || v > 1 || depth < 0 || depth > 1;
  return { u, v, depth, outside };
}

// ---------------------------------------------------------------------------
// PCF 커널 — 고정 오프셋/가중치 (난수 회전 없음)
// ---------------------------------------------------------------------------

export interface StudioPbrPcfTap {
  /** 텍셀 단위 오프셋. */
  readonly dx: number;
  readonly dy: number;
  readonly weight: number;
}

export interface StudioPbrPcfKernel {
  readonly id: "pcf3x3" | "pcf5x5";
  readonly label: string;
  readonly radius: number;
  readonly taps: readonly StudioPbrPcfTap[];
}

function buildKernel(id: "pcf3x3" | "pcf5x5", label: string, weights1d: readonly number[]): StudioPbrPcfKernel {
  const radius = (weights1d.length - 1) / 2;
  const total = weights1d.reduce((a, b) => a + b, 0);
  const taps: StudioPbrPcfTap[] = [];
  for (let j = 0; j < weights1d.length; j += 1) {
    for (let i = 0; i < weights1d.length; i += 1) {
      taps.push({
        dx: i - radius,
        dy: j - radius,
        weight: (weights1d[i] * weights1d[j]) / (total * total),
      });
    }
  }
  return { id, label, radius, taps };
}

/** 3×3 균등 PCF — 실루엣을 가장 또렷하게 남긴다(기본값). */
export const STUDIO_PBR_PCF_KERNEL_3X3 = buildKernel("pcf3x3", "PCF 3×3 (또렷)", [1, 1, 1]);
/** 5×5 이항(1,4,6,4,1) PCF — 살짝 부드럽게. cel 밴드가 많을 때만 권장. */
export const STUDIO_PBR_PCF_KERNEL_5X5 = buildKernel("pcf5x5", "PCF 5×5 (부드럽게)", [1, 4, 6, 4, 1]);

export const STUDIO_PBR_PCF_KERNELS = [STUDIO_PBR_PCF_KERNEL_3X3, STUDIO_PBR_PCF_KERNEL_5X5] as const;

export type StudioPbrPcfKernelId = (typeof STUDIO_PBR_PCF_KERNELS)[number]["id"];

export interface StudioPbrPcfOptions {
  readonly kernel?: StudioPbrPcfKernel;
  /** 상수 깊이 바이어스(0..1 깊이 공간). */
  readonly constantBias?: number;
  /** 경사 비례 바이어스 — (1 - n·l) 에 비례해 더 밀어준다. */
  readonly slopeScaledBias?: number;
  /** 경사 바이어스 계산에 쓰는 n·l. 미지정이면 1(정면). */
  readonly nDotL?: number;
  /** 맵 밖 샘플을 "빛 받음"(1)으로 볼지. 기본 true. */
  readonly outsideIsLit?: boolean;
}

/**
 * 섀도우 맵 PCF 샘플링 → 가시도 [0,1] (1 = 완전히 빛을 받음).
 *
 * depthMap 은 mapSize² 개의 [0,1] 깊이(라이트에서 가장 가까운 캐스터)다. 각 탭에서
 * 저장된 깊이보다 수신자가 멀면(= 뒤에 있으면) 그림자로 센다. 커널 가중치 합이 1 이라
 * 반환값이 그대로 가시 비율이다.
 */
export function sampleStudioPbrPcf(
  depthMap: Float32Array,
  mapSize: number,
  u: number,
  v: number,
  receiverDepth: number,
  options: StudioPbrPcfOptions = {},
): number {
  if (depthMap.length !== mapSize * mapSize) {
    throw new Error(`studio-pbr: depthMap 길이 불일치 (기대 ${mapSize * mapSize}, 실제 ${depthMap.length})`);
  }
  const kernel = options.kernel ?? STUDIO_PBR_PCF_KERNEL_3X3;
  const outsideIsLit = options.outsideIsLit !== false;
  const nDotL = options.nDotL ?? 1;
  const bias =
    (options.constantBias ?? 0) + (options.slopeScaledBias ?? 0) * (1 - Math.min(1, Math.max(0, nDotL)));
  const compareDepth = receiverDepth - bias;
  const baseX = Math.floor(u * mapSize);
  const baseY = Math.floor(v * mapSize);
  let visibility = 0;
  for (const tap of kernel.taps) {
    const x = baseX + tap.dx;
    const y = baseY + tap.dy;
    if (x < 0 || y < 0 || x >= mapSize || y >= mapSize) {
      if (outsideIsLit) visibility += tap.weight;
      continue;
    }
    const stored = depthMap[y * mapSize + x];
    if (compareDepth <= stored) visibility += tap.weight;
  }
  return visibility;
}

/**
 * 노멀 오프셋 바이어스 — 표면을 법선 방향으로 텍셀 크기만큼 밀어 셀프 섀도우 아크네를
 * 없앤다. 상수 깊이 바이어스보다 피터패닝이 적어 얇은 물체에 안전하다.
 */
export function applyStudioPbrNormalOffset(
  point: StudioPbrVec3Like,
  normal: StudioPbrVec3Like,
  texelWorldSize: number,
  nDotL: number,
  scale = 1.5,
): StudioPbrVec3Like {
  const slope = Math.sqrt(Math.max(0, 1 - Math.min(1, Math.max(0, nDotL)) ** 2));
  const offset = texelWorldSize * scale * slope;
  return {
    x: point.x + normal.x * offset,
    y: point.y + normal.y * offset,
    z: point.z + normal.z * offset,
  };
}
