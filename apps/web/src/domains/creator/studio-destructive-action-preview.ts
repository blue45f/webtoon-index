/**
 * 파괴적 명령의 preview · 트랜잭션 · undo 고지 — V5 §15 "Undo 신뢰" 배선.
 *
 * 감사(ux-audit-v5 §2.12): 파괴적 명령의 안전장치가 네이티브 browser confirm
 * 10곳뿐이고 preview 도 transaction 도 없다. 게다가 그 중 다섯 곳은 커밋 반환값을
 * 버려서, 문서 잠금·저장 중 거절이 **아무 표시 없이** 사라진다.
 *
 * 이 모듈이 세 가지를 준다.
 *  1. **preview** — 무엇이 몇 개 사라지고 무엇이 들어오는지, 되돌릴 수 있는지를
 *     구조화된 요청에서 한국어 텍스트로 조립한다(순수 함수, 테스트 가능).
 *  2. **transaction** — `runStudioDestructiveAction` 이 승인·실행·결과를 한 흐름으로
 *     묶는다. 실행이 거절(false)되거나 던지면 **반드시** 원장에 남는다 — 조용한
 *     무동작 금지.
 *  3. **undo 고지** — 되돌릴 수 있는 명령은 실행 직후 원장에 undo 핸들과 함께 기록되고,
 *     상태 레일이 "실행 취소" 버튼으로 노출한다.
 *
 * 되돌릴 수 없는 명령(예: 저장소에서 복구 지점 삭제)도 동일한 커스텀 승인 표면을
 * 유지하며 무엇이 영구히 사라지는지 preview 에 명시한다 — `reversibility: "irreversible"`.
 *
 * 순수 모듈: React·DOM·타이머 없음. presenter 는 주입 가능한 seam 이고, 승인 표면이
 * 없으면 파괴를 거절한다. 네이티브 browser confirm 은 구조화 preview·포커스·감사 원장을
 * 보장하지 못하므로 fallback 으로도 사용하지 않는다.
 */

/**
 * 되돌림 등급.
 *  - `undoable` — 문서 히스토리(⌘Z)로 정확히 되돌아온다.
 *  - `irreversible` — 되돌릴 수 없다(서버 삭제·브라우저 저장소 레코드 삭제·히스토리 밖 문서
 *    사이드카). 승인 게이트를 유지하되 무엇이 영구히 사라지는지 명시한다.
 *  - `document-untouched` — 그림 문서를 전혀 건드리지 않는다(내보내기 선택, 공유 동의,
 *    기기 라이브러리 가져오기). "실행 취소로 되돌아온다"도 "영구히 사라진다"도 거짓이므로
 *    별도 등급을 둔다 — 거짓 안심과 거짓 공포 둘 다 조용한 실패의 한 형태다.
 */
export type StudioDestructiveReversibility =
  | "undoable"
  | "irreversible"
  | "document-untouched";

export interface StudioDestructiveLoss {
  /** 사라지는 대상의 이름. 예: "현재 페이지의 요소". */
  readonly label: string;
  /** 셀 수 있으면 개수. 생략하면 개수 없이 라벨만 노출한다. */
  readonly count?: number;
  /** 사라지지 **않는** 것에 대한 단서 등 보조 설명. */
  readonly note?: string;
}

export interface StudioDestructiveActionRequest {
  /** 안정 식별자 — 계약 테스트와 원장 중복 판정의 키. */
  readonly id: string;
  /** 명령 이름. preview 첫 줄. */
  readonly title: string;
  /**
   * 제목 바로 아래 한 문단. 손실 목록으로 표현되지 않는 명령(내보내기 분할 선택, 공유 동의,
   * 기기 라이브러리 가져오기)이 **무슨 일이 일어나는지**를 말하는 자리다. 이 값이 있고
   * `losses` 가 비어 있으면 "사라지는 것" 블록 자체를 띄우지 않는다 — 사라지는 것이 없는데
   * "확인된 손실 없음"을 읽히는 것은 정보가 아니라 잡음이다.
   */
  readonly intro?: string;
  /** 사라지는 것들. 비어 있으면 preview 는 "확인된 손실 없음"을 명시한다. */
  readonly losses: readonly StudioDestructiveLoss[];
  /** 대신 들어오는 것들(교체형 명령). */
  readonly gains?: readonly string[];
  readonly reversibility: StudioDestructiveReversibility;
  /**
   * 실행 취소의 **범위 한계**. 되돌림이 문서 일부에만 적용될 때 반드시 적는다 —
   * "되돌릴 수 있다"고만 말하고 일부가 안 돌아오면 그것이 숨은 실패다.
   */
  readonly undoNote?: string;
  /**
   * 승인 버튼 문구. 취소가 "아무 일도 안 함"이 아니라 **두 번째 동작**인 명령(예: 내보내기
   * 분할 대신 배율 낮추기)은 두 라벨을 반드시 채운다 — 무엇을 고르는지 모르게 하는 것이
   * 조용한 실패다.
   */
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
}

export const STUDIO_DESTRUCTIVE_UNDO_HINT =
  "실행 취소(Ctrl/⌘+Z)로 되돌릴 수 있어요.";
export const STUDIO_DESTRUCTIVE_IRREVERSIBLE_HINT =
  "되돌릴 수 없어요. 실행 취소로도 복구되지 않습니다.";
export const STUDIO_DESTRUCTIVE_DOCUMENT_UNTOUCHED_HINT =
  "그림 문서는 바뀌지 않아요.";

export function studioDestructiveReversibilityHint(
  reversibility: StudioDestructiveReversibility,
): string {
  switch (reversibility) {
    case "undoable":
      return STUDIO_DESTRUCTIVE_UNDO_HINT;
    case "irreversible":
      return STUDIO_DESTRUCTIVE_IRREVERSIBLE_HINT;
    case "document-untouched":
      return STUDIO_DESTRUCTIVE_DOCUMENT_UNTOUCHED_HINT;
  }
}

function formatLoss(loss: StudioDestructiveLoss): string {
  const counted =
    typeof loss.count === "number" && Number.isFinite(loss.count)
      ? `${loss.label} ${loss.count}개`
      : loss.label;
  return loss.note ? `· ${counted} (${loss.note})` : `· ${counted}`;
}

/**
 * 승인 화면에 그대로 띄우는 preview 텍스트.
 * "무엇이 사라지는가"를 먼저, "무엇이 들어오는가"를 다음에, 되돌림 가능 여부를 마지막에.
 */
export function formatStudioDestructivePreview(
  request: StudioDestructiveActionRequest,
): string {
  const blocks: string[] = [request.title];
  if (request.intro) blocks.push(request.intro);
  // 손실이 없고 무슨 일이 일어나는지 intro 가 이미 말했다면 빈 손실 블록을 띄우지 않는다.
  if (request.losses.length > 0 || !request.intro) {
    const lossLines =
      request.losses.length === 0
        ? ["· 확인된 손실 없음"]
        : request.losses.map(formatLoss);
    blocks.push(["사라지는 것", ...lossLines].join("\n"));
  }
  if (request.gains && request.gains.length > 0) {
    blocks.push(
      ["대신 들어오는 것", ...request.gains.map((gain) => `· ${gain}`)].join("\n"),
    );
  }
  const closing = [studioDestructiveReversibilityHint(request.reversibility)];
  if (request.undoNote) closing.push(request.undoNote);
  blocks.push(closing.join("\n"));
  return blocks.join("\n\n");
}

/** 원장·상태 레일에 쓰는 한 줄 요약. */
export function summarizeStudioDestructiveLosses(
  request: StudioDestructiveActionRequest,
): string {
  if (request.losses.length === 0) return request.title;
  return request.losses
    .map((loss) =>
      typeof loss.count === "number" && Number.isFinite(loss.count)
        ? `${loss.label} ${loss.count}개`
        : loss.label,
    )
    .join(" · ");
}

/* ------------------------------------------------------------------ */
/* Presenter seam                                                      */
/* ------------------------------------------------------------------ */

/**
 * 승인 표면. 온캔버스 다이얼로그는 사용자의 응답을 동기적으로 돌려줄 수 없으므로
 * `Promise<boolean>` 을 허용한다. 동기 presenter(테스트)도 그대로 쓴다.
 */
export type StudioDestructiveConfirmPresenter = (
  request: StudioDestructiveActionRequest,
  preview: string,
) => boolean | Promise<boolean>;

let presenter: StudioDestructiveConfirmPresenter | null = null;

/**
 * preview 표면 교체 지점. 온캔버스 다이얼로그(`StudioDestructiveConfirmHost`)가 마운트되면
 * 여기에 꽂힌다. 표면이 없는 테스트·SSR·미마운트 라우트에서는 fail-closed 한다.
 */
export function setStudioDestructiveConfirmPresenter(
  next: StudioDestructiveConfirmPresenter | null,
): void {
  presenter = next;
}

function defaultPresenter(): boolean {
  // 승인 표면이 없으면 파괴를 진행하지 않는다(fail-closed). 브라우저 confirm 으로
  // 강등하면 구조화 preview·포커스 복귀·테스트 가능한 결과 계약을 잃는다.
  return false;
}

/**
 * 승인 여부를 묻는 단일 통로. presenter 가 던지면 **거절**로 처리한다 — 승인 표면이
 * 깨졌을 때 파괴가 통과하는 쪽이 더 나쁜 실패다.
 */
async function askForApproval(
  request: StudioDestructiveActionRequest,
): Promise<boolean> {
  const preview = formatStudioDestructivePreview(request);
  try {
    const answer = await (presenter ?? (() => defaultPresenter()))(
      request,
      preview,
    );
    return answer === true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Undo ledger                                                         */
/* ------------------------------------------------------------------ */

export type StudioDestructiveOutcome = "committed" | "refused" | "failed";

export interface StudioDestructiveActionRecord {
  readonly id: string;
  readonly title: string;
  readonly outcome: StudioDestructiveOutcome;
  /** 사용자가 읽을 한 줄. 성공이면 무엇이 사라졌는지, 실패면 왜 못 했는지. */
  readonly summary: string;
  readonly reversibility: StudioDestructiveReversibility;
  readonly at: number;
  /** 되돌릴 수 있고 호출부가 핸들을 줬을 때만 non-null. */
  readonly undo: (() => void) | null;
}

let record: StudioDestructiveActionRecord | null = null;
const ledgerListeners = new Set<() => void>();

function publishLedger(): void {
  for (const listener of [...ledgerListeners]) {
    try {
      listener();
    } catch {
      // 구독자 격리 — 한 구독자의 예외가 다른 구독자의 고지를 막지 않는다.
    }
  }
}

export function subscribeStudioDestructiveActionLedger(listener: () => void): () => void {
  ledgerListeners.add(listener);
  return () => {
    ledgerListeners.delete(listener);
  };
}

export function getStudioDestructiveActionRecord(): StudioDestructiveActionRecord | null {
  return record;
}

export function dismissStudioDestructiveActionRecord(id?: string): void {
  if (record === null) return;
  if (id !== undefined && record.id !== id) return;
  record = null;
  publishLedger();
}

function pushRecord(next: StudioDestructiveActionRecord): void {
  record = Object.freeze(next);
  publishLedger();
}

/** 테스트 격리용. */
export function resetStudioDestructiveActionLedger(): void {
  record = null;
  ledgerListeners.clear();
  presenter = null;
}

/* ------------------------------------------------------------------ */
/* Transaction runner                                                  */
/* ------------------------------------------------------------------ */

export interface StudioDestructiveActionInput {
  readonly request: StudioDestructiveActionRequest;
  /**
   * 승인 후 실제 파괴. `false` 를 돌려주면 **거절**로 간주해 원장에 남긴다
   * (문서 잠금·저장 중 커밋 거절이 조용히 사라지던 경로가 여기로 온다).
   * `void`/`true` 는 성공.
   */
  execute: () => boolean | void;
  /** 되돌릴 수 있는 명령의 실행 취소 핸들(보통 StudioPage 의 `undo`). */
  readonly undo?: () => void;
  readonly now?: () => number;
}

export type StudioDestructiveRunStatus = "declined" | StudioDestructiveOutcome;

/** 성공 고지 문구 — 되돌림 등급별로 사실만 말한다. */
function committedSummary(request: StudioDestructiveActionRequest): string {
  switch (request.reversibility) {
    case "undoable":
      return `${summarizeStudioDestructiveLosses(request)}을(를) 정리했어요.`;
    case "irreversible":
      return `${summarizeStudioDestructiveLosses(request)}을(를) 영구히 지웠어요.`;
    case "document-untouched":
      return `${request.title}을(를) 실행했어요.`;
  }
}

function refusedSummary(request: StudioDestructiveActionRequest): string {
  return `${request.title}을(를) 적용하지 못했습니다. 문서가 잠겼거나 저장 중일 수 있어요.`;
}

/**
 * preview → 승인 → 실행 → 결과 고지의 단일 흐름.
 * 반환값은 호출부가 후속 상태 갱신을 이어갈지 판단하는 데 쓴다(`"committed"` 만 진행).
 */
export async function runStudioDestructiveAction(
  input: StudioDestructiveActionInput,
): Promise<StudioDestructiveRunStatus> {
  const request = input.request;
  if (!(await askForApproval(request))) return "declined";
  const at = (input.now ?? Date.now)();
  let outcome: StudioDestructiveOutcome;
  let summary: string;
  try {
    const result = input.execute();
    if (result === false) {
      outcome = "refused";
      summary = refusedSummary(request);
    } else {
      outcome = "committed";
      summary = committedSummary(request);
    }
  } catch (cause: unknown) {
    outcome = "failed";
    summary = `${request.title} 중 오류가 났습니다: ${
      cause instanceof Error ? cause.message : String(cause)
    }`;
  }
  pushRecord({
    id: request.id,
    title: request.title,
    outcome,
    summary,
    reversibility: request.reversibility,
    at,
    undo:
      outcome === "committed"
      && request.reversibility === "undoable"
      && input.undo
        ? input.undo
        : null,
  });
  return outcome;
}

/**
 * 승인만 필요한 경우(실행이 비동기라 트랜잭션으로 감쌀 수 없는 호출부)의 최소 표면.
 * 실행 결과는 호출부가 별도로 `recordStudioDestructiveOutcome` 로 남겨야 한다 —
 * 승인만 하고 결과를 안 남기면 그것이 조용한 실패다.
 */
export function confirmStudioDestructiveAction(
  request: StudioDestructiveActionRequest,
): Promise<boolean> {
  return askForApproval(request);
}

export function recordStudioDestructiveOutcome(input: {
  readonly request: StudioDestructiveActionRequest;
  readonly outcome: StudioDestructiveOutcome;
  readonly detail?: string;
  readonly undo?: () => void;
  readonly now?: () => number;
}): void {
  const { request, outcome } = input;
  const summary =
    input.detail
    ?? (outcome === "committed"
      ? committedSummary(request)
      : outcome === "refused"
        ? refusedSummary(request)
        : `${request.title} 중 오류가 났습니다.`);
  pushRecord({
    id: request.id,
    title: request.title,
    outcome,
    summary,
    reversibility: request.reversibility,
    at: (input.now ?? Date.now)(),
    undo:
      outcome === "committed"
      && request.reversibility === "undoable"
      && input.undo
        ? input.undo
        : null,
  });
}
