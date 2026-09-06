/**
 * 세션 오류 저널 — 버그 리포트에 실을 "최근 오류".
 *
 * 감사 시점 레포에는 런타임 오류를 모아 두는 곳이 **없었다**. `ErrorBoundary` 는
 * 현재 오류 하나만 컴포넌트 상태로 들고 있고, 신뢰성 스토어는 채널당 최신 신호
 * 하나만 유지한다(설계 의도). 그래서 사용자가 "아까 뭔가 터졌는데"를 리포트에
 * 담을 방법이 없었다.
 *
 * 이 저널은 그 구멍만 메운다. 캡 20건의 링 버퍼, 기록 시점에 즉시 마스킹, 저장
 * 없음(세션 한정), 전송 없음. 리스너는 수동 관찰자라 `preventDefault` 를 하지
 * 않으므로 기존 오류 처리 경로를 바꾸지 않는다.
 */

import {
  STUDIO_RENDER_FAILURE_EVENT,
  type StudioRenderFailureDetail,
} from "../../shared/lib/render-failure-event";

import { redactStudioDiagnosticText } from "./studio-diagnostic-redaction";

export interface StudioErrorJournalEntry {
  readonly at: number;
  readonly source: "window-error" | "unhandled-rejection" | "render-failure" | "reported";
  readonly name: string;
  readonly message: string;
}

export const STUDIO_ERROR_JOURNAL_LIMIT = 20;

let entries: StudioErrorJournalEntry[] = [];
let installed: (() => void) | null = null;

function errorName(value: unknown): string {
  if (value instanceof Error && value.name.length > 0) return value.name;
  if (typeof value === "object" && value !== null && "name" in value) {
    const name = (value as { name?: unknown }).name;
    if (typeof name === "string" && name.length > 0) return name;
  }
  return "Error";
}

function errorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && "message" in value) {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "알 수 없는 오류";
}

export function recordStudioError(
  cause: unknown,
  source: StudioErrorJournalEntry["source"] = "reported",
  at: number = Date.now(),
): void {
  const entry: StudioErrorJournalEntry = {
    at,
    source,
    name: redactStudioDiagnosticText(errorName(cause)),
    message: redactStudioDiagnosticText(errorMessage(cause)),
  };
  entries = [...entries.slice(-(STUDIO_ERROR_JOURNAL_LIMIT - 1)), entry];
}

export function readStudioErrorJournal(): readonly StudioErrorJournalEntry[] {
  return entries;
}

export function clearStudioErrorJournal(): void {
  entries = [];
}

export interface StudioErrorJournalTarget {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

/**
 * 전역 오류를 수동 관찰한다. 이미 설치돼 있으면 기존 해제자를 그대로 돌려준다 —
 * 스튜디오가 두 번 마운트돼도 리스너가 겹치지 않는다.
 */
export function installStudioErrorJournal(
  target: StudioErrorJournalTarget | null = typeof window === "undefined"
    ? null
    : (window as unknown as StudioErrorJournalTarget),
): () => void {
  if (installed) return installed;
  if (!target) return () => undefined;

  const onError = (event: Event) => {
    const detail = event as ErrorEvent;
    recordStudioError(detail.error ?? detail.message ?? event.type, "window-error");
  };
  const onRejection = (event: Event) => {
    const detail = event as PromiseRejectionEvent;
    recordStudioError(detail.reason ?? event.type, "unhandled-rejection");
  };
  // React 에러 바운더리가 잡은 예외는 window "error" 로 오지 않는다 — 바운더리가 이미 삼켰기
  // 때문이다. 그래서 무너진 패널은 이 저널에도, 버그 리포트의 "최근 오류"에도 없었다.
  const onRenderFailure = (event: Event) => {
    const detail = (event as CustomEvent<StudioRenderFailureDetail>).detail;
    recordStudioError(detail?.error ?? event.type, "render-failure");
  };

  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  target.addEventListener(STUDIO_RENDER_FAILURE_EVENT, onRenderFailure);

  installed = () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
    target.removeEventListener(STUDIO_RENDER_FAILURE_EVENT, onRenderFailure);
    installed = null;
  };
  return installed;
}
