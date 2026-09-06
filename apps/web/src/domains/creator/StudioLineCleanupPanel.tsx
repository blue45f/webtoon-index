import { Loader2, PenTool } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cleanupLineArt, DEFAULT_LINE_ART_CLEANUP, LINE_ART_CLEANUP_RANGES } from "./studio-line-cleanup";

// StudioImageFilterPanel과 동일한 라벨+슬라이더 한 줄 컨벤션(우측 readout 폭 고정).
const LABEL_ROW = "flex items-center justify-between gap-2 text-xs text-fg-2";
const RANGE_CLASS = "w-24 accent-accent cursor-pointer";
const READOUT_CLASS = "w-8 text-right text-[10px] tabular-nums text-fg-3";

// 스케치 선화 정리 패널 — 흐릿한 연필 스케치를 또렷한 흑백 잉크 선으로 정리한다. 100% 브라우저 실행, 무료.
// 임계값/선명도는 로컬 상태로만 조정하고(드래그마다 픽셀 파이프라인을 돌리면 큰 이미지에서 버벅일 수
// 있어) "선화 정리" 버튼을 누를 때 한 번만 실행한다 — StudioBgRemoveButton/StudioFloodFillPanel과
// 동일한 one-shot 적용 UX. 대신 적용 직후 결과 썸네일을 보여줘 슬라이더 값이 맞았는지 바로 확인할 수
// 있게 한다("live-ish" 피드백, 드래그 중 실시간 재계산은 아님).
// 결과(PNG data URL)는 onResult 로 넘겨 호출부가 이미지 src 를 교체한다(undo/redo 통합).
export function StudioLineCleanupPanel({
  src,
  onResult,
}: {
  src: string;
  onResult: (dataUrl: string) => void;
}) {
  const [threshold, setThreshold] = useState(DEFAULT_LINE_ART_CLEANUP.threshold);
  const [strength, setStrength] = useState(DEFAULT_LINE_ART_CLEANUP.strength);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  // 큰 스케치는 정리 파이프라인이 눈에 띄게 오래 걸릴 수 있어, 처리 중 다른 요소로 전환/해제되면
  // 언마운트된 패널의 결과가 뒤늦게 도착해 그 사이 다른 요소를 덮어쓸 수 있다(FloodFill과 동일 패턴).
  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 다른 이미지가 선택돼 src가 바뀌면 이전 결과 미리보기/에러는 더 이상 유효하지 않다.
  useEffect(() => {
    setPreviewSrc(null);
    setError(null);
  }, [src]);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await cleanupLineArt(src, { threshold, strength });
      if (!mountedRef.current) return; // 언마운트 후 도착한 결과는 버린다(다른 요소를 덮어쓰지 않게).
      setPreviewSrc(result);
      onResult(result);
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e instanceof Error ? e.message : "선화 정리에 실패했어요.");
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-panel/50 p-3">
      <div className="flex items-center gap-1.5 text-sm font-medium text-fg-1">
        <PenTool size={14} />
        스케치 선화 정리
      </div>

      {previewSrc && (
        <div className="overflow-hidden rounded-lg border border-line bg-card">
          <img src={previewSrc} alt="정리된 선화 미리보기" className="max-h-32 w-full object-contain" />
        </div>
      )}

      <div className="space-y-1.5">
        <label className={LABEL_ROW}>
          임계값
          <span className="flex items-center gap-1.5">
            <input
              type="range"
              min={LINE_ART_CLEANUP_RANGES.threshold.min}
              max={LINE_ART_CLEANUP_RANGES.threshold.max}
              step={LINE_ART_CLEANUP_RANGES.threshold.step}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              disabled={busy}
              className={RANGE_CLASS}
            />
            <span className={READOUT_CLASS}>{threshold.toFixed(2)}</span>
          </span>
        </label>
        <label className={LABEL_ROW}>
          선명도
          <span className="flex items-center gap-1.5">
            <input
              type="range"
              min={LINE_ART_CLEANUP_RANGES.strength.min}
              max={LINE_ART_CLEANUP_RANGES.strength.max}
              step={LINE_ART_CLEANUP_RANGES.strength.step}
              value={strength}
              onChange={(e) => setStrength(Number(e.target.value))}
              disabled={busy}
              className={RANGE_CLASS}
            />
            <span className={READOUT_CLASS}>{strength.toFixed(2)}</span>
          </span>
        </label>
      </div>

      <button
        type="button"
        onClick={() => void run()}
        disabled={busy}
        className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-on-accent transition-colors hover:bg-accent/90 disabled:opacity-60"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <PenTool size={14} />}
        {busy ? "정리하는 중…" : "선화 정리"}
      </button>

      {error ? (
        <p className="text-xs text-bad">{error}</p>
      ) : (
        <p className="text-[0.7rem] leading-relaxed text-fg-3">
          흐릿한 스케치를 또렷하게 정리해요 — 100% 브라우저 실행(무료). 임계값을 0으로 두면 이진화 없이
          그레이 톤 정리만 적용돼요.
        </p>
      )}
    </div>
  );
}
