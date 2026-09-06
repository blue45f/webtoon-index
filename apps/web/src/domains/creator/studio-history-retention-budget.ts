/**
 * 되돌리기 히스토리 유지 경계 — "엔트리 몇 개" 대신 "붙들고 있는 바이트"로 상한을 세운다.
 *
 * ## 왜 개수 상한을 버리는가
 *
 * `appendStudioPagesHistorySnapshot` 은 스냅샷을 **참조로** 담는다. 그래서 엔트리 1개의 한계비용이
 * 편집 종류에 따라 네 자릿수 배로 갈린다(Chrome 실측):
 *
 *  - 솔로 얕은 패치(1p×50el)          376 B/엔트리
 *  - 솔로 큰 문서(20p×500el)          2,252 B/엔트리
 *  - 3,000샘플 획 1개 변형             49,446 B/엔트리
 *  - 3,000샘플 획 12개 그룹 리사이즈    581,600 B/엔트리
 *  - 협업 룸(1,500획 문서)             6.46 MiB/엔트리
 *
 * 개수 상한 200 은 첫 두 줄에 대해 **500배 보수적**이고(0.43 MiB 아끼려고 매 세션 조용히 단계를
 * 버린다), 마지막 줄에 대해서는 **아무것도 지키지 못한다**(200 × 6.46 MiB = 1.29 GiB — 탭이 죽는
 * 크기다). 같은 상수가 한쪽에서는 과하고 다른 쪽에서는 무력하다. 그래서 실제로 터지는 단위인
 * 바이트를 게이트로 삼는다.
 *
 * ## 왜 192 MiB 인가 (임의 숫자가 아니다)
 *
 * 브라우저 실측에서 문서 **자체**가 긴 획 800개에 796 MB~1.1 GB 에 닿았고 그 지점에서 앱이
 * 사실상 구동 불가였다. 히스토리는 "무거운 문서가 이미 먹은 뒤 남은 자리"에 들어가야 한다.
 * 192 MiB 면 무거운 문서 + 히스토리가 약 1.3 GB 로 관측된 붕괴점 아래에 머문다. 동시에 이 값은
 * 협업의 현재 상태(200엔트리 × 2.53 MiB = 506 MiB, 큰 문서면 1.29 GiB)보다 **작다** — 즉 이
 * 예산은 상한을 푸는 장치이면서 동시에 지금 존재하는 협업 누수를 조이는 장치다.
 *
 * 히스토리는 메모리 전용이다(`StudioAutosavePayload` 에 히스토리 필드가 없고
 * `createStudioLifecycleEmergencyAutosave` 는 `pagesHistory` 를 읽지 않는다). 그래서 퇴출은 어떤
 * 경우에도 **저장된 작업을 잃지 않는다** — 잃는 건 "그보다 더 뒤로 못 간다"뿐이다. 예산을
 * 공격적으로 잡아도 되는 근본 이유가 이것이다.
 *
 * ## 방벽 2,000 이 아직 10,000 이 아닌 이유
 *
 * 계량기(아래 닫힌 형태)와 앱 전체 힙 실측이 같은 워크로드에서 6.5배 어긋난다(하니스 5.3 KB 예측
 * vs 브라우저 34.7 KB 한계비용). 차액이 히스토리 밖 부기(CRDT 미동기 큐·저널·Konva 노드)라면
 * 계량기가 맞고, 계량기가 과소계상하는 것이라면 192 MiB 예산이 실제로는 1.2 GB 를 허용한다.
 * 그래서 1차 출하는 개수 방벽을 2,000 으로 둔다 — 후자여도 최악 오버슈트가 묶인다.
 * **이 대조 실험 없이 방벽을 올리면 안 된다.**
 */

/** 히스토리 배열이 붙들어도 되는 계량 바이트 상한(주 경계). */
export const STUDIO_PAGES_HISTORY_RETAINED_BYTES_BUDGET = 192 * 1024 * 1024;

/**
 * 2차 방벽. 예산이 아무리 헐거워도 배열 자체가 이보다 길어지지 않는다. 계량기가 브라우저 힙과
 * 대조되기 전까지의 안전장치이자, 커밋마다 도는 `slice().map()` 이 O(깊이)인 사실에 대한 보험이다.
 */
export const STUDIO_PAGES_HISTORY_MAX_ENTRIES = 2_000;

/**
 * 바닥. 예산을 넘겨서라도 최근 이만큼은 지킨다. 8단계 아래로는 ⌘Z 가 도구로서 죽으므로, 그
 * 지점에서는 아티스트가 메모리 압박을 감수하는 편이 낫다는 판단이다. 최악에서도 절대 상한이
 * `8 × 엔트리당` 으로 서므로 오늘처럼 `200 × 31 MB` 로 즉사하지 않는다.
 */
export const STUDIO_PAGES_HISTORY_MIN_ENTRIES = 8;

/**
 * 슬롯 단가 — Chrome(포인터 압축 ON) 기준. 아래 상수 합은 실측 닫힌 형태와 **일치해야 한다**:
 *
 *   얕은 패치 커밋 = 4 × (페이지수 + 편집 페이지 요소수) + 172
 *     └ 고정 172 = 포인터 배열 헤더 2개(32×2) + page 객체(60) + 얕은 요소 1개(48)
 *   points 재굽기 = 샘플당 16.00 B (= 좌표 2개 × 8 B) + double 배열 헤더 48 B
 *
 * 두 값 모두 R²≈1.0 으로 검증된 식이라 `studio-history-retention-budget.test.ts` 가 회귀로 못 박는다.
 */
export const STUDIO_HISTORY_POINTER_ARRAY_HEADER_BYTES = 32;
export const STUDIO_HISTORY_POINTER_SLOT_BYTES = 4;
export const STUDIO_HISTORY_DOUBLE_ARRAY_HEADER_BYTES = 48;
export const STUDIO_HISTORY_DOUBLE_SLOT_BYTES = 8;
export const STUDIO_HISTORY_PAGE_OBJECT_BYTES = 60;
export const STUDIO_HISTORY_ELEMENT_SHALLOW_BYTES = 48;
export const STUDIO_HISTORY_STRING_HEADER_BYTES = 16;

/**
 * 계량기 → 실제 유지 힙 보정 계수. **측정값이지 여유분이 아니다.**
 *
 * 위 상수들은 V8 슬롯 회계(포인터 4 B · double 8 B · 배열/객체 헤더)를 세지, 요소 얕은 복사가
 * 실제로 끌고 오는 프로퍼티 백킹 스토어까지는 못 센다. 실제 문서의 요소는 브러시 메타·inkInput
 * 계약·outlineStroke·레이어 메타를 들고 있어 얕은 복사 하나가 48 B 가 아니다.
 *
 * 그래서 빌드된 `/studio` 에서 **예산 상수만 다른 두 dist** 로 같은 조작(펜 획 260개)을 돌려
 * 직접 재었다(headless Chromium, CDP `HeapProfiler.collectGarbage` ×6 후 `Runtime.getHeapUsage`
 * 최솟값, swiftshader 플래그 없음):
 *
 *   | 빌드            | 깊이 | 계량 누계 | 유지 힙   |
 *   |-----------------|------|-----------|-----------|
 *   | 예산 192 MiB    | 261  | 38.99 MB  | 119.62 MB |
 *   | 예산 7.6 MB     |  28  |  7.93 MB  |  61.08 MB |
 *
 * 두 런은 예산 상수 말고는 완전히 같다 — 문서·CRDT 큐·Konva 노드가 동일하므로 힙 차이
 * 58.54 MB 는 전부 유지된 스냅샷 몫이다. 계량 차이는 31.06 MB → **실측 배율 1.88배**.
 * 보정 계수를 2 로 두면 예측 62.1 MB 대 실측 58.54 MB (6% 과대, 안전한 방향)로 맞는다.
 *
 * 이 계수 덕분에 `STUDIO_PAGES_HISTORY_RETAINED_BYTES_BUDGET` 은 "계량 단위 192 MiB" 가 아니라
 * **실제 힙 192 MiB** 를 뜻한다. 보정 없이 두면 예산이 사실상 360 MB 를 허용했을 것이다.
 *
 * 무엇이 이 값을 뒤집는가: 다른 워크로드(무거운 그룹 리사이즈·전채널 스타일러스)에서 같은 A/B 를
 * 돌렸을 때 배율이 크게 달라지면, 계수를 고치거나 요소 얕은 복사 상수 자체를 다시 재야 한다.
 * 그 대조 없이 개수 방벽(2,000)을 올리면 안 된다.
 */
export const STUDIO_HISTORY_RETAINED_HEAP_CALIBRATION = 2;

/**
 * 계량 대상 숫자 배열 채널. 요소 타입에 새 `number[]` 필드가 생기면 계량기가 그걸 못 보고 예산이
 * 소리 없이 헐거워지므로, 테스트가 `El` 에서 뽑은 키 집합과 이 목록이 정확히 같은지 **컴파일
 * 시점에** 검사한다(`studio-history-retention-budget.test.ts`).
 */
export const STUDIO_HISTORY_MEASURED_NUMERIC_CHANNELS = [
  "points",
  "pressures",
  "tiltXs",
  "tiltYs",
  "twists",
  "speeds",
  "tangentialPressures",
  "altitudeAngles",
  "azimuthAngles",
  "contactWidths",
  "contactHeights",
  "sampleTimeOffsets",
  "customShapePoints",
] as const;

/**
 * 계량 대상 문자열 채널. 래스터 편집은 커밋마다 새 data URL 을 굽고 그 문자열이 엔트리당 수 MB 다
 * — 숫자 채널과 같은 이유로 예산에 들어가야 한다. 값 동등성으로 비교하므로 같은 내용을 다시
 * 구운 경우는 0 으로 세어 **보수적으로 과소** 계상한다(방벽이 그 오차를 받는다).
 */
export const STUDIO_HISTORY_MEASURED_STRING_CHANNELS = ["src"] as const;

export type StudioPagesHistoryRetentionOptions = {
  /** 유지 바이트 예산. 기본 `STUDIO_PAGES_HISTORY_RETAINED_BYTES_BUDGET`. */
  readonly budgetBytes?: number;
  /** 개수 방벽. 기본 `STUDIO_PAGES_HISTORY_MAX_ENTRIES`. */
  readonly maxEntries?: number;
  /** 예산을 넘겨서라도 지키는 최소 깊이. 기본 `STUDIO_PAGES_HISTORY_MIN_ENTRIES`. */
  readonly minEntries?: number;
};

export type StudioPagesHistoryRetentionResult = {
  /** 퇴출까지 끝난 뒤 이 히스토리 배열이 붙들고 있는 것으로 계량된 바이트. */
  readonly retainedBytes: number;
  /** 이번 전이가 앞에서 걷어낸 스냅샷 수. */
  readonly evictedCount: number;
  /** 퇴출 원인이 바이트 예산이면 true(개수 방벽만 물었으면 false). */
  readonly evictedForBudget: boolean;
  /** 이번에 새로 붙은 엔트리 1개의 계량 바이트 — "단계당 약 N MB" 예고에 쓴다. */
  readonly appendedEntryBytes: number;
  /** 적용된 예산(옵션 반영 후) — UI 가 같은 숫자를 보여줄 수 있게 함께 돌려준다. */
  readonly budgetBytes: number;
};

const EMPTY: readonly unknown[] = [];

const MIB = 1024 * 1024;

/** 사람이 읽는 크기 — MB 미만은 KB 로, 그 이상은 소수 한 자리 MB 로. */
export function formatStudioHistoryBytes(bytes: number): string {
  const safe = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (safe < MIB) return `${Math.max(0, Math.round(safe / 1024))} KB`;
  const mb = safe / MIB;
  return `${mb >= 100 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
}

/**
 * 경계가 실제로 물었을 때 아티스트에게 하는 말.
 *
 * 오래된 단계가 조용히 사라지는 동작 자체는 오늘 200번째에서 일어나던 일과 **정확히 같다**.
 * 달라진 건 그 사실을 알린다는 점뿐이다 — 그리고 예산제에서는 깊이가 편집 종류에 따라 달라지므로
 * "왜 목록이 짧은지"를 말하지 않으면 상수 200보다 오히려 더 불투명해진다.
 */
export function describeStudioHistoryBudgetEviction(input: {
  readonly evictedSteps: number;
  readonly budgetBytes: number;
  readonly entryBytes: number;
  readonly retainedSteps: number;
  readonly collaborating?: boolean;
}): string {
  const budget = formatStudioHistoryBytes(input.budgetBytes);
  const parts = [
    `되돌리기 메모리 예산(${budget})에 도달해 오래된 ${input.evictedSteps.toLocaleString("ko-KR")}단계를 정리했어요.`,
  ];
  if (input.entryBytes > 0) {
    const perStep = formatStudioHistoryBytes(input.entryBytes);
    const depth = Math.max(
      STUDIO_PAGES_HISTORY_MIN_ENTRIES,
      Math.floor(input.budgetBytes / input.entryBytes)
    );
    parts.push(`지금 편집은 단계당 약 ${perStep} 라 약 ${depth.toLocaleString("ko-KR")}단계까지 유지돼요.`);
  }
  if (input.collaborating && input.entryBytes >= MIB) {
    // 나쁜 소식을 화면에 띄우는 지점. 이 상황을 예산제가 만든 게 아니다 — 예산제 이전에는 같은
    // 문서가 200단계 × 6.46 MiB = 1.29 GiB 를 붙들어 탭이 죽었다. 예산제는 그걸 보이게 만들고
    // 동시에 187 MB 로 줄인다. 근본 원인(협업 리코실러의 커밋당 문서 전체 복사)은 따로 남아 있다.
    parts.push("함께 편집 중에는 단계마다 문서 전체가 복사돼 되돌리기 깊이가 크게 줄어요. (원인: 원격 반영 경로)");
  }
  parts.push(`현재 ${input.retainedSteps.toLocaleString("ko-KR")}단계를 되돌릴 수 있어요.`);
  return parts.join(" ");
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function indexById(values: readonly unknown[]): Map<unknown, unknown> {
  const byId = new Map<unknown, unknown>();
  for (const value of values) {
    if (!isObjectLike(value)) continue;
    const id = value.id;
    if (id === undefined || byId.has(id)) continue;
    byId.set(id, value);
  }
  return byId;
}

/** 요소 1개가 **새로** 붙든 채널 바이트. 직전 요소와 참조를 공유하는 채널은 0 이다. */
function measureElementChannelBytes(
  element: Record<string, unknown>,
  previous: Record<string, unknown> | null
): number {
  let bytes = 0;
  for (const channel of STUDIO_HISTORY_MEASURED_NUMERIC_CHANNELS) {
    const next = element[channel];
    if (!Array.isArray(next)) continue;
    // 변형이 `{...el, points}` 스프레드라 `pressures` 등 나머지 채널을 공유하는 것까지 여기서 잡힌다.
    if (previous && previous[channel] === next) continue;
    bytes += STUDIO_HISTORY_DOUBLE_ARRAY_HEADER_BYTES
      + STUDIO_HISTORY_DOUBLE_SLOT_BYTES * next.length;
  }
  for (const channel of STUDIO_HISTORY_MEASURED_STRING_CHANNELS) {
    const next = element[channel];
    if (typeof next !== "string") continue;
    if (previous && previous[channel] === next) continue;
    bytes += STUDIO_HISTORY_STRING_HEADER_BYTES + next.length;
  }
  return bytes;
}

function measureElementsBytes(
  nextElements: readonly unknown[],
  previousElements: readonly unknown[] | null
): number {
  if (previousElements !== null && nextElements === previousElements) return 0;
  const previous = previousElements ?? EMPTY;
  let bytes = STUDIO_HISTORY_POINTER_ARRAY_HEADER_BYTES
    + STUDIO_HISTORY_POINTER_SLOT_BYTES * nextElements.length;
  // 레이어 재정렬은 요소를 전부 공유한 채 자리만 바꾼다. 자리로만 비교하면 그 커밋이 문서 전체를
  // 새로 구운 것처럼 계상되므로, 자리에서 어긋난 순간에만 id 색인을 만들어 공유를 되찾는다.
  let byId: Map<unknown, unknown> | null = null;
  for (let index = 0; index < nextElements.length; index += 1) {
    const element = nextElements[index];
    if (previous[index] === element) continue;
    byId ??= indexById(previous);
    const key = isObjectLike(element) ? element.id : undefined;
    const matched = key === undefined ? undefined : byId.get(key);
    if (matched === element) continue;
    bytes += STUDIO_HISTORY_ELEMENT_SHALLOW_BYTES;
    if (!isObjectLike(element)) continue;
    bytes += measureElementChannelBytes(element, isObjectLike(matched) ? matched : null);
  }
  return bytes;
}

/**
 * 이 스냅샷이 직전 스냅샷 대비 **새로** 붙든 바이트. 항등(`===`) 비교라서 구조 공유가 살아 있는
 * 만큼 정확히 0 으로 떨어진다.
 *
 * 비용은 O(페이지수 + 편집한 페이지의 요소수 + 이번에 새로 구운 샘플수) — 커밋이 이미 걷는 것과
 * 같은 집합이다. 협업 경로에서만 O(문서)인데, 그 경로는 리코실러가 이미 O(문서)라 새 점근 클래스가
 * 아니라 상수배다. 그래서 이 계량기는 협업을 특수 처리하지 않는데도 협업 절벽을 스스로 발견한다.
 */
export function measureStudioPagesHistoryEntryBytes(
  previousPages: readonly unknown[] | null | undefined,
  nextPages: readonly unknown[]
): number {
  if (previousPages === nextPages) return 0;
  const previous = previousPages ?? EMPTY;
  let bytes = STUDIO_HISTORY_POINTER_ARRAY_HEADER_BYTES
    + STUDIO_HISTORY_POINTER_SLOT_BYTES * nextPages.length;
  const shared = new Set<unknown>(previous);
  let byId: Map<unknown, unknown> | null = null;
  for (const page of nextPages) {
    if (shared.has(page)) continue;
    bytes += STUDIO_HISTORY_PAGE_OBJECT_BYTES;
    if (!isObjectLike(page)) continue;
    const nextElements = page.elements;
    if (!Array.isArray(nextElements)) continue;
    byId ??= indexById(previous);
    const before = byId.get(page.id);
    const previousElements = isObjectLike(before) && Array.isArray(before.elements)
      ? (before.elements as readonly unknown[])
      : null;
    bytes += measureElementsBytes(nextElements, previousElements);
  }
  return bytes;
}

/**
 * 장부. 스냅샷별 한계비용과 히스토리 배열별 누계를 각각 약하게 붙든다 — 히스토리 배열은 커밋마다
 * 새로 할당되므로 키가 겹치지 않고 GC 가 알아서 회수한다.
 */
const snapshotEntryBytes = new WeakMap<object, number>();
const historyRetainedBytes = new WeakMap<object, number>();

/** 테스트 전용 — 모듈 지역 장부에 남은 계량값을 읽는다. */
export function readStudioPagesHistoryRetainedBytes(
  history: readonly unknown[]
): number | undefined {
  return historyRetainedBytes.get(history as object);
}

/**
 * 예산에 물릴 한 엔트리의 값. 계량기는 V8 슬롯 회계를 그대로 내고, **보정은 여기서 한 번만**
 * 곱한다 — 그래야 닫힌 형태 회귀 테스트와 힙 대조가 각각 따로 검증 가능하게 남는다.
 */
function chargeSnapshot(
  previousSnapshot: readonly unknown[] | undefined,
  snapshot: readonly unknown[]
): number {
  const cached = snapshotEntryBytes.get(snapshot as object);
  if (cached !== undefined) return cached;
  const bytes = measureStudioPagesHistoryEntryBytes(previousSnapshot ?? null, snapshot)
    * STUDIO_HISTORY_RETAINED_HEAP_CALIBRATION;
  snapshotEntryBytes.set(snapshot as object, bytes);
  return bytes;
}

/**
 * 새 스냅샷 1개를 붙인 히스토리 배열에 유지 경계를 적용한다. `nextHistory` 를 **제자리에서**
 * 앞부터 잘라내고(오늘 개수 상한이 하던 것과 정확히 같은 동작), 적용 후의 누계를 장부에 남긴다.
 *
 * 장부 미스(CRDT 리베이스처럼 이 모듈 밖에서 조립된 히스토리 배열)일 때는 알려진 엔트리를
 * 합산하고, 모르는 엔트리에는 **방금 계량한 새 엔트리의 한계비용**을 대신 물린다. 이 대체값은
 * 상황에 맞게 자동으로 갈린다 — 협업 리베이스 직후의 커밋은 문서 전체를 재-materialize 하므로
 * 대체값이 MiB 급이 되어 누계가 곧바로 옳아지고, 솔로 리베이스(이미지 참조 정규화 등) 직후의
 * 커밋은 얕은 패치라 대체값이 KB 급이 되어 깊이가 엉뚱하게 잘리지 않는다.
 */
export function applyStudioPagesHistoryRetention(input: {
  /** 이번 전이의 입력 히스토리(누계 장부 조회 키). */
  readonly sourceHistory: readonly unknown[];
  /** 새 스냅샷을 밀어 넣기 전까지 `sourceHistory` 에서 유지한 접두 길이. */
  readonly keptLength: number;
  /** 새 스냅샷까지 들어간 결과 배열 — 이 함수가 제자리에서 앞을 잘라낸다. */
  readonly nextHistory: unknown[];
  readonly options?: StudioPagesHistoryRetentionOptions;
}): StudioPagesHistoryRetentionResult {
  const { sourceHistory, keptLength, nextHistory, options } = input;
  const budgetBytes = options?.budgetBytes ?? STUDIO_PAGES_HISTORY_RETAINED_BYTES_BUDGET;
  const maxEntries = Math.max(1, options?.maxEntries ?? STUDIO_PAGES_HISTORY_MAX_ENTRIES);
  const minEntries = Math.max(1, options?.minEntries ?? STUDIO_PAGES_HISTORY_MIN_ENTRIES);

  const appendedIndex = nextHistory.length - 1;
  const appended = nextHistory[appendedIndex] as readonly unknown[] | undefined;
  const previousSnapshot = keptLength > 0
    ? (nextHistory[keptLength - 1] as readonly unknown[] | undefined)
    : undefined;
  const appendedEntryBytes = appended ? chargeSnapshot(previousSnapshot, appended) : 0;

  const cachedTotal = keptLength === sourceHistory.length
    ? historyRetainedBytes.get(sourceHistory as object)
    : undefined;
  let total: number;
  if (cachedTotal !== undefined) {
    total = cachedTotal + appendedEntryBytes;
  } else {
    let known = appendedEntryBytes;
    let unknownEntries = 0;
    for (let index = 0; index < keptLength; index += 1) {
      const bytes = snapshotEntryBytes.get(nextHistory[index] as object);
      if (bytes === undefined) unknownEntries += 1;
      else known += bytes;
    }
    total = known + unknownEntries * appendedEntryBytes;
  }

  let evictedCount = 0;
  let evictedForBudget = false;
  while (
    nextHistory.length - evictedCount > minEntries
    && (total > budgetBytes || nextHistory.length - evictedCount > maxEntries)
  ) {
    if (total > budgetBytes) evictedForBudget = true;
    total = Math.max(0, total - (snapshotEntryBytes.get(nextHistory[evictedCount] as object) ?? 0));
    evictedCount += 1;
  }
  if (evictedCount > 0) nextHistory.splice(0, evictedCount);
  historyRetainedBytes.set(nextHistory as object, total);

  return { retainedBytes: total, evictedCount, evictedForBudget, appendedEntryBytes, budgetBytes };
}
