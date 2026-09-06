/**
 * 신뢰성 상태 레일 — 저장·GPU·저장소 상태와 Safe Mode 를 사용자가 보는 곳에 띄운다.
 *
 * 감사(ux-audit-v5 §2.11)가 지목한 "숨은 실패" 세 가지(메인 캔버스 GPU 강등,
 * 자동저장 실패, OPFS 쿼터 초과)의 표시 지점이다. 기존 세션 복구 배너와 같은 레일
 * (StudioCanvasStatusRail) 안에 산다.
 *
 * 배선 규율:
 *  - **prop 이 없다.** 스토어를 직접 구독하므로 캔버스 뷰포트(무접촉 파일)의 prop
 *    사슬을 늘리지 않는다.
 *  - 마운트가 Safe Mode 런타임을 세운다(고지 표면이 곧 관측 표면). 언마운트는 런타임을
 *    내리지 않는다 — 세션 단위 상태기계이기 때문.
 *
 * 레이아웃 규율(2026-08 개편):
 *  - 이 레일은 **캔버스 흐름 밖(absolute 오버레이)** 이다. 예전에는 흐름 안의 띠였고,
 *    아무 문제도 없을 때조차 "저장·GPU 이상 없음" 한 줄이 26px(글 18px + mb 8px)를
 *    상시 예약했다. 그림 그리는 사람에게 그 26px 은 그리기 면적이고, 문장 자체는
 *    아무것도 알려주지 않는다.
 *  - 더 나쁜 쪽은 **실패가 났을 때**였다. 자동저장 실패·GPU 로스는 획을 긋는 도중에도
 *    들어오는데, 흐름 안의 띠가 그때 붙으면 캔버스 스테이지 원점이 통째로 내려간다
 *    (선택 명령 레인이 상시 예약으로 막아 둔 것과 정확히 같은 결함). 오버레이는 붙어도
 *    스테이지 기하를 1px 도 바꾸지 않으므로 그 경로 자체가 사라진다.
 *  - 대신 "이상 없음"을 통째로 버리지는 않는다. 상시 표시되는 **상태 점**이 캔버스 위에
 *    떠 있고(흐름 비용 0), 눌러서(마우스·키보드 모두) 저장·GPU·저장소·안전 모드의
 *    현재 상태를 언제든 확인할 수 있다. 실제 **문제**는 예전과 똑같이 배너·행으로
 *    role="status" · aria-live 와 함께 스스로 튀어나온다.
 */

import { useEffect, useState } from "react";

import {
  dismissStudioDestructiveActionRecord,
} from "./studio-destructive-action-preview";
import {
  dismissStudioRejectedStroke,
  restoreStudioRejectedStroke,
} from "./studio-rejected-stroke-recovery";
import {
  describeStudioSafeModeReason,
  exitStudioSafeModeManually,
} from "./studio-reliability-status-store";
import { ensureStudioSafeModeRuntime } from "./studio-safe-mode-runtime";
import {
  useStudioDestructiveActionRecord,
  useStudioRejectedStrokeRecords,
  useStudioReliabilityStatus,
} from "./use-studio-reliability-status";

import type { StudioReliabilityLevel, StudioReliabilitySignal } from "./studio-reliability-status-store";

/** 되돌릴 수 있는 파괴가 성공했을 때 실행 취소 버튼을 띄워 두는 시간. */
export const STUDIO_DESTRUCTIVE_UNDO_WINDOW_MS = 12_000;

/** 상태 점을 눌렀을 때 펼쳐지는 요약 패널의 고정 id — 점이 `aria-controls` 로 가리킨다. */
const RELIABILITY_DETAIL_ID = "studio-reliability-detail";

/** 상태 점이 요약하는 세 채널의 표시 이름. 패널의 행 순서도 이 순서다. */
const RELIABILITY_CHANNEL_LABELS = [
  ["save", "저장"],
  ["gpu", "GPU"],
  ["storage", "저장소"],
] as const;

function levelClassName(level: StudioReliabilityLevel): string {
  switch (level) {
    case "failed":
      return "border-danger/40 bg-danger-soft/20 text-danger";
    case "degraded":
      return "border-warning/35 bg-warning-soft/20 text-warning";
    case "ok":
      return "border-cool/35 bg-cool/10 text-cool";
  }
}

/** 상태 점 하나로 압축한 심각도. `quiet` 는 "알릴 것이 아무것도 없음"이다. */
type StudioReliabilityTone = "quiet" | "ok" | "degraded" | "failed";

function toneDotClassName(tone: StudioReliabilityTone): string {
  switch (tone) {
    case "failed":
      return "bg-danger";
    case "degraded":
      return "bg-warning";
    case "ok":
      return "bg-cool";
    case "quiet":
      return "bg-good/70";
  }
}

function toneChipClassName(tone: StudioReliabilityTone): string {
  switch (tone) {
    case "failed":
      return "border-danger/45 bg-danger-soft/35 text-danger";
    case "degraded":
      return "border-warning/45 bg-warning-soft/35 text-warning";
    case "ok":
      return "border-cool/40 bg-cool/15 text-cool";
    case "quiet":
      return "border-line/50 bg-panel/70 text-fg-3";
  }
}

function toneSummary(tone: StudioReliabilityTone): string {
  switch (tone) {
    case "failed":
      return "처리하지 못한 실패 있음";
    case "degraded":
      return "품질을 낮춰 계속 작업 중";
    case "ok":
      return "실패에서 회복됨";
    case "quiet":
      return "이상 없음";
  }
}

function SignalRow({ signal }: { signal: StudioReliabilitySignal }) {
  return (
    <div
      data-studio-reliability-signal={signal.channel}
      data-studio-reliability-level={signal.level}
      role="status"
      aria-live="polite"
      className={`pointer-events-auto flex w-full max-w-[min(30rem,100%)] min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-2.5 py-1.5 text-xs shadow-sm backdrop-blur-md ${levelClassName(signal.level)}`}
    >
      <span className="min-w-0 flex-1 font-semibold leading-relaxed">{signal.title}</span>
      {signal.detail ? (
        <span className="min-w-0 basis-full text-[0.68rem] font-medium opacity-80">
          {signal.detail}
        </span>
      ) : null}
    </div>
  );
}

export function StudioReliabilityStatusRail() {
  const status = useStudioReliabilityStatus();
  const destructive = useStudioDestructiveActionRecord();
  const rejectedStrokes = useStudioRejectedStrokeRecords();
  const [detailOpen, setDetailOpen] = useState(false);
  const [rejectedStrokeNotice, setRejectedStrokeNotice] = useState<string | null>(null);

  useEffect(() => {
    // 고지 표면이 마운트되면 로스 관측을 세운다. GPU 디바이스를 미리 잡지는 않는다.
    ensureStudioSafeModeRuntime();
  }, []);

  useEffect(() => {
    // 성공한 파괴는 실행 취소 창이 닫히면 스스로 물러난다. 거절·실패는 사용자가
    // 닫을 때까지 남는다 — 처리되지 않은 실패가 조용히 사라지면 안 된다.
    if (!destructive || destructive.outcome !== "committed") return;
    const recordId = destructive.id;
    const timer = setTimeout(() => {
      dismissStudioDestructiveActionRecord(recordId);
    }, STUDIO_DESTRUCTIVE_UNDO_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [destructive]);

  const safeMode = status.safeMode;
  const signals = [status.gpu, status.save, status.storage];
  const tone: StudioReliabilityTone = signals.some((signal) => signal?.level === "failed")
    ? "failed"
    : safeMode.active || signals.some((signal) => signal?.level === "degraded")
      ? "degraded"
      : signals.some((signal) => signal?.level === "ok")
        ? "ok"
        : "quiet";

  return (
    <div
      data-studio-reliability-status-rail
      data-studio-reliability-tone={tone}
      /*
       * 흐름 밖. 이 클래스 하나가 "아무 일 없을 때 0px" 계약이다 — 무엇이 켜지든
       * 캔버스 스테이지의 폭·높이·원점은 바뀌지 않는다.
       *
       * 자리는 캔버스 **오른쪽 아래 HUD 모서리** — 이미 도구 빠른 실행·단축키·튜토리얼
       * 버튼이 모여 있는 곳 바로 위다. 새 띠를 만들지 않고 기존 HUD 무리에 합류한다.
       * 위쪽(캔버스 상단)은 선택 명령 레인과 복구 배너의 자리라 상태 점이 그 버튼들을 덮는다.
       * 세로 오프셋만 부모가 `--studio-reliability-rail-bottom` 으로 정하고(모바일은 떠
       * 있는 편집 독을 피해야 한다), 그리기 옵션 독이 붙으면 그만큼 함께 올라간다.
       */
      className="pointer-events-none absolute inset-x-0 bottom-[calc(var(--studio-reliability-rail-bottom,3.75rem)+var(--studio-draw-options-height,0px))] z-30 flex flex-col items-end gap-2 px-2 sm:px-3"
    >
      {safeMode.active ? (
        <div
          data-studio-safe-mode-banner
          role="status"
          aria-live="polite"
          className="pointer-events-auto flex w-full max-w-[min(30rem,100%)] flex-wrap items-center justify-between gap-2 rounded-xl border border-warning/40 bg-warning-soft/30 p-2.5 text-xs text-warning shadow-sm backdrop-blur-md"
        >
          <span className="min-w-0 flex-1 leading-relaxed">
            <strong className="font-bold">안전 모드</strong>
            <span className="ml-1.5 font-medium">
              그림과 문서는 그대로예요. 화질과 속도만 낮췄습니다.
            </span>
            <span className="mt-1 block text-[0.68rem] font-medium opacity-85">
              {safeMode.reasons.map(describeStudioSafeModeReason).join(" · ")}
            </span>
          </span>
          <button
            type="button"
            data-studio-safe-mode-exit
            onClick={exitStudioSafeModeManually}
            className="ml-auto min-h-11 shrink-0 rounded-lg bg-accent/20 px-3 py-2 font-bold text-accent hover:bg-accent/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            안전 모드 해제
          </button>
        </div>
      ) : null}

      {status.gpu ? <SignalRow signal={status.gpu} /> : null}
      {status.save ? <SignalRow signal={status.save} /> : null}
      {status.storage ? <SignalRow signal={status.storage} /> : null}

      {destructive ? (
        <div
          data-studio-destructive-action-notice
          data-studio-destructive-outcome={destructive.outcome}
          role="status"
          aria-live="polite"
          className={`pointer-events-auto flex w-full max-w-[min(30rem,100%)] min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-2.5 py-1.5 text-xs shadow-sm backdrop-blur-md ${
            destructive.outcome === "committed"
              ? "border-line bg-card/95 text-fg-2"
              : "border-danger/40 bg-danger-soft/25 text-danger"
          }`}
        >
          <span className="min-w-0 flex-1 font-medium leading-relaxed">
            {destructive.summary}
          </span>
          {destructive.undo ? (
            <button
              type="button"
              data-studio-destructive-undo
              onClick={() => {
                destructive.undo?.();
                dismissStudioDestructiveActionRecord(destructive.id);
              }}
              className="ml-auto min-h-11 shrink-0 rounded-lg bg-accent/20 px-3 py-2 font-bold text-accent hover:bg-accent/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              실행 취소
            </button>
          ) : (
            <button
              type="button"
              onClick={() => dismissStudioDestructiveActionRecord(destructive.id)}
              className="ml-auto min-h-11 shrink-0 rounded-lg bg-line px-3 py-2 font-medium text-fg-3 hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              닫기
            </button>
          )}
        </div>
      ) : null}

      {rejectedStrokes.map((record) => (
        <div
          key={record.id}
          data-studio-rejected-stroke-notice
          data-studio-rejected-stroke-id={record.id}
          role="status"
          aria-live="polite"
          className="pointer-events-auto flex w-full max-w-[min(30rem,100%)] min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-warning/40 bg-warning-soft/25 px-2.5 py-1.5 text-xs text-fg-2 shadow-sm backdrop-blur-md"
        >
          <span className="min-w-0 flex-1 font-medium leading-relaxed">
            {record.provider} 엔진이 획을 확정하지 못해 미리보기를 중단했습니다. 그린 획은 보존돼 있습니다
            ({record.reason}).
          </span>
          <button
            type="button"
            data-studio-rejected-stroke-restore
            onClick={() => {
              const outcome = restoreStudioRejectedStroke(record.id);
              setRejectedStrokeNotice(
                outcome.status === "restored"
                  ? "획을 문서에 복구했습니다."
                  : outcome.status === "refused"
                    ? outcome.reason
                    : "지금은 복구할 수 없습니다. 편집기가 준비된 뒤 다시 시도하세요.",
              );
            }}
            className="ml-auto min-h-11 shrink-0 rounded-lg bg-accent/20 px-3 py-2 font-bold text-accent hover:bg-accent/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            획 복구
          </button>
          <button
            type="button"
            data-studio-rejected-stroke-dismiss
            onClick={() => {
              dismissStudioRejectedStroke(record.id);
              setRejectedStrokeNotice(null);
            }}
            className="min-h-11 shrink-0 rounded-lg bg-line px-3 py-2 font-medium text-fg-3 hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            버리기
          </button>
        </div>
      ))}
      {rejectedStrokeNotice ? (
        <p
          data-studio-rejected-stroke-outcome
          role="status"
          aria-live="polite"
          className="pointer-events-auto w-full max-w-[min(30rem,100%)] rounded-lg border border-line bg-card/95 px-2.5 py-1.5 text-xs text-fg-2 shadow-sm backdrop-blur-md"
        >
          {rejectedStrokeNotice}
        </p>
      ) : null}

      {/*
       * 상시 상태 점 — 흐름 높이 0. "아무 문제 없음"을 문장으로 상시 예약하는 대신,
       * 알고 싶을 때 눌러서(마우스·탭 포커스·Enter/Space 모두) 확인하는 자리다.
       */}
      <div className="flex w-full flex-col items-end gap-1.5">
        {detailOpen ? (
          <div
            id={RELIABILITY_DETAIL_ID}
            data-studio-reliability-detail
            className="pointer-events-auto w-full max-w-[min(20rem,100%)] rounded-xl border border-line/60 bg-panel/95 p-2.5 text-xs shadow-lg backdrop-blur-md"
          >
            <p className="mb-1.5 font-bold text-fg-2">저장·GPU·저장소 상태</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              {RELIABILITY_CHANNEL_LABELS.map(([channel, label]) => (
                <div key={channel} className="contents">
                  <dt className="font-semibold text-fg-3">{label}</dt>
                  <dd
                    data-studio-reliability-detail-channel={channel}
                    className={`min-w-0 font-medium ${status[channel] ? "text-warning" : "text-fg-2"}`}
                  >
                    {status[channel]?.title ?? "이상 없음"}
                  </dd>
                </div>
              ))}
              <dt className="font-semibold text-fg-3">안전 모드</dt>
              <dd
                data-studio-reliability-detail-channel="safe-mode"
                className={`min-w-0 font-medium ${safeMode.active ? "text-warning" : "text-fg-2"}`}
              >
                {safeMode.active
                  ? safeMode.reasons.map(describeStudioSafeModeReason).join(" · ")
                  : "꺼짐"}
              </dd>
            </dl>
          </div>
        ) : null}

        <button
          type="button"
          data-studio-reliability-chip
          aria-expanded={detailOpen}
          aria-controls={RELIABILITY_DETAIL_ID}
          aria-label={`저장·GPU·저장소 상태 · ${toneSummary(tone)}`}
          onClick={() => setDetailOpen((open) => !open)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && detailOpen) {
              event.stopPropagation();
              setDetailOpen(false);
            }
          }}
          className={`pointer-events-auto grid size-11 shrink-0 place-items-center rounded-full border backdrop-blur-md backdrop-saturate-150 transition-colors hover:bg-raised/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${toneChipClassName(tone)}`}
        >
          <span
            aria-hidden
            className={`size-2.5 rounded-full ${toneDotClassName(tone)} ${tone === "quiet" ? "" : "motion-safe:animate-pulse"}`}
          />
        </button>
      </div>
    </div>
  );
}
