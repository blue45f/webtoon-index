/**
 * 통합 실행취소 저널 — 캔버스 스냅샷 히스토리와 히스토리 밖 사이드카 문서를 **하나의 시간 순서**로 묶는다.
 *
 * `pagesHistory: PageState[][]` 는 페이지 배열만 담는다. 캐릭터 바이블·Writer Room 같은 사이드카
 * 문서는 그 밖에서 살기 때문에, 예전에는 사이드카를 고친 직후의 ⌘Z 가 **화면 밖 캔버스 획**을
 * 지웠다 — 사용자가 만진 것과 전혀 다른 대상이 사라지는 조용한 실패다. 일회성 배리어로 파괴는
 * 막았지만 사이드카 편집은 여전히 되돌릴 수 없었다.
 *
 * 이 모듈은 스냅샷 히스토리를 **대체하지 않는다**. 그 위에 순서만 기록하는 얇은 층을 얹는다.
 *
 *  - `{ kind: "pages" }`   — 기존 `pagesHi` 기계 장치의 한 단계. 페이로드 없음(스냅샷은 여전히
 *                            `pagesHistory` 가 소유한다). 그래서 획별 undo 입도·CRDT 전이 발행·
 *                            저장 중 게이트·합치기 계약이 전부 그대로다.
 *  - `{ kind: "sidecar" }` — 사이드카 문서 편집 한 건. 이전/다음 문서를 함께 들고 다닌다.
 *
 * 표면별로 undo 스택을 따로 두지 않는 이유: ⌘Z 의 의미가 포커스된 패널에 따라 달라지면
 * "방금 한 일"을 되돌린다는 계약 자체가 깨진다. 하나의 시간 순서가 이 설계의 전부다.
 *
 * ## 문서 스냅샷을 복제하지 않는 이유
 *
 * 두 사이드카 문서는 zod 파싱으로만 만들어지는 값 객체이고, `studio-character-bible.ts` ·
 * `studio-writer-room.ts` 의 모든 변경 함수는 입력을 건드리지 않고 새 객체를 돌려준다
 * (`studio-history-journal.test.ts` 가 이 불변식을 검증한다). 참조를 그대로 담으면 바뀐 경로만
 * 새로 할당되는 **구조 공유**가 유지돼 긴 저널이 싸게 유지된다. 여기서 `structuredClone`
 * 을 부르면 그 공유가 통째로 깨져 오히려 메모리가 폭발한다.
 *
 * ## 저널 길이 상한이 어디에 서는가
 *
 * `pages` 항목 수는 **스냅샷 히스토리의 유지 바이트 예산**이 정한다
 * (`studio-history-retention-budget.ts`; 개수 방벽 `STUDIO_PAGES_HISTORY_MAX_ENTRIES`).
 * 저널은 그 결과를 `nextUndoDepth` 로 받아 같은 수만큼 앞에서 걷어낼 뿐 스스로 판단하지 않는다.
 * 사이드카 항목만 저널이 직접 묶는다 — 아래 `STUDIO_HISTORY_JOURNAL_MAX_SIDECAR_ENTRIES` 참고.
 */

import { STUDIO_PAGES_HISTORY_MAX_ENTRIES } from "./studio-history-retention-budget";
/** 저널이 추적하는 히스토리 밖 문서. */
export type StudioHistoryJournalSidecarTarget = "characterBible" | "writerRoom";

/** 사이드카 편집 한 건 — 이전/다음 문서를 모두 들고 있어야 undo·redo 가 대칭이 된다. */
export type StudioHistoryJournalSidecarEntry<Bible, Writer> =
  | {
      readonly kind: "sidecar";
      readonly target: "characterBible";
      readonly before: Bible;
      readonly after: Bible;
      /** 합치기 창 판정용 기록 시각(ms). */
      readonly at: number;
    }
  | {
      readonly kind: "sidecar";
      readonly target: "writerRoom";
      readonly before: Writer;
      readonly after: Writer;
      readonly at: number;
    };

export type StudioHistoryJournalEntry<Bible, Writer> =
  | { readonly kind: "pages" }
  | StudioHistoryJournalSidecarEntry<Bible, Writer>;

export interface StudioHistoryJournal<Bible, Writer> {
  readonly entries: readonly StudioHistoryJournalEntry<Bible, Writer>[];
  /** 되돌릴 수 있는 항목 수. `entries[cursor - 1]` 이 다음 ⌘Z 대상, `entries[cursor]` 가 다음 ⇧⌘Z 대상. */
  readonly cursor: number;
}

/**
 * 사이드카 항목 상한 — 캔버스 쪽 개수 방벽과 **같은 상수**를 쓴다(리터럴을 복제하면 둘이 갈라진다).
 *
 * ## 왜 사이드카는 바이트가 아니라 개수로 묶는가
 *
 * 캔버스 스냅샷에서 개수가 틀린 게이트인 이유는 엔트리당 페이로드가 376 B ~ 6.46 MiB 로 네 자릿수
 * 배 갈리기 때문이다. 사이드카는 정반대다 — 페이로드가 zod 값 객체 **참조**이고 모든 변경 함수가
 * 구조 공유를 유지하므로 엔트리당 비용이 포인터 수준으로 균일하다(2,000개면 수백 KB 규모).
 * 크기가 균일한 곳에서는 개수가 정확히 옳은 게이트다.
 *
 * 반대로 사이드카를 바이트로 재려면 두 문서를 깊게 걸어야 하는데, 그건 800 ms 합치기 창 안에서
 * **키 입력마다** O(문서) 를 무는 일이다 — 이득 없는 비용이다.
 *
 * 다만 값을 200 에 남겨 두면 비대칭이 생긴다: 긴 세션 뒤 ⌘Z 가 캔버스 단계는 수천 칸 걸어가는데
 * 그 구간의 오래된 로그라인 편집만 조용히 사라진다. 아티스트가 만진 것과 다른 게 되돌려지는,
 * 이 모듈이 애초에 없애려던 실패 그대로다. 그래서 캔버스 방벽과 같은 값으로 함께 올린다.
 */
export const STUDIO_HISTORY_JOURNAL_MAX_SIDECAR_ENTRIES = STUDIO_PAGES_HISTORY_MAX_ENTRIES;

/**
 * 같은 사이드카를 연속으로 고칠 때 한 항목으로 합치는 시간 창(ms).
 *
 * 패널 입력은 **키 입력마다** onChange 를 쏜다. 합치지 않으면 로그라인 한 줄을 지우는 데 ⌘Z 를
 * 스무 번 눌러야 하고 저널이 글자 수만큼 부푼다. 캔버스의 `commitCoalesced` 와 같은 계약이며,
 * 중간에 캔버스 커밋이 끼면 `pages` 항목이 사이에 들어가 합치기 사슬이 자연히 끊긴다.
 */
export const STUDIO_HISTORY_JOURNAL_SIDECAR_COALESCE_MS = 800;

const PAGES_ENTRY = Object.freeze({ kind: "pages" as const });

const SIDECAR_LABELS: Record<StudioHistoryJournalSidecarTarget, string> = {
  characterBible: "캐릭터 바이블",
  writerRoom: "Writer Room",
};

/** 되돌린 대상을 스크린리더·상태줄에 알릴 때 쓰는 사람이 읽는 이름. */
export function studioHistoryJournalSidecarLabel(
  target: StudioHistoryJournalSidecarTarget
): string {
  return SIDECAR_LABELS[target];
}

export function createStudioHistoryJournal<Bible, Writer>(): StudioHistoryJournal<Bible, Writer> {
  return { entries: [], cursor: 0 };
}

export function countStudioHistoryJournalPagesEntries<Bible, Writer>(
  entries: readonly StudioHistoryJournalEntry<Bible, Writer>[]
): number {
  let count = 0;
  for (const entry of entries) if (entry.kind === "pages") count += 1;
  return count;
}

function boundedCursor<Bible, Writer>(journal: StudioHistoryJournal<Bible, Writer>): number {
  return Math.max(0, Math.min(journal.cursor, journal.entries.length));
}

/**
 * 사이드카 항목이 상한을 넘으면 **가장 오래된 사이드카부터** 버린다. `pages` 항목은 스냅샷
 * 히스토리와 1:1 이라 여기서 절대 버리지 않는다 — 버리면 두 자료구조가 어긋난다.
 */
function capStudioHistoryJournalSidecarEntries<Bible, Writer>(
  journal: StudioHistoryJournal<Bible, Writer>
): StudioHistoryJournal<Bible, Writer> {
  const entries = journal.entries;
  let excess = entries.length - countStudioHistoryJournalPagesEntries(entries)
    - STUDIO_HISTORY_JOURNAL_MAX_SIDECAR_ENTRIES;
  if (excess <= 0) return journal;

  const cursor = boundedCursor(journal);
  const kept: StudioHistoryJournalEntry<Bible, Writer>[] = [];
  let nextCursor = cursor;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry.kind === "sidecar" && excess > 0) {
      excess -= 1;
      if (index < cursor) nextCursor -= 1;
      continue;
    }
    kept.push(entry);
  }
  return { entries: kept, cursor: Math.max(0, nextCursor) };
}

/**
 * 스냅샷 히스토리가 새 단계를 만들었을 때 저널에 같은 수의 `pages` 항목을 넣는다.
 *
 * @param addedSteps    이번 전이가 커서 위치에 새로 만든 `pages` 단계 수.
 * @param nextUndoDepth 전이 후의 `pagesHi`. 유지 바이트 예산에 밀려 스냅샷이 앞에서 잘려 나갔으면
 *                      이 값이 기대치보다 작다. 저널도 같은 수의 `pages` 항목을 앞에서 버려
 *                      둘이 어긋나지 않게 한다.
 *
 * 개수 상한 시절에는 한 전이가 스냅샷을 **정확히 1개**만 버렸다. 바이트 예산에서는 무거운 커밋
 * 하나가 예산을 여러 엔트리분 넘길 수 있어 `excess` 가 2 이상이 된다 — 아래 루프는 처음부터
 * N 개 일괄 처리로 쓰여 있지만 그 경로가 실제로 돌기 시작한 것은 예산제부터다. 두 불변식
 * (커서 앞 `pages` 수 == `pagesHi`, 전체 `pages` 수 == `pagesHistory.length - 1`)에 대한
 * N-퇴출 회귀 테스트를 `studio-history-journal.test.ts` 가 들고 있다.
 */
export function recordStudioHistoryJournalPagesSteps<Bible, Writer>(
  journal: StudioHistoryJournal<Bible, Writer>,
  input: { readonly addedSteps: number; readonly nextUndoDepth: number }
): StudioHistoryJournal<Bible, Writer> {
  // 새 커밋은 redo 가지를 버린다 — 스냅샷 히스토리의 `slice(0, index + 1)` 과 반드시 보조를 맞춘다.
  const kept = journal.entries.slice(0, boundedCursor(journal));
  const addedSteps = Math.max(0, Math.trunc(input.addedSteps));
  for (let step = 0; step < addedSteps; step += 1) kept.push(PAGES_ENTRY);

  let excess = countStudioHistoryJournalPagesEntries(kept) - Math.max(0, input.nextUndoDepth);
  if (excess <= 0) {
    return capStudioHistoryJournalSidecarEntries({ entries: kept, cursor: kept.length });
  }
  // 앞에서 밀려난 `pages` 항목만 걷어낸다. 그보다 오래된 사이드카는 스냅샷 히스토리에 기대지
  // 않으므로 살려 둔다 — 캔버스를 많이 그렸다는 이유로 되돌릴 수 있던 로그라인을 잃을 이유가 없다.
  const trimmed: StudioHistoryJournalEntry<Bible, Writer>[] = [];
  for (const entry of kept) {
    if (entry.kind === "pages" && excess > 0) {
      excess -= 1;
      continue;
    }
    trimmed.push(entry);
  }
  return capStudioHistoryJournalSidecarEntries({ entries: trimmed, cursor: trimmed.length });
}

function coalesceStudioHistoryJournalSidecarEntry<Bible, Writer>(
  previous: StudioHistoryJournalEntry<Bible, Writer> | undefined,
  next: StudioHistoryJournalSidecarEntry<Bible, Writer>,
  coalesceWindowMs: number
): StudioHistoryJournalSidecarEntry<Bible, Writer> | null {
  if (!previous || previous.kind !== "sidecar") return null;
  if (next.at - previous.at > coalesceWindowMs || next.at < previous.at) return null;
  // 합쳐도 `before` 는 사슬의 **첫** 값을 유지한다. 그래야 ⌘Z 한 번이 타이핑 묶음 전체를 되돌린다.
  if (next.target === "characterBible") {
    return previous.target === "characterBible" ? { ...next, before: previous.before } : null;
  }
  return previous.target === "writerRoom" ? { ...next, before: previous.before } : null;
}

/** 사이드카 편집 한 건을 저널 맨 뒤에 기록한다(합치기 창 안이면 직전 항목의 `after` 만 갈아끼운다). */
export function recordStudioHistoryJournalSidecarEdit<Bible, Writer>(
  journal: StudioHistoryJournal<Bible, Writer>,
  entry: StudioHistoryJournalSidecarEntry<Bible, Writer>,
  options: { readonly coalesceWindowMs?: number } = {}
): StudioHistoryJournal<Bible, Writer> {
  // 사이드카 편집도 새 작업이다 — 캔버스 커밋과 똑같이 redo 가지를 버린다.
  const entries = journal.entries.slice(0, boundedCursor(journal));
  const coalesced = coalesceStudioHistoryJournalSidecarEntry(
    entries[entries.length - 1],
    entry,
    options.coalesceWindowMs ?? STUDIO_HISTORY_JOURNAL_SIDECAR_COALESCE_MS
  );
  if (coalesced) {
    entries[entries.length - 1] = coalesced;
    return { entries, cursor: entries.length };
  }
  entries.push(entry);
  return capStudioHistoryJournalSidecarEntries({ entries, cursor: entries.length });
}

/** 다음 ⌘Z 대상. 없으면 null. */
export function readStudioHistoryJournalUndoEntry<Bible, Writer>(
  journal: StudioHistoryJournal<Bible, Writer>
): StudioHistoryJournalEntry<Bible, Writer> | null {
  return journal.entries[boundedCursor(journal) - 1] ?? null;
}

/** 다음 ⇧⌘Z 대상. 없으면 null. */
export function readStudioHistoryJournalRedoEntry<Bible, Writer>(
  journal: StudioHistoryJournal<Bible, Writer>
): StudioHistoryJournalEntry<Bible, Writer> | null {
  return journal.entries[boundedCursor(journal)] ?? null;
}

/** 커서만 한 칸 옮긴다 — 대상 복원(스냅샷 인덱스든 사이드카 문서든)은 호출자가 한다. */
export function stepStudioHistoryJournal<Bible, Writer>(
  journal: StudioHistoryJournal<Bible, Writer>,
  direction: "undo" | "redo"
): StudioHistoryJournal<Bible, Writer> {
  const cursor = boundedCursor(journal);
  const nextCursor = direction === "undo"
    ? Math.max(0, cursor - 1)
    : Math.min(journal.entries.length, cursor + 1);
  return nextCursor === journal.cursor ? journal : { entries: journal.entries, cursor: nextCursor };
}

/**
 * 히스토리 패널의 임의 인덱스 점프처럼 `pagesHi` 를 직접 옮겼을 때 커서를 그 깊이에 맞춘다.
 *
 * 같은 깊이를 만족하는 커서가 여럿이면 **가장 큰** 값을 고른다. 점프는 사이드카 문서를 되돌리지
 * 않으므로, 사이드카 항목은 계속 "완료됨" 쪽에 남아 있어야 문서 상태와 저널이 일치한다.
 */
export function seekStudioHistoryJournalToPagesDepth<Bible, Writer>(
  journal: StudioHistoryJournal<Bible, Writer>,
  pagesDepth: number
): StudioHistoryJournal<Bible, Writer> {
  const depth = Math.max(0, Math.trunc(pagesDepth));
  let seen = 0;
  let cursor = 0;
  for (let index = 0; index < journal.entries.length; index += 1) {
    if (journal.entries[index].kind === "pages") {
      if (seen === depth) break;
      seen += 1;
    }
    cursor = index + 1;
  }
  return cursor === journal.cursor ? journal : { entries: journal.entries, cursor };
}
