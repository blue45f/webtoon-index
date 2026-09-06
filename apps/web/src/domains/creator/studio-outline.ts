/**
 * Studio Sticker Outline Engine
 * 스티커 테두리 — 불투명 실루엣 바깥으로 컬러 스트로크를 그린다(알파 팽창/dilation).
 * 알파가 불투명(>=128)인 원본 픽셀은 그대로 두고, 투명/반투명 픽셀이 반경 안에
 * 불투명 픽셀을 두면 그 픽셀을 outline color로 채우고 alpha=255*opacity/100으로 만든다.
 * 실루엣 "바깥" 테두리만 칠하므로 스티커·이모티콘 컷아웃 느낌을 낸다.
 *
 * 링 구성(안쪽→바깥):
 *   1) 1차 링 dist∈(0..width] — color. 레거시와 바이트 동일(하드 덮어쓰기, alpha=ringAlpha).
 *   2) 2차 링 dist∈(width..width+secondWidth] — secondColor(이중 외곽선, 웹툰 스티커의
 *      흰+검 테두리). 링 경계 1px는 color→secondColor 거리 블렌드로 부드럽게 잇는다.
 *   3) AA 페더 dist∈(total..total+1) — 가장 바깥 링 색을 거리 램프 알파로 얹어 계단 현상을
 *      없앤다. 페더는 "추가"만 한다: 레거시 알고리즘이 칠하던 픽셀(dist<=width)의 바이트는
 *      전혀 바뀌지 않고, 기존 알파가 더 강한 픽셀은 덮지 않는다.
 *
 * 효율: 각 픽셀에서 가장 가까운 불투명 픽셀까지의 거리를 분리형(가로→세로) 거리 변환
 * (Felzenszwalb & Huttenlocher, O(n))으로 한 번에 구한 뒤, 반경 안 투명 픽셀만 칠한다.
 * 박스 스캔이 아니라서 width가 커도 비용이 선형이고, 둥근(유클리드) 테두리가 나온다.
 * sqrt는 링 경계 블렌드/페더 후보에서만 계산한다.
 *
 * 필터는 StudioPage가 offset=outlineCachePad로 캐싱한 "패딩된" 캔버스 위에서 돈다(테두리가
 * 바깥으로 자랄 여유 공간 — 총 링 두께 + 페더 1px). Konva/DOM 의존 없음 — StudioPage 캔버스
 * 로직과 단위 테스트가 공유한다. 전부 순수·결정적(랜덤 없음).
 */

import { hexToRgb } from "./studio-filters";

import type { StudioImageDataLike } from "./studio-filters";

// ---------------------------------------------------------------------------
// 파라미터 타입·기본값·범위
// ---------------------------------------------------------------------------

/**
 * 스티커 테두리. color #rrggbb, width 0..60(px 두께), opacity 0..100(테두리 알파 %).
 * secondColor/secondWidth는 선택적 "이중 외곽선"(1차 링 바깥의 2차 링) — 없으면(레거시 저장본)
 * 단일 링과 완전히 동일하게 동작한다(항등 기본값).
 */
export type Outline = {
  color: string;
  width: number;
  opacity: number;
  /** 2차(바깥) 링 색 #rrggbb — secondWidth와 함께일 때만 의미 있다. */
  secondColor?: string;
  /** 2차(바깥) 링 두께 0..60px — 0이면 이중 외곽선 없음(항등). */
  secondWidth?: number;
};

/**
 * 항등(테두리 없음) — 흰색·두께 0·불투명 100. width 0이라 아무것도 그리지 않는다.
 * 2차 링 키는 의도적으로 없다(레거시 3키 형태 유지 — 저장본 바이트 동일성).
 */
export const DEFAULT_OUTLINE: Outline = { color: "#ffffff", width: 0, opacity: 100 };

/** 2차 링 색 폴백 — 웹툰 이중 테두리의 대표값(검정). 무효 secondColor 정규화에 쓴다. */
export const DEFAULT_OUTLINE_SECOND_COLOR = "#000000";

/**
 * 두께 슬라이더 한 칸 범위 — 0..60px, 1 단위. 1차/2차 링이 공유한다.
 * (기존 0..30에서 확장 — 거리 변환이 O(n)이라 두꺼운 스티커 테두리도 선형 비용.)
 */
export const OUTLINE_WIDTH_RANGE = { min: 0, max: 60, step: 1 } as const;

/** 불투명도 슬라이더 한 칸 범위 — 0..100%, 1 단위. */
export const OUTLINE_OPACITY_RANGE = { min: 0, max: 100, step: 1 } as const;

/** AA 페더 폭(px) — 총 링 바깥으로 이만큼 거리 램프 알파를 얹는다. 캐시 패딩에 포함된다. */
export const OUTLINE_FEATHER_PX = 1;

/**
 * Tiny cached surfaces finish below one frame budget and avoid Worker startup/transfer overhead.
 * Anything larger must use the persistent module Worker on the browser main thread.
 */
export const STUDIO_OUTLINE_SYNC_MAX_PIXELS = 64 * 1024;

// 알파 임계 — 이 값 이상이면 "불투명"(원본 실루엣), 미만이면 테두리 후보(투명/반투명).
const ALPHA_OPAQUE = 128;

// #rrggbb 검증용(소문자/대문자 6자리). 어긋나면 정규화에서 기본 색으로 되돌린다.
const HEX6_RE = /^#[0-9a-f]{6}$/i;

// 거리 변환에서 "불투명 픽셀 없음"을 뜻하는 큰 값(제곱 거리 단위).
const FAR = 1e9;

type StudioOutlineWorkerClientModule = typeof import("./studio-outline-worker-client");

interface AsyncOutlineKonvaNode {
  attrs?: Record<string, unknown>;
  cache?(config?: { offset?: number }): unknown;
  clearCache?(): unknown;
  getLayer?(): { batchDraw?(): unknown } | null | undefined;
  isDestroyed?(): boolean;
}

interface AsyncOutlineState {
  readonly controller: AbortController;
  readonly epoch: number;
  readonly height: number;
  readonly key: string;
  readonly outline: Outline;
  readonly width: number;
  result?: Uint8ClampedArray;
  status: "pending" | "ready" | "failed";
}

const asyncOutlineStates = new WeakMap<object, AsyncOutlineState>();
const outlineImageIdentities = new WeakMap<object, number>();
let nextOutlineImageIdentity = 1;
let outlineWorkerClientPromise: Promise<StudioOutlineWorkerClientModule> | null = null;

function loadStudioOutlineWorkerClient(): Promise<StudioOutlineWorkerClientModule> {
  if (!outlineWorkerClientPromise) {
    outlineWorkerClientPromise = import("./studio-outline-worker-client")
      .catch((error) => {
        outlineWorkerClientPromise = null;
        throw error;
      });
  }
  return outlineWorkerClientPromise;
}

function outlineImageIdentity(value: unknown): number {
  if (
    value === null
    || (typeof value !== "object" && typeof value !== "function")
  ) {
    return 0;
  }
  const object = value as object;
  const cached = outlineImageIdentities.get(object);
  if (cached !== undefined) return cached;
  const identity = nextOutlineImageIdentity++;
  outlineImageIdentities.set(object, identity);
  return identity;
}

function outlineFromAttrs(attrs: Record<string, unknown> | undefined): Outline {
  return normalizeOutline({
    color: typeof attrs?.outlineColor === "string" ? attrs.outlineColor : undefined,
    width: typeof attrs?.outlineWidth === "number" ? attrs.outlineWidth : undefined,
    opacity: typeof attrs?.outlineOpacity === "number" ? attrs.outlineOpacity : undefined,
    secondColor: typeof attrs?.outlineSecondColor === "string"
      ? attrs.outlineSecondColor
      : undefined,
    secondWidth: typeof attrs?.outlineSecondWidth === "number"
      ? attrs.outlineSecondWidth
      : undefined,
  });
}

function asyncOutlineKey(
  node: AsyncOutlineKonvaNode,
  width: number,
  height: number,
  outline: Outline,
): string {
  const attrs = node.attrs;
  return JSON.stringify([
    typeof attrs?.outlineWorkerRevision === "string"
      ? attrs.outlineWorkerRevision
      : null,
    outlineImageIdentity(attrs?.outlineWorkerMaskRevision),
    outlineImageIdentity(attrs?.image),
    width,
    height,
    outline.color,
    outline.width,
    outline.opacity,
    outline.secondColor ?? null,
    outline.secondWidth ?? null,
  ]);
}

function isAsyncOutlineKonvaNode(
  value: AsyncOutlineKonvaNode,
): value is AsyncOutlineKonvaNode & Required<
  Pick<AsyncOutlineKonvaNode, "cache" | "clearCache">
> {
  return typeof value.cache === "function" && typeof value.clearCache === "function";
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error
    && error.name === "AbortError"
  );
}

// ---------------------------------------------------------------------------
// 정규화·항등 판정
// ---------------------------------------------------------------------------

// 한 값을 [min,max]로 클램프, 숫자 아님은 fallback.
function clampTo(raw: unknown, min: number, max: number, fallback: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, raw));
}

/**
 * 과거 저장본/외부 입력 안전장치 — 누락/무효 키는 기본값, 범위 밖 숫자는 클램프.
 * color는 #rrggbb 형식이 아니면 기본 흰색으로 되돌린다(셰이더에 잘못된 색 차단).
 *
 * 저장본 바이트 동일성 계약: 입력이 2차 링 데이터를 전혀 담지 않으면(레거시 저장본)
 * 출력도 레거시 3키({color,width,opacity}) 형태 그대로다 — secondColor/secondWidth 키를
 * 주입하지 않는다. 2차 링 데이터가 하나라도 있으면 두 키를 모두 채워 반환한다.
 */
export function normalizeOutline(o?: Partial<Outline> | null): Outline {
  const src = o && typeof o === "object" ? o : {};
  const color = typeof src.color === "string" && HEX6_RE.test(src.color) ? src.color : DEFAULT_OUTLINE.color;
  const base: Outline = {
    color,
    width: clampTo(src.width, OUTLINE_WIDTH_RANGE.min, OUTLINE_WIDTH_RANGE.max, DEFAULT_OUTLINE.width),
    opacity: clampTo(src.opacity, OUTLINE_OPACITY_RANGE.min, OUTLINE_OPACITY_RANGE.max, DEFAULT_OUTLINE.opacity),
  };
  // 2차 링 데이터를 실제로 담고 있는 입력만 새 키를 갖는다(레거시 형태 보존).
  const hasSecondColor = typeof src.secondColor === "string" && HEX6_RE.test(src.secondColor);
  const hasSecondWidth = typeof src.secondWidth === "number" && Number.isFinite(src.secondWidth);
  if (!hasSecondColor && !hasSecondWidth) return base;
  return {
    ...base,
    secondColor: hasSecondColor ? (src.secondColor as string) : DEFAULT_OUTLINE_SECOND_COLOR,
    secondWidth: clampTo(src.secondWidth, OUTLINE_WIDTH_RANGE.min, OUTLINE_WIDTH_RANGE.max, 0),
  };
}

/** 1차+2차 링을 합친 총 두께(px) — 캐시 패딩·반경 계산의 기준. 음수/누락은 0으로 본다. */
export function outlineTotalWidth(o: Outline): number {
  return Math.max(0, o.width) + Math.max(0, o.secondWidth ?? 0);
}

/**
 * 픽셀을 전혀 건드리지 않는 항등 설정인지 — 불투명도 0 이하이거나,
 * 1차·2차 링 두께가 모두 0 이하일 때(width 0이어도 secondWidth>0이면 2차 링이 그려진다).
 */
export function isIdentityOutline(o: Outline): boolean {
  return outlineTotalWidth(o) <= 0 || o.opacity <= 0;
}

// ---------------------------------------------------------------------------
// 거리 변환 — 각 픽셀에서 가장 가까운 불투명 픽셀까지의 제곱 유클리드 거리
// ---------------------------------------------------------------------------

/**
 * 1D 제곱 거리 변환(Felzenszwalb & Huttenlocher) — f[i]가 각 점의 시드 비용일 때
 * d[i] = min_j ( (i-j)^2 + f[j] )를 O(n)에 채운다.
 * 가로/세로 패스에서 각각 한 줄(행 또는 열)에 대해 호출한다.
 * v/z는 호출자가 재사용하는 작업 버퍼(하부 포물선 인덱스·교차점)다.
 */
function dt1d(f: Float64Array, d: Float64Array, n: number, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -FAR;
  z[1] = FAR;
  for (let q = 1; q < n; q++) {
    // 새 포물선과 현재 최상위 포물선의 교차점 s를 구해, s가 뒤로 밀리면 스택을 비운다.
    let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    while (s <= z[k]!) {
      k--;
      s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = FAR;
  }
  // 각 i에서 자신을 덮는 하부 포물선을 골라 거리 평가.
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++;
    const dx = q - v[k]!;
    d[q] = dx * dx + f[v[k]!]!;
  }
}

/**
 * 2D 제곱 유클리드 거리 변환 — 입력 seed[i]가 0(불투명 픽셀)이거나 FAR(그 외)일 때
 * 각 픽셀에서 가장 가까운 불투명 픽셀까지의 제곱 거리를 반환한다.
 * 세로 패스 → 가로 패스로 분리(각 1D는 dt1d). 불투명 픽셀이 하나도 없으면 전부 FAR로 남는다.
 */
function squaredDistanceToOpaque(seed: Float64Array, width: number, height: number): Float64Array {
  const dist = new Float64Array(width * height);
  const maxDim = Math.max(width, height);
  const f = new Float64Array(maxDim);
  const d = new Float64Array(maxDim);
  const v = new Int32Array(maxDim);
  const z = new Float64Array(maxDim + 1);

  // --- 세로 패스: 각 열에 대해 1D 거리 변환, 결과를 dist에 임시 저장 ---
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = seed[y * width + x]!;
    dt1d(f, d, height, v, z);
    for (let y = 0; y < height; y++) dist[y * width + x] = d[y]!;
  }

  // --- 가로 패스: 세로 결과를 시드로 각 행에 대해 1D 거리 변환 ---
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) f[x] = dist[row + x]!;
    dt1d(f, d, width, v, z);
    for (let x = 0; x < width; x++) dist[row + x] = d[x]!;
  }

  return dist;
}

// ---------------------------------------------------------------------------
// 적용 — 알파 팽창으로 실루엣 바깥 테두리 칠하기(제자리 변형)
// ---------------------------------------------------------------------------

/**
 * 스티커 테두리 제자리 적용 — 항등(총 두께<=0 또는 opacity<=0)이면 no-op.
 *
 * 1) 원본 알파로 시드 맵을 만든다(불투명 픽셀=0, 그 외=FAR).
 * 2) 제곱 유클리드 거리 변환으로 각 픽셀의 "가장 가까운 불투명 픽셀까지 거리^2"를 구한다.
 * 3) 투명/반투명 픽셀(alpha<128)을 거리 밴드별로 칠한다:
 *    - dist<=width               → 1차 링 color, alpha=ringAlpha(레거시와 바이트 동일).
 *    - width<dist<=width+second  → 2차 링 secondColor. 경계 1px는 color→secondColor 블렌드.
 *    - total<dist<total+1(페더)  → 가장 바깥 링 색, alpha=ringAlpha*(total+1-dist) 램프.
 *      페더는 기존 픽셀 알파보다 강할 때만 얹는다(반투명 원본 디테일을 지우지 않음).
 *
 * 불투명 픽셀(원본 실루엣)의 r/g/b·alpha는 절대 건드리지 않는다(알파·색 보존).
 * width가 커도 거리 변환이 선형이라 비용이 합리적이다.
 */
export function applyOutline(img: StudioImageDataLike, o: Outline): void {
  if (isIdentityOutline(o)) return;
  const { data, width, height } = img;
  if (!(width > 0) || !(height > 0)) return;

  const w1 = Math.max(0, o.width);
  const w2 = Math.max(0, o.secondWidth ?? 0);
  const total = w1 + w2;

  const c1 = hexToRgb(o.color);
  // 2차 링이 없으면 c2=c1이라 밴드 구분이 자연히 사라진다(레거시 경로).
  const c2 = w2 > 0 ? hexToRgb(o.secondColor ?? DEFAULT_OUTLINE_SECOND_COLOR) : c1;
  // 페더는 항상 가장 바깥 링의 색으로 얹는다.
  const outer = w2 > 0 ? c2 : c1;
  const ringAlpha = Math.round((255 * o.opacity) / 100);

  // 두께 비교는 제곱 거리로(루트 회피). sqrt는 블렌드/페더 후보에서만 계산.
  const w1Sq = w1 * w1;
  const totalSq = total * total;
  const featherEdge = total + OUTLINE_FEATHER_PX;
  const featherEdgeSq = featherEdge * featherEdge;

  // 1) 시드: 불투명 픽셀이면 비용 0, 아니면 FAR.
  const count = width * height;
  const seed = new Float64Array(count);
  let hasOpaque = false;
  for (let p = 0; p < count; p++) {
    if (data[p * 4 + 3]! >= ALPHA_OPAQUE) {
      seed[p] = 0;
      hasOpaque = true;
    } else {
      seed[p] = FAR;
    }
  }
  // 불투명 픽셀이 전혀 없으면 자랄 실루엣이 없어 테두리도 없다.
  if (!hasOpaque) return;

  // 2) 거리 변환.
  const distSq = squaredDistanceToOpaque(seed, width, height);

  // 3) 거리 밴드별 채색(불투명 원본은 건너뜀).
  for (let p = 0; p < count; p++) {
    const a = p * 4;
    if (data[a + 3]! >= ALPHA_OPAQUE) continue; // 원본 실루엣 보존
    const dsq = distSq[p]!;
    if (dsq > featherEdgeSq) continue; // 페더 밖

    if (dsq <= totalSq) {
      // --- 솔리드 링 밴드: 하드 덮어쓰기(레거시 동일). ---
      let cr = c1.r;
      let cg = c1.g;
      let cb = c1.b;
      if (w2 > 0 && dsq > w1Sq) {
        // 2차 링 — 링 경계 1px는 거리 t로 color→secondColor 블렌드(경계 계단 방지).
        const t = Math.min(1, Math.sqrt(dsq) - w1);
        cr = Math.round(c1.r + (c2.r - c1.r) * t);
        cg = Math.round(c1.g + (c2.g - c1.g) * t);
        cb = Math.round(c1.b + (c2.b - c1.b) * t);
      }
      data[a] = cr;
      data[a + 1] = cg;
      data[a + 2] = cb;
      data[a + 3] = ringAlpha;
    } else {
      // --- AA 페더 밴드: 커버리지 램프 알파. 기존보다 강한 픽셀은 보존(추가 전용). ---
      const coverage = featherEdge - Math.sqrt(dsq);
      const alpha = Math.round(ringAlpha * coverage);
      if (alpha <= data[a + 3]!) continue;
      data[a] = outer.r;
      data[a + 1] = outer.g;
      data[a + 2] = outer.b;
      data[a + 3] = alpha;
    }
  }
}

// ---------------------------------------------------------------------------
// 스티커 테두리 프리셋 — 첫 항목은 항등(없음), 나머지는 자주 쓰는 테두리.
// 모든 value는 normalizeOutline을 통과(색 #rrggbb, width 0..60, opacity 0..100).
// ---------------------------------------------------------------------------

export type OutlinePreset = { id: string; label: string; tip: string; value: Outline };

export const OUTLINE_PRESETS: OutlinePreset[] = [
  {
    id: "none",
    label: "없음",
    tip: "테두리를 그리지 않는 원본.",
    value: normalizeOutline(DEFAULT_OUTLINE),
  },
  {
    id: "white",
    label: "흰 테두리",
    tip: "실루엣 바깥을 흰색으로 둘러 스티커처럼 분리합니다.",
    value: normalizeOutline({ color: "#ffffff", width: 8, opacity: 100 }),
  },
  {
    id: "black",
    label: "검정 테두리",
    tip: "검은 윤곽선으로 실루엣을 또렷하게 가둡니다.",
    value: normalizeOutline({ color: "#000000", width: 6, opacity: 100 }),
  },
  {
    id: "thick-white",
    label: "두꺼운 흰",
    tip: "두꺼운 흰 테두리로 배경에서 강하게 띄웁니다.",
    value: normalizeOutline({ color: "#ffffff", width: 14, opacity: 100 }),
  },
  {
    id: "sticker",
    label: "스티커",
    tip: "도톰한 흰 테두리로 다이컷 스티커 느낌을 냅니다.",
    value: normalizeOutline({ color: "#ffffff", width: 10, opacity: 100 }),
  },
  {
    id: "double",
    label: "이중 테두리",
    tip: "안쪽 흰 테두리에 바깥 검정 라인을 둘러 웹툰 스티커처럼 만듭니다.",
    value: normalizeOutline({ color: "#ffffff", width: 6, opacity: 100, secondColor: "#111111", secondWidth: 3 }),
  },
  {
    id: "neon",
    label: "네온",
    tip: "밝은 시안 테두리로 빛나는 네온 윤곽을 만듭니다.",
    value: normalizeOutline({ color: "#00e5ff", width: 6, opacity: 100 }),
  },
  {
    id: "pink",
    label: "핑크",
    tip: "선명한 핑크 테두리로 발랄한 포인트를 줍니다.",
    value: normalizeOutline({ color: "#ff4f9a", width: 6, opacity: 100 }),
  },
];

// ---------------------------------------------------------------------------
// Konva 등록용 — StudioPage가 커스텀 필터로 부착.
// attrs는 외부 입력이므로 normalizeOutline로 안전 변환, 항등/무효/width0이면 no-op.
// ---------------------------------------------------------------------------

/**
 * Konva 필터 함수 — node(`this`).attrs에서 outlineColor·outlineWidth·outlineOpacity와
 * (이중 외곽선용) outlineSecondColor·outlineSecondWidth를 읽어 normalizeOutline로 안전 변환 후
 * applyOutline. 항등(총 두께0/opacity0)이거나 attrs가 비면 no-op.
 *
 * 브라우저 메인 스레드의 큰 Konva 캐시는 첫 패스에서 원본을 유지한 채 persistent module
 * Worker로 EDT를 보낸다. 결과 epoch·소스/필터 revision이 여전히 최신일 때만 같은 offset 캐시를
 * 다시 만들고, 두 번째 패스가 Worker 결과를 복사한다. 작은 캐시와 이미 Worker 안에서 실행되는
 * 순수 필터 체인만 bounded 동기 경로를 사용한다.
 */
export function outlineKonvaFilter(this: { attrs?: Record<string, unknown> }, imageData: StudioImageDataLike): void {
  const node = this as AsyncOutlineKonvaNode;
  const attrs = node.attrs;
  if (!attrs) return;
  const o = outlineFromAttrs(attrs);
  if (isIdentityOutline(o)) return;
  const pixelCount = imageData.width * imageData.height;
  if (
    pixelCount <= STUDIO_OUTLINE_SYNC_MAX_PIXELS
    // In the image-filter module Worker there is no DOM. Keep the pure synchronous EDT there:
    // it is already off the main thread and spawning a nested Worker would only add latency.
    || typeof document === "undefined"
  ) {
    applyOutline(imageData, o);
    return;
  }

  // A non-Konva direct caller on the browser main thread has no safe asynchronous commit target.
  // Large inputs therefore fail closed instead of silently falling back to the blocking EDT.
  if (!isAsyncOutlineKonvaNode(node)) return;

  const key = asyncOutlineKey(node, imageData.width, imageData.height, o);
  const current = asyncOutlineStates.get(node);
  if (
    current?.key === key
    && current.width === imageData.width
    && current.height === imageData.height
  ) {
    if (
      current.status === "ready"
      && current.result?.byteLength === imageData.data.byteLength
    ) {
      imageData.data.set(current.result);
    }
    // pending: render the unoutlined cache until the Worker commits; failed: preserve the
    // unoutlined source rather than retrying a known-bad large synchronous path every draw.
    return;
  }

  current?.controller.abort();
  const controller = new AbortController();
  const epoch = (current?.epoch ?? 0) + 1;
  const state: AsyncOutlineState = {
    controller,
    epoch,
    height: imageData.height,
    key,
    outline: o,
    status: "pending",
    width: imageData.width,
  };
  asyncOutlineStates.set(node, state);

  // Konva owns the cache ImageData. Transfer an isolated snapshot so neither postMessage nor the
  // Worker can detach/mutate the in-progress cache surface.
  const snapshot = {
    data: new Uint8ClampedArray(imageData.data),
    width: imageData.width,
    height: imageData.height,
  };
  void loadStudioOutlineWorkerClient()
    .then((module) => module.runStudioOutlineWorker(
      { imageData: snapshot, outline: o },
      { epoch, signal: controller.signal },
    ))
    .then((result) => {
      const latest = asyncOutlineStates.get(node);
      if (
        latest !== state
        || latest.key !== key
        || latest.epoch !== result.epoch
        || controller.signal.aborted
        || result.imageData.width !== state.width
        || result.imageData.height !== state.height
        || result.imageData.data.byteLength !== state.width * state.height * 4
      ) {
        return;
      }
      const latestOutline = outlineFromAttrs(node.attrs);
      if (
        isIdentityOutline(latestOutline)
        || asyncOutlineKey(node, state.width, state.height, latestOutline) !== key
        || node.isDestroyed?.()
      ) {
        return;
      }
      state.result = result.imageData.data;
      state.status = "ready";
      try {
        // Rebuild the same padded Konva cache. The second filter pass consumes `state.result`
        // synchronously, so rotations, skew, transformer bounds and mask sampling remain byte-for-
        // byte on the established cache({offset}) coordinate system.
        node.clearCache();
        node.cache({ offset: outlineCachePad(state.outline) });
        node.getLayer?.()?.batchDraw?.();
      } catch (error) {
        state.status = "failed";
        state.result = undefined;
        console.error("[studio] outline Worker cache commit failed:", error);
      }
    })
    .catch((error) => {
      if (isAbortError(error)) return;
      const latest = asyncOutlineStates.get(node);
      if (latest !== state || latest.key !== key) return;
      state.status = "failed";
      state.result = undefined;
      console.error("[studio] outline Worker failed; large synchronous EDT was skipped:", error);
    });
}

// ---------------------------------------------------------------------------
// 캐시 패딩 — StudioPage가 node.cache({offset})에 쓰는 오프셋(px).
// 테두리가 바깥으로 "총 링 두께 + AA 페더"만큼 자라므로 그만큼 캔버스를 키워야 잘리지 않는다.
// ---------------------------------------------------------------------------

/** 캐시 오프셋(px) = 활성이면 ceil(총 링 두께)+페더 1px, 항등/무효면 0. */
export function outlineCachePad(o: Outline): number {
  if (isIdentityOutline(o)) return 0;
  return Math.ceil(outlineTotalWidth(o)) + OUTLINE_FEATHER_PX;
}
