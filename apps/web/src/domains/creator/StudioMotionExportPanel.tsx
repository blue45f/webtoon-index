/**
 * StudioMotionExportPanel — 작품 상세(작성자 전용)에서 효과툰을 "모션툰 영상(WebM)"으로
 * 내보내는 패널. WorkFxPanel에 저장된 doc.fx 연출(리빌·강조·분위기·BGM)을
 * studio-motion-export 엔진으로 타임라인 리플레이하며 실시간 인코딩한다.
 * 녹화는 영상 길이만큼 걸리므로 진행률 표시 + 취소를 제공한다.
 */
import { Clapperboard, Download, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { downloadBlob } from "./export/studio-export";
import {
  MOTION_HOLD_PRESETS,
  MOTION_RESOLUTION_PRESETS,
  isMotionExportCancelled,
  isMotionExportSupported,
  loadMotionCutImages,
  motionExportFileName,
  planMotionExport,
  startMotionExport,
  type MotionExportHandle,
  type MotionExportProgress,
} from "./export/studio-motion-export";
import { findBgmMood } from "./studio-bgm";
import { REVEAL_PRESETS, findAmbientPreset, readWorkFx } from "./studio-motion-fx";

import type { WorkDetail } from "@/src/infrastructure/creator-client";

import { buttonClass } from "@/shared/components/ui/button-utils";

function formatSeconds(sec: number): string {
  if (sec <= 0) return "0초";
  const rounded = Math.round(sec);
  if (rounded < 60) return `${rounded}초`;
  return `${Math.floor(rounded / 60)}분 ${rounded % 60}초`;
}

export function StudioMotionExportPanel({ work }: { work: WorkDetail }) {
  const [open, setOpen] = useState(false);
  const [resolutionId, setResolutionId] = useState<string>(MOTION_RESOLUTION_PRESETS[0].id);
  const [holdId, setHoldId] = useState<string>(MOTION_HOLD_PRESETS[1].id);
  const [muted, setMuted] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [progress, setProgress] = useState<MotionExportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);
  const handleRef = useRef<MotionExportHandle | null>(null);

  // 페이지 이탈/언마운트 시 진행 중인 녹화를 반드시 중단(트랙·오디오 정리).
  useEffect(() => {
    return () => {
      handleRef.current?.cancel();
      handleRef.current = null;
    };
  }, []);

  const supported = isMotionExportSupported();
  const fx = readWorkFx(work.doc);
  const hasBgm = fx.bgmMood !== "" || fx.bgmUrl !== "";
  const resolution =
    MOTION_RESOLUTION_PRESETS.find((r) => r.id === resolutionId) ?? MOTION_RESOLUTION_PRESETS[0];
  const hold = MOTION_HOLD_PRESETS.find((h) => h.id === holdId) ?? MOTION_HOLD_PRESETS[1];
  // 순수 플래너 — 렌더마다 예상 길이를 미리 계산해 보여준다(내보내기 시 같은 플랜 사용).
  const plan = planMotionExport(work.pages.length, fx, {
    width: resolution.width,
    height: resolution.height,
    holdSec: hold.holdSec,
  });
  const exporting = preparing || progress != null;

  const revealLabel = REVEAL_PRESETS.find((p) => p.id === fx.reveal)?.label ?? "없음";
  const ambientLabel = findAmbientPreset(fx.ambient)?.label ?? "없음";
  const bgmLabel = fx.bgmUrl ? "내 음악" : (findBgmMood(fx.bgmMood)?.label ?? "없음");

  async function exportVideo() {
    if (exporting || !supported) return;
    setError(null);
    setDoneMsg(null);
    if (work.pages.length === 0) {
      setError("내보낼 컷(페이지)이 없어요.");
      return;
    }
    setPreparing(true);
    try {
      const images = await loadMotionCutImages(work.pages);
      const handle = startMotionExport({
        plan,
        images,
        muted: muted || !hasBgm,
        onProgress: (p) => setProgress(p),
      });
      handleRef.current = handle;
      setPreparing(false);
      const result = await handle.done;
      downloadBlob(result.blob, motionExportFileName(work.title));
      setDoneMsg(
        result.audio === "failed"
          ? "영상을 저장했어요. 다만 배경음악 믹스에 실패해 무음으로 내보냈어요."
          : result.audio === "mixed"
            ? "배경음악을 포함한 모션툰 영상을 저장했어요."
            : "모션툰 영상을 저장했어요."
      );
    } catch (err) {
      if (!isMotionExportCancelled(err)) {
        setError(err instanceof Error ? err.message : "영상을 내보내지 못했어요.");
      }
    } finally {
      handleRef.current = null;
      setPreparing(false);
      setProgress(null);
    }
  }

  const progressPct = Math.round((progress?.ratio ?? 0) * 100);
  const statusLabel = preparing
    ? "컷 이미지 준비 중…"
    : progress?.phase === "finalize"
      ? "영상 파일 생성 중…"
      : "녹화 중… (실제 재생 시간만큼 걸려요)";

  return (
    <div className="mt-4 rounded-xl border border-line bg-card/50">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-3.5 py-2.5 text-xs font-medium text-fg-2 transition-colors hover:text-fg"
      >
        <Clapperboard size={13} className="text-accent" />
        모션툰 영상 내보내기 (WebM)
        <span className="ml-auto text-[0.7rem] text-fg-3">
          {work.pages.length > 0 ? `${work.pages.length}컷 · 약 ${formatSeconds(plan.durationSec)}` : "컷 없음"}
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-3 border-t border-line px-3.5 py-3">
          <p className="rounded-lg border border-line bg-panel/40 px-2.5 py-2 text-[0.7rem] leading-relaxed text-fg-3">
            효과툰 설정(등장 {revealLabel} · 분위기 {ambientLabel} · BGM {bgmLabel})을 그대로 재생하며
            영상 한 편으로 인코딩해요. SNS·쇼츠 공유용으로 쓸 수 있어요. 녹화는 실시간이라 영상
            길이만큼 시간이 걸려요.
          </p>

          <label className="flex flex-col gap-1 text-xs text-fg-2">
            해상도
            <select
              value={resolutionId}
              onChange={(e) => setResolutionId(e.target.value)}
              disabled={exporting}
              className="h-9 rounded-lg border border-line bg-canvas px-2 text-sm text-fg outline-none focus:border-accent/50 disabled:opacity-50"
            >
              {MOTION_RESOLUTION_PRESETS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs text-fg-2">
            컷 읽기 시간 (영상 길이 결정)
            <select
              value={holdId}
              onChange={(e) => setHoldId(e.target.value)}
              disabled={exporting}
              className="h-9 rounded-lg border border-line bg-canvas px-2 text-sm text-fg outline-none focus:border-accent/50 disabled:opacity-50"
            >
              {MOTION_HOLD_PRESETS.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.label}
                </option>
              ))}
            </select>
          </label>

          {hasBgm ? (
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-fg-2">
              <input
                type="checkbox"
                checked={muted}
                onChange={(e) => setMuted(e.target.checked)}
                disabled={exporting}
                className="size-3.5 cursor-pointer accent-[var(--color-accent)] disabled:cursor-not-allowed"
              />
              음소거로 내보내기 (배경음악 제외)
            </label>
          ) : (
            <p className="text-[0.7rem] text-fg-3">
              이 작품엔 배경음악 설정이 없어 무음 영상으로 내보내요. (효과툰 설정에서 BGM을 켤 수 있어요.)
            </p>
          )}

          {exporting && (
            <div className="rounded-lg border border-line bg-panel/40 px-2.5 py-2">
              <div className="flex items-center justify-between text-[0.7rem] text-fg-2">
                <span aria-live="polite">{statusLabel}</span>
                <span className="numeral">{progressPct}%</span>
              </div>
              <div
                role="progressbar"
                aria-label="영상 내보내기 진행률"
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
            </div>
          )}

          {!supported && (
            <p className="text-xs text-bad">
              이 브라우저는 영상 녹화(MediaRecorder/WebM)를 지원하지 않아요. 크롬·엣지·파이어폭스에서
              시도해주세요.
            </p>
          )}
          {error && <p className="text-xs text-bad">{error}</p>}
          {doneMsg && !error && <p className="text-xs text-good">{doneMsg}</p>}

          <div className="flex items-center justify-end gap-2">
            {exporting && (
              <button
                type="button"
                onClick={() => handleRef.current?.cancel()}
                disabled={preparing}
                className={buttonClass({ size: "sm", variant: "outline", className: "gap-1.5" })}
              >
                <Square size={13} />
                취소
              </button>
            )}
            <button
              type="button"
              onClick={exportVideo}
              disabled={exporting || !supported || work.pages.length === 0}
              className={buttonClass({ size: "sm", variant: "solid", className: "gap-1.5" })}
            >
              <Download size={14} />
              영상 내보내기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
