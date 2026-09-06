// 실측 몸통 실루엣 — 절차형 의상이 "어깨 폭 × 상수"가 아니라 실제 몸 표면을 기준으로 재단되게 한다.
//
// 왜 필요한가: 기존 절차형 셸은 모든 반경을 shoulderW 배수로 잡고 단면을 고정 타원(깊이 0.85)으로
// 눌렀다. 어깨가 넓고 허리가 얇은 실제 캐릭터에서 이 규칙은 가슴을 너무 깊게, 허리를 너무 넓게
// 만들어 옷이 몸을 따라가지 않고 원통처럼 떠 보인다. 여기서는 스킨 메시에서 몸통 표면을 직접 재서
// 링(높이별 반폭·반깊이·중심) 목록으로 만들고, 재단은 그 위에 여유분을 더하는 방식으로 바꾼다.
//
// 설계 원칙:
//  - three 의존 0. 샘플 배열 → 링 목록 순수 함수라 노드 단위 테스트가 가능하다.
//    실제 정점 수집·좌표 변환은 StudioVrmWardrobePropsProjection이 수행한다.
//  - 이상치에 강해야 한다. 스킨 메시에는 옷·장식·눈썹처럼 몸통 본에 물린 이물이 섞이므로
//    링 반경은 최대값이 아니라 상위 분위수를 쓴다.
//  - 측정이 불가능하면 조용히 폴백한다. 실루엣이 없으면 기존 골격 기반 재단이 그대로 쓰인다.

export const STUDIO_VRM_BODY_SILHOUETTE_VERSION = 1 as const;

/** 링을 만들기 위해 필요한 최소 샘플 수. 이보다 적으면 그 높이는 이웃에서 보간된다. */
const MIN_RING_SAMPLES = 6;

/** 실루엣 하나를 신뢰하기 위한 최소 유효 링 수. */
const MIN_VALID_RINGS = 4;

/** 반경 분위수. 1.0(최대)은 이물 하나에 링 전체가 끌려가므로 상위 8%를 잘라낸다. */
const RADIUS_PERCENTILE = 0.92;

/** 중심 분위수 — 좌우 비대칭 이물이 중심을 끌지 않도록 중앙값을 쓴다. */
const CENTER_PERCENTILE = 0.5;

const MIN_RADIUS_M = 0.01;
const MAX_RADIUS_M = 0.9;

/**
 * 몸통 한 높이의 단면. 부착 본(spine) 로컬 공간 기준이며 t는 hips(0) → 목(1) 정규화 높이다.
 * halfWidth/halfDepth는 중심에서 좌우(x)·앞뒤(z)로의 반경, centerX/centerZ는 그 단면의 중심이다.
 */
export interface BodySilhouetteRing {
  t: number;
  halfWidth: number;
  halfDepth: number;
  centerX: number;
  centerZ: number;
}

/** 링 하나를 만들기 위해 넘기는 정점 하나. spine 로컬 좌표 + 정규화 높이. */
export interface BodySilhouetteSample {
  t: number;
  x: number;
  z: number;
}

export interface BodySilhouette {
  version: typeof STUDIO_VRM_BODY_SILHOUETTE_VERSION;
  /** measured = 스킨 메시 실측, 그 외에는 실루엣을 만들지 않는다. */
  source: "measured";
  /** t 오름차순 링. 항상 MIN_VALID_RINGS 이상. */
  rings: readonly BodySilhouetteRing[];
  /** 실제로 링을 만든 정점 수. 표본이 모자라 버려진 구간의 정점은 세지 않는다. */
  sampleCount: number;
  /**
   * `rings` 중 실측으로 만들어진 개수. 나머지는 이웃에서 보간한 것이다 — 12칸 중 4칸만 잰
   * 몸통과 12칸을 다 잰 몸통을 겉모습으로 구분할 수 없으면 영수증이 정직하지 않다.
   */
  measuredRingCount: number;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clampRadius(value: number): number {
  return Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, value));
}

/** 단면 중심의 허용 범위. 반경과 같은 상한을 쓰되 0을 중심으로 양쪽을 연다. */
function clampCenter(value: unknown): number {
  if (!isFiniteNumber(value)) return 0;
  return Math.min(MAX_RADIUS_M, Math.max(-MAX_RADIUS_M, value));
}

/**
 * 정렬된 배열의 분위수. 선형 보간을 쓰므로 샘플 수가 적어도 계단이 생기지 않는다.
 * 호출자가 정렬 비용을 통제할 수 있도록 정렬된 입력을 요구한다.
 */
export function percentileOfSorted(sorted: readonly number[], percentile: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  // Math.min/max 는 ±Infinity 는 제대로 잘라 내지만 NaN 은 그대로 통과시킨다. 분위수가 NaN 이면
  // 인덱스가 NaN 이 되고 반경이 통째로 NaN 이 되므로, NaN 만 중앙값으로 되돌린다.
  const p = Number.isNaN(percentile) ? 0.5 : Math.min(1, Math.max(0, percentile));
  const position = p * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.min(sorted.length - 1, lower + 1);
  const ratio = position - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * ratio;
}

/**
 * 정점 샘플 → 높이별 링. 링 수(`ringCount`)만큼 t를 균등 분할하고, 각 구간에서
 * 중심은 중앙값, 반경은 상위 분위수로 잡는다. 샘플이 부족한 구간은 이웃 링에서 채운다.
 * 유효 링이 MIN_VALID_RINGS 미만이면 실측 실패로 보고 null을 돌려준다.
 */
export function buildBodySilhouette(
  samples: readonly BodySilhouetteSample[],
  ringCount = 12,
): BodySilhouette | null {
  const rings = Math.min(24, Math.max(MIN_VALID_RINGS, Math.trunc(ringCount) || 12));
  const bucketsX: number[][] = Array.from({ length: rings }, () => []);
  const bucketsZ: number[][] = Array.from({ length: rings }, () => []);

  for (const sample of samples) {
    if (!isFiniteNumber(sample.t) || !isFiniteNumber(sample.x) || !isFiniteNumber(sample.z)) continue;
    if (sample.t < 0 || sample.t > 1) continue;
    const index = Math.min(rings - 1, Math.floor(sample.t * rings));
    bucketsX[index].push(sample.x);
    bucketsZ[index].push(sample.z);
  }

  // 1차: 샘플이 충분한 구간만 링으로 만든다.
  const measured: (BodySilhouetteRing | null)[] = bucketsX.map((xs, index) => {
    if (xs.length < MIN_RING_SAMPLES) return null;
    const zs = bucketsZ[index];
    const sortedX = [...xs].sort((a, b) => a - b);
    const sortedZ = [...zs].sort((a, b) => a - b);
    const centerX = percentileOfSorted(sortedX, CENTER_PERCENTILE);
    const centerZ = percentileOfSorted(sortedZ, CENTER_PERCENTILE);
    const spreadX = [...xs].map((x) => Math.abs(x - centerX)).sort((a, b) => a - b);
    const spreadZ = [...zs].map((z) => Math.abs(z - centerZ)).sort((a, b) => a - b);
    return {
      t: (index + 0.5) / rings,
      halfWidth: clampRadius(percentileOfSorted(spreadX, RADIUS_PERCENTILE)),
      halfDepth: clampRadius(percentileOfSorted(spreadZ, RADIUS_PERCENTILE)),
      centerX,
      centerZ,
    };
  });

  const measuredRingCount = measured.filter(Boolean).length;
  if (measuredRingCount < MIN_VALID_RINGS) return null;
  // 링이 된 구간의 정점만 센다 — 표본이 모자라 버려진 구간까지 세면 영수증이 실측량을 부풀린다.
  const used = bucketsX.reduce(
    (total, bucket) => total + (bucket.length >= MIN_RING_SAMPLES ? bucket.length : 0),
    0,
  );

  // 2차: 빈 구간을 가장 가까운 실측 링으로 채워 프로파일이 끊기지 않게 한다.
  const filled: BodySilhouetteRing[] = measured.map((ring, index) => {
    if (ring) return ring;
    let before: BodySilhouetteRing | null = null;
    let after: BodySilhouetteRing | null = null;
    for (let i = index - 1; i >= 0; i -= 1) {
      if (measured[i]) {
        before = measured[i];
        break;
      }
    }
    for (let i = index + 1; i < measured.length; i += 1) {
      if (measured[i]) {
        after = measured[i];
        break;
      }
    }
    const t = (index + 0.5) / rings;
    const source = before && after
      ? mixRings(before, after, (t - before.t) / Math.max(1e-6, after.t - before.t))
      : (before ?? after);
    // measured 가 MIN_VALID_RINGS 이상임을 위에서 확인했으므로 source 는 항상 존재한다.
    return { ...source!, t };
  });

  return {
    version: STUDIO_VRM_BODY_SILHOUETTE_VERSION,
    source: "measured",
    rings: filled,
    sampleCount: used,
    measuredRingCount,
  };
}

function mixRings(a: BodySilhouetteRing, b: BodySilhouetteRing, ratio: number): BodySilhouetteRing {
  const k = Math.min(1, Math.max(0, ratio));
  return {
    t: a.t + (b.t - a.t) * k,
    halfWidth: a.halfWidth + (b.halfWidth - a.halfWidth) * k,
    halfDepth: a.halfDepth + (b.halfDepth - a.halfDepth) * k,
    centerX: a.centerX + (b.centerX - a.centerX) * k,
    centerZ: a.centerZ + (b.centerZ - a.centerZ) * k,
  };
}

/**
 * 임의 높이 t의 단면을 링 사이 선형 보간으로 얻는다. 범위 밖 t는 양 끝 링으로 고정(클램프)한다 —
 * 옷자락이 실측 구간 아래로 내려가도 갑자기 0으로 수축하지 않게 한다.
 */
export function sampleBodySilhouette(silhouette: BodySilhouette, t: number): BodySilhouetteRing {
  const rings = silhouette.rings;
  const target = isFiniteNumber(t) ? t : 0;
  // 두 생성 경로 모두 링을 MIN_VALID_RINGS 이상 보장하지만 타입은 그러지 않는다. 손으로 만든
  // 빈 실루엣에 재단이 터지느니 중립 링을 돌려주는 편이 낫다.
  if (rings.length === 0) {
    return { t: target, halfWidth: MIN_RADIUS_M, halfDepth: MIN_RADIUS_M, centerX: 0, centerZ: 0 };
  }
  if (target <= rings[0].t) return { ...rings[0], t: target };
  const last = rings[rings.length - 1];
  if (target >= last.t) return { ...last, t: target };
  for (let index = 1; index < rings.length; index += 1) {
    const previous = rings[index - 1];
    const current = rings[index];
    if (target <= current.t) {
      const ratio = (target - previous.t) / Math.max(1e-6, current.t - previous.t);
      return { ...mixRings(previous, current, ratio), t: target };
    }
  }
  return { ...last, t: target };
}

/**
 * 실루엣에서 가장 넓은 반폭 — 어깨 요크·소매 진동 계산의 기준이 된다.
 * 손으로 만든 빈 실루엣에서는 sampleBodySilhouette 과 같은 중립 반경으로 물러선다.
 */
export function widestHalfWidth(silhouette: BodySilhouette): number {
  if (silhouette.rings.length === 0) return MIN_RADIUS_M;
  return silhouette.rings.reduce((widest, ring) => Math.max(widest, ring.halfWidth), 0);
}

/** t 구간 안에서 가장 좁은 반폭 — 허리선을 찾는 데 쓴다. */
export function narrowestHalfWidthBetween(
  silhouette: BodySilhouette,
  lowT: number,
  highT: number,
): number {
  if (!isFiniteNumber(lowT) || !isFiniteNumber(highT)) return widestHalfWidth(silhouette);
  let narrowest = Infinity;
  for (const ring of silhouette.rings) {
    if (ring.t < lowT || ring.t > highT) continue;
    narrowest = Math.min(narrowest, ring.halfWidth);
  }
  return Number.isFinite(narrowest) ? narrowest : widestHalfWidth(silhouette);
}

function sanitizeRing(raw: unknown): BodySilhouetteRing | null {
  if (!raw || typeof raw !== "object") return null;
  const ring = raw as Partial<BodySilhouetteRing>;
  if (!isFiniteNumber(ring.t) || !isFiniteNumber(ring.halfWidth) || !isFiniteNumber(ring.halfDepth)) return null;
  return {
    t: Math.min(1.5, Math.max(-0.5, ring.t)),
    halfWidth: clampRadius(ring.halfWidth),
    halfDepth: clampRadius(ring.halfDepth),
    // 중심도 반경과 같은 범위로 묶는다. 재단이 |center| 를 반경에 더하므로, 중심만 무제한으로
    // 두면 저장된 값 하나가 옷을 임의로 크게 만들 수 있다.
    centerX: clampCenter(ring.centerX),
    centerZ: clampCenter(ring.centerZ),
  };
}

/**
 * 저장·전달된 실루엣을 안전 범위로 정규화한다. 링은 t로 다시 정렬하고, 정렬 뒤에도 높이가
 * 겹치거나 유효 링이 모자라면 실측 실패와 같게 취급해 null을 돌려준다 — 깨진 실루엣으로
 * 재단하느니 골격 폴백이 낫다. 결과는 완성된 실루엣이거나 null이고, 그 중간은 없다.
 */
export function sanitizeBodySilhouette(raw: unknown): BodySilhouette | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Partial<BodySilhouette>;
  if (candidate.source !== "measured") return null;
  // 버전 도장은 다른 알고리즘이 남긴 측정을 무효화하라고 있는 것이다. 모르는 버전은 물론이고
  // 도장이 아예 없는 것도 받아 주면 안 된다 — 그러면 어느 알고리즘이 만든 값인지 영영 알 수 없다.
  if (candidate.version !== STUDIO_VRM_BODY_SILHOUETTE_VERSION) return null;
  if (!Array.isArray(candidate.rings)) return null;
  const rings = candidate.rings
    .map(sanitizeRing)
    .filter((ring): ring is BodySilhouetteRing => ring !== null)
    .sort((a, b) => a.t - b.t);
  if (rings.length < MIN_VALID_RINGS) return null;
  for (let index = 1; index < rings.length; index += 1) {
    if (rings[index].t - rings[index - 1].t < 1e-6) return null;
  }
  return {
    version: STUDIO_VRM_BODY_SILHOUETTE_VERSION,
    source: "measured",
    rings,
    sampleCount: isFiniteNumber(candidate.sampleCount) ? Math.max(0, Math.trunc(candidate.sampleCount)) : 0,
    // 링이 버려졌을 수 있으므로 저장된 실측 개수는 남은 링 수를 넘을 수 없다.
    measuredRingCount: isFiniteNumber(candidate.measuredRingCount)
      ? Math.min(rings.length, Math.max(0, Math.trunc(candidate.measuredRingCount)))
      : rings.length,
  };
}

/** 실루엣의 결정론적 서명 — 캐시 무효화와 영수증 비교에 쓴다. */
export function bodySilhouetteSignature(silhouette: BodySilhouette | null): string {
  if (!silhouette) return "none";
  const round = (value: number) => Math.round(value * 10_000) / 10_000;
  const payload = silhouette.rings
    .map((ring) =>
      `${round(ring.t)}:${round(ring.halfWidth)}:${round(ring.halfDepth)}`
      + `:${round(ring.centerX)}:${round(ring.centerZ)}`)
    .join("|");
  let hash = 0x811c9dc5;
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `sil1:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
