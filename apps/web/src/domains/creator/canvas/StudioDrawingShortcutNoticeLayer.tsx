import { Shapes } from "lucide-react";
import { useSyncExternalStore } from "react";

import { localizeText } from "./studio-canvas-viewport-primitives";

import type { StudioDrawingShortcutNoticeStore } from "../brush/studio-drawing-shortcut-notice-store";
import type { DrawMode, Tool } from "../studio-editor-tool-model";

import { useT } from "@/shared/lib/i18n";

export function StudioDrawingShortcutNoticeLayer({
  canvasOnlyMode,
  drawMode,
  hasAutosave,
  noticeStore,
  quickShapeActive,
  tool,
}: {
  readonly canvasOnlyMode: boolean;
  readonly drawMode: DrawMode;
  readonly hasAutosave: boolean;
  readonly noticeStore: StudioDrawingShortcutNoticeStore;
  readonly quickShapeActive: boolean;
  readonly tool: Tool;
}) {
  const t = useT();
  const snapshot = useSyncExternalStore(
    noticeStore.subscribe,
    noticeStore.getSnapshot,
    noticeStore.getSnapshot,
  );
  const notice = hasAutosave ? null : snapshot;

  return (
    <div
      className="pointer-events-none absolute bottom-16 left-1/2 z-40 -translate-x-1/2"
      style={
        tool === "draw" && !canvasOnlyMode
          ? { bottom: "calc(var(--studio-draw-options-height, 3.75rem) + 0.75rem)" }
          : undefined
      }
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {notice ? (
        <span
          key={notice.id}
          className="mx-3 block max-w-[min(28rem,calc(100vw-1.5rem))] whitespace-normal rounded-lg border border-line bg-panel/95 px-3 py-1.5 text-center text-xs font-semibold leading-relaxed text-fg shadow-lg backdrop-blur motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1"
        >
          {notice.message}
        </span>
      ) : null}
      {quickShapeActive && tool === "draw" && drawMode === "pen" && !notice ? (
        <span className="mx-3 inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-panel/95 px-3 py-1 text-center text-[0.68rem] font-semibold text-accent shadow-lg backdrop-blur">
          <Shapes size={12} aria-hidden />
          {localizeText(t, "스마트 도형 · 선·원·네모 등을 그리고 손을 떼면 다듬어요 (잠시 멈추면 미리보기)", "studio.quickShape.notice")}
        </span>
      ) : null}
    </div>
  );
}
