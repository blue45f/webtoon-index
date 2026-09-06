import { AlertTriangle, Loader2, Play, Square, Video, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { downloadBlob } from "./export/studio-export";
import {
  TIMELAPSE_DURATION_PRESETS,
  TIMELAPSE_RESOLUTION_PRESETS,
  isTimelapseExportCancelled,
  isTimelapseRecordingSupported,
  planTimelapseExport,
  selectTimelapsePageSteps,
  startTimelapseExport,
  timelapseExportFileName,
  type TimelapseCaptureStep,
  type TimelapseExportHandle,
  type TimelapseExportProgress,
} from "./studio-timelapse";
import { StudioToolHintTarget } from "./StudioToolHint";

import type { MotionCutImage } from "./export/studio-motion-export";
import type { HistorySnapshot } from "./studio-history-labels";

export type StudioTimelapsePanelProps = {
  open: boolean;
  onClose: () => void;
  /** 이 페이지(pageId)의 히스토리만 추린다. */
  pageId: string;
  /** StudioPage의 pagesHistory를 **pagesHi+1까지 slice한 것**을 넘긴다(뒤 redo 가지 제외 —
   * 영상이 "지금 화면에 보이는 상태"로 끝나도록. StudioPage의 commit 계열 함수와 동일한
   * `pagesHistory.slice(0, pagesHi + 1)` 경계를 그대로 재사용). */
  history: readonly HistorySnapshot[];
  /** 파일명에 쓸 작품 제목. */
  title: string;
  /** true면 녹화 불가(마스터 편집 중엔 Stage가 페이지가 아닌 마스터를 그린다). */
  masterEditMode: boolean;
  captureStep: TimelapseCaptureStep;
  /** 캡처 시작 직전/종료 직후(성공·실패·취소 불문) 1회씩 호출 — StudioPage가 pagesHi 저장/
   * 복원과 입력 차단 플래그를 여기서 토글한다. */
  onRecordingStart: () => void;
  onRecordingEnd: () => void;
};

// StudioBackground3D.tsx와 동일한 로컬 스타일 상수(자체완결 모달 컨벤션).
const CONTROL_BUTTON =
  "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45";
const ICON_BUTTON =
  "inline-grid size-9 place-items-center rounded-lg border border-line bg-card text-fg-3 transition-colors hover:bg-accent-soft hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function formatSeconds(sec: number): string {
  if (sec <= 0) return "0초";
  const rounded = Math.round(sec);
  return rounded < 60 ? `${rounded}초` : `${Math.floor(rounded / 60)}분 ${rounded % 60}초`;
}

export function StudioTimelapsePanel({
  open,
  onClose,
  pageId,
  history,
  title,
  masterEditMode,
  captureStep,
  onRecordingStart,
  onRecordingEnd,
}: StudioTimelapsePanelProps) {
  const [resolutionId, setResolutionId] = useState<string>(TIMELAPSE_RESOLUTION_PRESETS[0].id);
  const [durationId, setDurationId] = useState<string>(TIMELAPSE_DURATION_PRESETS[1].id);
  const [preparing, setPreparing] = useState(false);
  const [progress, setProgress] = useState<TimelapseExportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);
  const handleRef = useRef<TimelapseExportHandle | null>(null);

  // 언마운트 시 진행 중인 녹화를 반드시 중단(트랙 정리) — StudioMotionExportPanel과 동일 규약.
  useEffect(() => {
    return () => {
      handleRef.current?.cancel();
      handleRef.current = null;
    };
  }, []);

  // ESC로 닫기 — StudioBackground3D/StudioVrmPoser 등 이 세션의 다른 모달들과 동일한 관례.
  // 녹화/내보내기 진행 중엔(exporting) 무시해 중간에 잘리는 걸 막는다(닫기 버튼도 이미 disabled).
  // exporting은 이 훅 아래에서 계산되는 파생값이라 여기서는 preparing/progress로 직접 판정한다.
  useEffect(() => {
    if (!open || preparing || progress != null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, preparing, progress, onClose]);

  if (!open) return null;

  const supported = isTimelapseRecordingSupported();
  const steps = selectTimelapsePageSteps(history, pageId);
  const hasContent = steps.some((s) => s.elementCount > 0);
  const resolution =
    TIMELAPSE_RESOLUTION_PRESETS.find((r) => r.id === resolutionId) ?? TIMELAPSE_RESOLUTION_PRESETS[0];
  const duration = TIMELAPSE_DURATION_PRESETS.find((d) => d.id === durationId) ?? TIMELAPSE_DURATION_PRESETS[1];
  const plan = planTimelapseExport(steps, {
    width: resolution.width,
    height: resolution.height,
    targetDurationSec: duration.targetDurationSec,
  });
  const exporting = preparing || progress != null;
  const recordDisabledReason = !supported
    ? "이 브라우저는 MediaRecorder/WebM 영상 녹화를 지원하지 않아요."
    : masterEditMode
      ? "마스터 편집을 종료하면 타임랩스를 만들 수 있어요."
      : !hasContent
        ? "이 페이지에 그린 내용이 생기면 타임랩스를 만들 수 있어요."
        : exporting
          ? "타임랩스 영상을 만드는 중이에요. 완료되거나 취소한 뒤 다시 실행할 수 있어요."
          : undefined;
  const canRecord = recordDisabledReason === undefined;

  async function record() {
    if (!canRecord) return;
    setError(null);
    setDoneMsg(null);
    setPreparing(true);
    onRecordingStart();
    try {
      const wrappedCapture: TimelapseCaptureStep = async (historyIndex, targetWidth): Promise<MotionCutImage> =>
        captureStep(historyIndex, targetWidth);
      const handle = startTimelapseExport({
        plan,
        captureStep: wrappedCapture,
        onProgress: (p) => {
          setPreparing(false);
          setProgress(p);
        },
      });
      handleRef.current = handle;
      const result = await handle.done;
      downloadBlob(result.blob, timelapseExportFileName(title));
      setDoneMsg("타임랩스 영상을 저장했어요.");
    } catch (err) {
      if (!isTimelapseExportCancelled(err)) {
        setError(err instanceof Error ? err.message : "타임랩스 영상을 만들지 못했어요.");
      }
    } finally {
      handleRef.current = null;
      setPreparing(false);
      setProgress(null);
      onRecordingEnd();
    }
  }

  const progressPct = Math.round((progress?.ratio ?? 0) * 100);
  const statusLabel =
    preparing || progress?.phase === "capture"
      ? `그리기 과정을 캡처하는 중… (${progress?.captured ?? 0}/${progress?.total ?? steps.length}단계)`
      : progress?.phase === "finalize"
        ? "영상 파일 생성 중…"
        : "영상으로 녹화하는 중…";

  const modal = (
    <div
      aria-modal="true"
      role="dialog"
      className="fixed inset-0 z-[80] bg-[oklch(0.08_0.01_70/0.82)] p-2 text-fg backdrop-blur-sm sm:p-4"
    >
      <div className="mx-auto flex h-full max-h-full max-w-[560px] flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-[0_24px_80px_oklch(0.05_0.01_70/0.55)]">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <p className="eyebrow flex items-center gap-1.5 text-accent">
              <Video size={14} aria-hidden /> 타임랩스
            </p>
            <h2 className="mt-1 text-lg font-bold tracking-tight text-fg">그리기 과정 타임랩스</h2>
          </div>
          <button
            type="button"
            aria-label="닫기"
            title="닫기"
            disabled={exporting}
            className={ICON_BUTTON}
            onClick={onClose}
          >
            <X size={17} aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <p className="mb-3 rounded-lg border border-line bg-card/60 px-2.5 py-2 text-[0.7rem] leading-relaxed text-fg-3">
            이 페이지를 그린 과정을 빠르게 재생하는 영상(WebM)으로 저장해요. 지금 이 브라우저 탭에서
            작업한 기록만 담겨요 — 새로고침하거나 다른 기기에서 이어작업했다면 그 이전 기록은
            포함되지 않아요.
          </p>

          {masterEditMode && (
            <p className="mb-3 flex items-start gap-2 rounded-lg border border-line bg-card/70 px-2.5 py-2 text-xs text-fg-3">
              <AlertTriangle className="mt-0.5 shrink-0 text-accent" size={14} aria-hidden />
              마스터 편집 중에는 타임랩스를 만들 수 없어요. 마스터 편집을 종료한 뒤 다시 시도해주세요.
            </p>
          )}
          {!masterEditMode && !hasContent && (
            <p className="mb-3 rounded-lg border border-line bg-card/70 px-2.5 py-2 text-xs text-fg-3">
              아직 그린 내용이 없어요. 먼저 그림을 그려보세요.
            </p>
          )}

          <label className="mb-3 flex flex-col gap-1 text-xs text-fg-2">
            해상도
            <select
              value={resolutionId}
              onChange={(e) => setResolutionId(e.target.value)}
              disabled={exporting}
              className="h-9 rounded-lg border border-line bg-canvas px-2 text-sm text-fg outline-none focus:border-accent/50 disabled:opacity-50"
            >
              {TIMELAPSE_RESOLUTION_PRESETS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>

          <label className="mb-3 flex flex-col gap-1 text-xs text-fg-2">
            영상 길이
            <select
              value={durationId}
              onChange={(e) => setDurationId(e.target.value)}
              disabled={exporting}
              className="h-9 rounded-lg border border-line bg-canvas px-2 text-sm text-fg outline-none focus:border-accent/50 disabled:opacity-50"
            >
              {TIMELAPSE_DURATION_PRESETS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>

          <p className="mb-3 text-[0.7rem] text-fg-3">
            {hasContent ? `${steps.length}단계 · 약 ${formatSeconds(plan.durationSec)}` : "단계 없음"}
          </p>

          {exporting && (
            <div className="rounded-lg border border-line bg-card/40 px-2.5 py-2">
              <div className="flex items-center justify-between text-[0.7rem] text-fg-2">
                <span aria-live="polite">{statusLabel}</span>
                <span className="numeral">{progressPct}%</span>
              </div>
              <div
                role="progressbar"
                aria-label="타임랩스 녹화 진행률"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progressPct}
                className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-raised"
              >
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-150"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <p className="mt-1.5 text-[0.68rem] text-fg-3">
                녹화 중에는 캔버스를 편집할 수 없어요. 완료될 때까지 잠시만 기다려주세요.
              </p>
            </div>
          )}

          {!supported && (
            <p className="mt-3 text-xs text-bad">
              이 브라우저는 영상 녹화(MediaRecorder/WebM)를 지원하지 않아요. 크롬·엣지·파이어폭스에서
              시도해주세요.
            </p>
          )}
          {error && <p className="mt-3 text-xs text-bad">{error}</p>}
          {doneMsg && !error && <p className="mt-3 text-xs text-good">{doneMsg}</p>}
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-4 py-3">
          {exporting && (
            <button
              type="button"
              onClick={() => handleRef.current?.cancel()}
              disabled={preparing}
              className={cx(CONTROL_BUTTON, "border-line bg-card text-fg-2 hover:bg-raised")}
            >
              <Square size={13} /> 취소
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={exporting}
            className={cx(CONTROL_BUTTON, "border-line bg-card text-fg-2 hover:bg-raised")}
          >
            닫기
          </button>
          <StudioToolHintTarget
            disabled={Boolean(recordDisabledReason)}
            unavailableReason={recordDisabledReason}
            preferredSide="top"
            hint={{
              id: "timelapse-record",
              title: "타임랩스 영상 만들기",
              description: "현재 페이지의 편집 히스토리를 빠르게 재생해 그리기 과정 WebM 영상으로 저장합니다.",
              preview: "timelapse",
              tip: "해상도와 목표 길이를 먼저 고르면 기록 단계가 자동으로 압축되어 영상 길이에 맞춰져요.",
            }}
          >
            <button
              type="button"
              onClick={() => void record()}
              disabled={!canRecord}
              className={cx(CONTROL_BUTTON, "border-accent/60 bg-accent text-on-accent hover:bg-accent/90")}
            >
              {preparing ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              타임랩스 영상 만들기
            </button>
          </StudioToolHintTarget>
        </footer>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(modal, document.body);
}
