import { X } from "lucide-react";
import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  getStudio2dAssetMetadata,
  isLargeStudio2dAsset,
  studio2dDisplayName,
  studio2dResolutionLabel,
} from "./studio-2d-asset-quality";
import { studio2dImageSource } from "./studio-2d-image-source";
import { useStudio2dImageReadiness } from "./useStudio2dImageReadiness";
import { useStudioModalSheet } from "./useStudioModalSheet";

import type { Studio2dScene } from "./studio-2d-asset-quality";

export function Studio2dScenePreview({ scene, disabled, onPick, onClose }: {
  readonly scene: Studio2dScene;
  readonly disabled: boolean;
  readonly onPick: (scene: Studio2dScene) => void;
  readonly onClose: () => void;
}) {
  const id = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLElement | null>(typeof document === "undefined" ? null : document.body);
  const [pixelView, setPixelView] = useState(false);
  const metadata = getStudio2dAssetMetadata(scene);
  const title = studio2dDisplayName(scene);
  const { imageRef, imageKey, state, retry } = useStudio2dImageReadiness(studio2dImageSource(scene), metadata);
  const status = state.status;
  const actualPixels = state.pixels;
  const actualSize = actualPixels ? `${actualPixels.width} × ${actualPixels.height}px` : "";
  const mismatch = status === "mismatch";
  const retryImage = () => { setPixelView(false); retry(); };

  useStudioModalSheet({ activeKey: scene.id, dialogRef, rootRef, onDismiss: onClose });
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[140] flex items-center justify-center p-3 sm:p-6">
      <button type="button" tabIndex={-1} aria-hidden="true" data-studio-modal-backdrop="true"
        className="absolute inset-0 bg-black/75" onClick={onClose} />
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`} data-studio-shortcut-boundary="true" tabIndex={-1}
        className="relative flex max-h-[92dvh] w-full min-w-0 max-w-5xl flex-col overflow-hidden rounded-2xl border border-line bg-card text-fg shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-line p-4">
          <div className="min-w-0">
            <h2 id={`${id}-title`} className="text-sm font-bold">{title}</h2>
            <p id={`${id}-description`} className="mt-1 text-xs text-fg-3">{studio2dResolutionLabel(scene)} · {metadata?.mediaType === "image/jpeg" ? "JPEG" : metadata ? "PNG" : scene.imgSrc ? "이미지" : "SVG"}</p>
          </div>
          <button type="button" aria-label="배경 미리보기 닫기" onClick={onClose}
            className="rounded-lg p-2 hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"><X size={18} /></button>
        </header>
        <div className="min-h-0 overflow-y-auto p-3 sm:p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-fg-3">삽입 전에 구도·인물·문자 형태를 확인하세요.</span>
            <button type="button" aria-pressed={pixelView} disabled={status !== "ready"} onClick={() => { setPixelView((value) => !value); if (!pixelView) viewportRef.current?.focus(); }}
              className="rounded-lg border border-line px-3 py-1.5 disabled:opacity-40">{pixelView ? "화면에 맞추기" : "원본 픽셀 보기"}</button>
          </div>
          <div ref={viewportRef} role="region" className="max-h-[55dvh] overflow-auto rounded-lg bg-neutral-950" tabIndex={-1}
            aria-label="배경 원본 이미지 영역">
            <img key={imageKey} ref={imageRef} src={studio2dImageSource(scene)} alt={title} decoding="async"
              className={pixelView ? "block max-w-none" : "mx-auto block max-h-[55dvh] max-w-full object-contain"}
              style={pixelView && actualPixels ? { width: actualPixels.width, height: actualPixels.height } : undefined}
              />
          </div>
          <div className="mt-3 space-y-2 text-xs leading-relaxed">
            {status === "loading" && <p role="status">원본 이미지를 불러오는 중…</p>}
            {status === "error" && <div role="alert" className="rounded-lg border border-bad/40 bg-bad/10 p-3 text-bad">
              {state.reason === "timeout" ? "연결 또는 이미지 처리 시간이 초과되어 삽입할 수 없습니다." : "원본을 불러오지 못해 삽입할 수 없습니다."}
              <button type="button" className="ml-2 underline" onClick={retryImage}>다시 불러오기</button>
            </div>}
            {mismatch && <p role="alert" className="text-bad">실제 이미지 크기({actualSize})가 검수 기록과 다릅니다. 이 파일은 재검수 전 삽입할 수 없습니다. <button type="button" className="ml-2 underline" onClick={retryImage}>다시 불러오기</button></p>}
            {metadata && <p className="text-fg-3">{metadata.environment} · {metadata.timeOfDay} · {metadata.containsPeople ? "인물 포함" : "인물 없는 배경"} · {isLargeStudio2dAsset(metadata) ? "큰 원본" : "소형 컷용 원본"}</p>}
            {metadata?.review.notes.map((note) => <p key={note} className="rounded-lg border border-line bg-raised p-2">{note}</p>)}
            {scene.imgSrc && <p className="rounded-lg border border-line p-2 text-fg-3">기존 카탈로그 소재 · 이용 권리 기록 미확인. 상업 이용·소재 재배포 전 출처와 이용 조건을 확인하세요. 추천 표시는 라이선스 승인이 아닙니다.</p>}
          </div>
        </div>
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-line p-4">
          <p className="text-xs text-fg-3">기존 패널 선택 범위에 삽입됩니다. 원본보다 크게 확대하면 흐려질 수 있습니다.</p>
          <button type="button" disabled={disabled || status !== "ready" || mismatch}
            onClick={() => { if (!disabled && status === "ready" && !mismatch) { onPick(scene); onClose(); } }}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-on-accent disabled:cursor-not-allowed disabled:opacity-40">이 배경 삽입</button>
        </footer>
      </section>
    </div>, document.body,
  );
}
