/**
 * 회차 합계 용량 예산 — "이미지 1장 5MB"가 아니라 "회차 전체 50MB"를 계산으로 다룬다.
 *
 * 네이버 도전만화의 실제 반려 사유 1위는 개별 파일이 아니라 **회차 합계**다. 그런데 그
 * 규칙은 지금까지 프리셋의 `note` 문자열 안에 "회차 합계 약 50MB"라는 **문장으로만** 있었다 —
 * 사람이 읽을 수는 있지만 아무 코드도 그 값을 쓰지 않았고, 4.9MB 짜리 이미지 12장을 저장하면
 * 장별 경고는 하나도 없이 합계 58MB 패키지가 조용히 만들어졌다.
 *
 * 이 모듈은 그 문장을 숫자로 만든다. 두 가지 일을 한다.
 *
 * 1. **선(先) 배분** — 합계 예산과 장수로 "이 회차에서 한 장이 써도 되는 용량"을 계산한다.
 *    품질 협상(studio-export-quality-negotiation)이 이 값을 상한으로 쓰면, 장별 상한만
 *    지키다 합계에서 터지는 일이 구조적으로 사라진다.
 * 2. **후(後) 정산** — 실제 저장된 바이트로 합계·초과분·남은 여유를 되짚고 한글로 설명한다.
 *
 * 여유분(headroom)을 4% 남기는 이유: 플랫폼이 공지하는 합계값은 대개 근사치이고, 업로더가
 * 다시 감싸는 컨테이너·메타데이터 오버헤드가 붙는다. 정확히 예산에 닿게 맞추면 실패가
 * "가끔" 나는 최악의 형태가 되므로, 처음부터 예산 안쪽을 겨냥한다.
 *
 * 전부 순수·결정적이라 node 단위 테스트가 가능하다. 사용자 노출 문자열은 한글.
 */

/** 회차 합계 예산에서 남겨 두는 여유 비율(0~1). 96% 만 배분한다. */
export const STUDIO_EPISODE_BYTE_BUDGET_HEADROOM = 0.96;

const MIB = 1024 * 1024;
const KIB = 1024;

export interface StudioEpisodeByteLimits {
  /** 이미지 1장 포함 상한(byte). 넘으면(>) 초과. */
  maxFileBytes?: number;
  /** 회차 전체 포함 상한(byte). 넘으면(>) 초과. */
  maxEpisodeBytes?: number;
}

function positiveFinite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

/**
 * 이 회차에서 한 장이 써도 되는 실효 상한(byte).
 *
 * `min(장별 상한, 합계 예산 × 여유 / 장수)`. 두 상한이 모두 없거나 장수가 0 이하면
 * undefined(=상한 없음). 합계 예산이 있는데 장수로 나눈 몫이 1 미만이면 1로 클램프한다 —
 * 0 은 "상한 없음"과 구별되지 않아 협상이 조용히 꺼지기 때문.
 */
export function planStudioEpisodeFileByteCap(
  limits: StudioEpisodeByteLimits,
  fileCount: number
): number | undefined {
  const caps: number[] = [];
  if (positiveFinite(limits.maxFileBytes)) caps.push(Math.floor(limits.maxFileBytes));
  if (positiveFinite(limits.maxEpisodeBytes) && Number.isFinite(fileCount) && fileCount > 0) {
    caps.push(
      Math.max(
        1,
        Math.floor((limits.maxEpisodeBytes * STUDIO_EPISODE_BYTE_BUDGET_HEADROOM) / fileCount)
      )
    );
  }
  return caps.length === 0 ? undefined : Math.min(...caps);
}

export interface StudioEpisodeByteBudget {
  fileCount: number;
  totalBytes: number;
  largestFileBytes: number;
  /** 장별 상한을 넘은 파일 수. 장별 상한이 없으면 항상 0. */
  oversizedFiles: number;
  /** 계산에 쓴 실효 장별 상한. 없으면 키 없음. */
  perFileCapBytes?: number;
  /** 회차 합계 상한. 없으면 키 없음. */
  episodeBudgetBytes?: number;
  /** 합계 상한을 넘은 바이트. 넘지 않았으면 키 없음. */
  episodeOverBytes?: number;
  /** 합계 상한까지 남은 바이트. 상한이 없거나 이미 넘었으면 키 없음. */
  headroomBytes?: number;
  /** 장별·합계 상한을 모두 만족하는가. 상한이 없으면 true. */
  withinBudget: boolean;
}

/** 실제 저장된 바이트 목록으로 회차 예산을 정산한다(순수). 음수·비유한 값은 0으로 본다. */
export function planStudioEpisodeByteBudget(
  fileBytes: readonly number[],
  limits: StudioEpisodeByteLimits = {}
): StudioEpisodeByteBudget {
  let totalBytes = 0;
  let largestFileBytes = 0;
  let oversizedFiles = 0;
  const maxFileBytes = positiveFinite(limits.maxFileBytes) ? limits.maxFileBytes : undefined;
  for (const raw of fileBytes) {
    const bytes = Number.isFinite(raw) && raw > 0 ? raw : 0;
    totalBytes += bytes;
    if (bytes > largestFileBytes) largestFileBytes = bytes;
    if (maxFileBytes !== undefined && bytes > maxFileBytes) oversizedFiles += 1;
  }
  const episodeBudgetBytes = positiveFinite(limits.maxEpisodeBytes)
    ? limits.maxEpisodeBytes
    : undefined;
  const perFileCapBytes = planStudioEpisodeFileByteCap(limits, fileBytes.length);
  const over =
    episodeBudgetBytes !== undefined && totalBytes > episodeBudgetBytes
      ? totalBytes - episodeBudgetBytes
      : undefined;
  return {
    fileCount: fileBytes.length,
    totalBytes,
    largestFileBytes,
    oversizedFiles,
    ...(perFileCapBytes !== undefined ? { perFileCapBytes } : {}),
    ...(episodeBudgetBytes !== undefined ? { episodeBudgetBytes } : {}),
    ...(over !== undefined ? { episodeOverBytes: over } : {}),
    ...(episodeBudgetBytes !== undefined && over === undefined
      ? { headroomBytes: episodeBudgetBytes - totalBytes }
      : {}),
    withinBudget: oversizedFiles === 0 && over === undefined,
  };
}

/** 사람이 읽는 용량 표기 — 1MiB 미만은 KB, 10MB 이상은 정수. */
export function formatStudioByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0KB";
  if (bytes < MIB) return `${Math.max(1, Math.round(bytes / KIB))}KB`;
  const value = bytes / MIB;
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10}MB`;
}

/**
 * 정산 결과를 한 줄 한글 안내로. 합계 상한이 아예 없으면 null —
 * 예산이 없는 프리셋에 "예산 안"이라는 무의미한 문장을 붙이지 않는다.
 */
export function studioEpisodeByteBudgetMessage(budget: StudioEpisodeByteBudget): string | null {
  if (budget.episodeBudgetBytes === undefined) return null;
  const total = formatStudioByteSize(budget.totalBytes);
  const limit = formatStudioByteSize(budget.episodeBudgetBytes);
  if (budget.episodeOverBytes !== undefined) {
    return `회차 합계 ${total}로 상한 ${limit}를 ${formatStudioByteSize(
      budget.episodeOverBytes
    )} 넘었어요 — 이 회차는 업로드가 반려될 수 있어요.`;
  }
  return `회차 합계 ${total} / ${limit} (여유 ${formatStudioByteSize(budget.headroomBytes ?? 0)}).`;
}
