/**
 * 용량 상한 품질 협상 — 손실 인코딩을 "상한을 만족하는 가장 높은 품질"로 되돌린다.
 *
 * 지금까지 규격 프리셋의 `maxFileBytes` 는 **경고만** 했다. 네이버 도전만화 5MB 를 넘겨도
 * 파일은 그대로 저장되고 "업로드 전에 용량을 줄여주세요"라는 문장만 남았다 — 줄이는 일은
 * 전부 사람 몫이었고, 대부분은 포토샵으로 다시 저장하는 왕복이 되었다. 이 모듈이 그 경고를
 * 실행으로 바꾼다: 기준 품질 결과가 상한을 넘으면 품질 사다리를 **이분 탐색**해 상한을
 * 만족하는 가장 높은 품질의 결과를 돌려준다(사다리 9칸 → 최대 4회 재인코딩).
 *
 * 품질 우선 원칙(ADR-0010) 때문에 세 가지를 지킨다.
 *
 * 1. **기준 결과가 이미 상한 안이면 재인코딩을 아예 하지 않는다.** 바이트가 그대로 보존되고
 *    (pristine) 인코딩 비용도 0이다. 상한이 없을 때도 마찬가지다.
 * 2. **품질 하한(0.62) 아래로는 내려가지 않는다.** 그 아래는 웹툰 선화에서 링잉과 블록이
 *    눈에 보이기 시작하는 구간이다. 상한을 맞추려고 화질을 버리는 거래는 하지 않는다.
 * 3. **하한에서도 상한을 못 맞추면 기준 결과를 그대로 돌려준다.** 화질만 깎고 목표는 못
 *    이루는 결과가 제일 나쁘기 때문이다. 대신 `satisfied:false` 와 하한 실측 용량을 함께
 *    돌려주어, "해상도를 줄이거나 더 잘게 나누세요"라는 정확한 안내가 가능하게 한다.
 *
 * 무손실 포맷(PNG)에는 품질 축이 없어 협상하지 않는다 — 같은 이유로 안내 문구도 다르다.
 *
 * 인코딩은 전부 주입(`encode` 콜백)이라 브라우저 캔버스 없이 node 단위 테스트가 가능하다.
 * 사용자 노출 문자열은 한글.
 */

/** 협상 대상이 될 수 있는 포맷 토큰. MIME(`image/jpeg`)도 그대로 받는다. */
export type StudioNegotiableFormatToken = string;

/**
 * 손실 압축 품질 하한. 이 아래로는 협상하지 않는다.
 *
 * 0.62 는 JPEG/WebP 에서 스크린톤 격자와 잉크 선 경계의 링잉이 100% 확대에서 보이기
 * 시작하는 지점이다. 그 아래 구간은 "용량은 맞췄지만 원고가 아닌" 결과가 되므로 이 모듈의
 * 책임 밖으로 둔다(호출자가 해상도·분할로 해결해야 한다).
 */
export const STUDIO_EXPORT_QUALITY_FLOOR = 0.62;

/**
 * 품질 사다리 — 내림차순. 각 칸은 체감 화질 차이가 나면서도 용량이 의미 있게 줄어드는 폭
 * (약 4%p)으로 잡았다. 이분 탐색이므로 칸이 많아도 인코딩 횟수는 log₂ 로만 늘어난다.
 */
export const STUDIO_EXPORT_QUALITY_LADDER: readonly number[] = Object.freeze([
  0.92, 0.88, 0.84, 0.8, 0.76, 0.72, 0.68, 0.65, STUDIO_EXPORT_QUALITY_FLOOR,
]);

const LOSSY_TOKENS = new Set([
  "jpg",
  "jpeg",
  "webp",
  "image/jpg",
  "image/jpeg",
  "image/webp",
]);

/** 품질 축이 있는 포맷인지. 대소문자·MIME·확장자 토큰을 모두 받는다. */
export function isLossyExportFormat(format: StudioNegotiableFormatToken): boolean {
  return LOSSY_TOKENS.has(format.trim().toLowerCase());
}

/**
 * 기준 품질보다 **낮은** 사다리 칸만 내림차순으로. 기준 품질이 없으면 사다리 전체.
 * 기준 품질이 이미 하한 이하면 협상할 여지가 없으므로 빈 배열.
 */
export function studioExportQualityLadder(baselineQuality?: number): number[] {
  if (baselineQuality === undefined || !Number.isFinite(baselineQuality)) {
    return [...STUDIO_EXPORT_QUALITY_LADDER];
  }
  return STUDIO_EXPORT_QUALITY_LADDER.filter((step) => step < baselineQuality);
}

export type StudioQualityNegotiationOutcome =
  /** 상한이 없어 협상하지 않음. */
  | "no-cap"
  /** 기준 결과가 이미 상한 안 — 재인코딩 없음(바이트 보존). */
  | "within-cap"
  /** 재인코딩으로 상한을 만족하는 가장 높은 품질을 찾음. */
  | "negotiated"
  /** 무손실 포맷이라 품질로 줄일 수 없음. */
  | "lossless-format"
  /** 품질 하한에서도 상한을 못 맞춰 기준 결과를 유지함. */
  | "floor-reached";

export interface StudioQualityNegotiationResult<TBlob> {
  /** 최종 채택한 결과. `floor-reached`·`lossless-format` 이면 기준 결과 그대로. */
  blob: TBlob;
  byteSize: number;
  /** 채택한 품질. 재인코딩이 없었으면 키 없음. */
  quality?: number;
  baselineByteSize: number;
  /** 재인코딩 횟수(기준 인코딩은 세지 않는다). */
  attempts: number;
  /** 상한을 만족하는가. 상한이 없으면 true. */
  satisfied: boolean;
  outcome: StudioQualityNegotiationOutcome;
  /** `floor-reached` 일 때만 — 품질 하한에서 실제로 측정된 용량. */
  floorByteSize?: number;
}

export interface StudioQualityNegotiationOptions<TBlob extends { size: number }> {
  /** 이미 만들어진 기준 품질 결과. 상한 안이면 이 값이 그대로 반환된다. */
  baseline: TBlob;
  /** 포함 상한(byte). 이 값을 **넘으면**(>) 협상한다. undefined·0 이하면 협상 없음. */
  maxBytes?: number;
  /** 포맷 토큰 또는 MIME. 무손실이면 협상하지 않는다. */
  format: StudioNegotiableFormatToken;
  /** 기준 결과를 만들 때 쓴 품질. 사다리는 이 값보다 낮은 칸만 쓴다. */
  baselineQuality?: number;
  /** 주어진 품질로 다시 인코딩한다. 실패하면 그 칸을 "안 맞음"으로 취급한다. */
  encode: (quality: number) => Promise<TBlob>;
}

/**
 * 상한을 만족하는 **가장 높은** 품질을 이분 탐색으로 찾는다.
 *
 * 사다리는 품질 내림차순이고 용량은 품질에 대해 사실상 단조 증가하므로, "맞는 칸들"은
 * 사다리 뒤쪽 연속 구간이 된다. 그 구간의 첫 칸(=가장 높은 품질)을 찾는 전형적인
 * lower-bound 탐색이다. 단조성이 국소적으로 깨지더라도(인코더 헤더·서브샘플링 경계)
 * 반환값은 "실측으로 상한을 만족한 칸" 중 하나이므로 결과의 정합성은 유지된다.
 *
 * 인코딩 실패는 삼키지 않고 "그 칸은 못 씀"으로만 처리한다 — 전 칸이 실패하면 기준 결과가
 * 그대로 남고 `floor-reached` 로 표면화된다.
 */
export async function negotiateStudioExportQuality<TBlob extends { size: number }>(
  options: StudioQualityNegotiationOptions<TBlob>
): Promise<StudioQualityNegotiationResult<TBlob>> {
  const baselineByteSize = options.baseline.size;
  const base = {
    blob: options.baseline,
    byteSize: baselineByteSize,
    baselineByteSize,
    attempts: 0,
  };
  const maxBytes = options.maxBytes;
  if (maxBytes === undefined || !Number.isFinite(maxBytes) || maxBytes <= 0) {
    return { ...base, satisfied: true, outcome: "no-cap" };
  }
  if (baselineByteSize <= maxBytes) {
    return { ...base, satisfied: true, outcome: "within-cap" };
  }
  if (!isLossyExportFormat(options.format)) {
    return { ...base, satisfied: false, outcome: "lossless-format" };
  }
  const ladder = studioExportQualityLadder(options.baselineQuality);
  if (ladder.length === 0) {
    return { ...base, satisfied: false, outcome: "floor-reached", floorByteSize: baselineByteSize };
  }

  let low = 0;
  let high = ladder.length - 1;
  let attempts = 0;
  let best: { blob: TBlob; quality: number } | null = null;
  // 전 칸이 실패해도 사다리 마지막 칸(=품질 하한)은 반드시 한 번 측정된다 — 안내 문구가
  // "하한에서도 N MB"라고 실측값을 말할 수 있는 근거.
  let smallest: { byteSize: number; quality: number } | null = null;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const quality = ladder[middle];
    attempts += 1;
    let candidate: TBlob | null;
    try {
      candidate = await options.encode(quality);
    } catch {
      candidate = null;
    }
    if (candidate === null) {
      // 이 칸은 못 쓴다. 더 낮은 품질에서 성공할 수 있으므로 탐색은 계속한다.
      low = middle + 1;
      continue;
    }
    if (smallest === null || candidate.size < smallest.byteSize) {
      smallest = { byteSize: candidate.size, quality };
    }
    if (candidate.size <= maxBytes) {
      best = { blob: candidate, quality };
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }

  if (best) {
    return {
      blob: best.blob,
      byteSize: best.blob.size,
      quality: best.quality,
      baselineByteSize,
      attempts,
      satisfied: true,
      outcome: "negotiated",
    };
  }
  return {
    blob: options.baseline,
    byteSize: baselineByteSize,
    baselineByteSize,
    attempts,
    satisfied: false,
    outcome: "floor-reached",
    ...(smallest !== null ? { floorByteSize: smallest.byteSize } : {}),
  };
}

const MIB = 1024 * 1024;

function megabytes(bytes: number): string {
  const value = bytes / MIB;
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10}MB`;
}

/**
 * 협상 결과를 한 줄 한글 안내로. 아무 일도 없었으면(`no-cap`·`within-cap`) null —
 * 호출자가 "조용한 성공"에 문장을 붙이지 않도록.
 */
export function studioQualityNegotiationMessage(
  result: Pick<
    StudioQualityNegotiationResult<{ size: number }>,
    "outcome" | "quality" | "baselineByteSize" | "byteSize" | "floorByteSize"
  >,
  maxBytes: number
): string | null {
  switch (result.outcome) {
    case "no-cap":
    case "within-cap":
      return null;
    case "negotiated":
      return `용량 상한 ${megabytes(maxBytes)}에 맞추려고 화질을 ${Math.round(
        (result.quality ?? 0) * 100
      )}%로 낮춰 저장했어요(${megabytes(result.baselineByteSize)} → ${megabytes(result.byteSize)}).`;
    case "lossless-format":
      return `PNG는 화질로 용량을 줄일 수 없어 ${megabytes(
        result.baselineByteSize
      )} 그대로 저장했어요 — JPG로 바꾸거나 더 잘게 나눠주세요.`;
    case "floor-reached":
      return `화질 하한(${Math.round(STUDIO_EXPORT_QUALITY_FLOOR * 100)}%)에서도 ${megabytes(
        result.floorByteSize ?? result.baselineByteSize
      )}라 상한 ${megabytes(
        maxBytes
      )}를 맞추지 못했어요 — 화질을 더 버리는 대신 원본 그대로 저장했으니 해상도를 줄이거나 더 잘게 나눠주세요.`;
  }
}
