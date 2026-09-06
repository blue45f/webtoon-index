import { Sparkles } from "lucide-react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { localizeText } from "./studio-canvas-viewport-primitives";

import { useT } from "@/shared/lib/i18n";

/** Generative-image disclosure rendered above every isolated Studio surface. */
/**
 * 생성형 AI(이미지 생성) 최초 사용 고지 다이얼로그.
 * 사용자가 처음 "생성"을 누를 때 1회 노출하고, 확인하면 곧바로 생성을 이어서 실행한다.
 * a11y: role=dialog + aria-modal, Esc 닫기, 진입 시 기본(확인) 버튼 포커스, 스크림 클릭으로 닫기.
 */
export function AiAssetNotice({ onCancel, onAcknowledge }: { onCancel: () => void; onAcknowledge: () => void }) {
  const t = useT();
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    document.addEventListener("keydown", onKey);
    const raf = requestAnimationFrame(() => confirmRef.current?.focus());
    return () => {
      document.removeEventListener("keydown", onKey);
      cancelAnimationFrame(raf);
    };
  }, [onCancel]);

  const notice = (
    <div
      role="presentation"
      onClick={(e) => {
        // 스크림(다이얼로그 바깥) 클릭일 때만 닫는다 — 내부 클릭은 currentTarget 이 아니라 무시.
        if (e.target === e.currentTarget) onCancel();
      }}
      // z-[90] — 전체화면 모달(StoryboardGrid/ScrollPreview/Timelapse/Background3D 등, z-[80])이
      // 전부 route-stage(레이아웃 래퍼)의 isolation:isolate 안에 있어, 시나리오 자동 생성처럼 그
      // z-80 모달이 열린 채로 안에서 이미지 생성을 시작하면 이 고지가 그 위에 떠야 한다(기존 z-70은
      // z-80 모달 뒤로 가려 확인 버튼을 누를 수 없었다). 법적으로 필수인 고지라 항상 최상단이어야
      // 하므로, 이 앱의 어떤 z-index보다도 높게 고정한다 — document.body에 포탈로 렌더(아래 참고)
      // 하므로 route-stage의 격리 자체도 벗어난다(z-index 숫자만으로는 그 격리를 못 벗어난다).
      className="fixed inset-0 z-[90] grid place-items-center bg-[oklch(0.08_0.01_70/0.72)] p-4 text-fg backdrop-blur-sm"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-notice-title"
        className="w-full max-w-sm rounded-2xl border border-line bg-panel p-5 shadow-xl"
      >
        <div className="mb-2 flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-full bg-accent-soft text-accent">
          <Sparkles size={16} aria-hidden />
          </span>
          <h2 id="ai-notice-title" className="text-base font-bold text-fg">
            {localizeText(t, "생성형 AI 이미지 안내", "studio.aiNotice.title")}
          </h2>
        </div>
        <p className="text-sm leading-relaxed text-fg-2">
          {localizeText(
            t,
            "이 기능은 생성형 AI(OpenAI)로 이미지를 만들어요. 만들어진 결과물에는 AI 배지가 표시돼요.",
            "studio.aiNotice.description"
          )}
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-relaxed text-fg-3">
          <li>{localizeText(t, "타인의 저작물·캐릭터, 실존 인물의 얼굴은 생성하지 않아요.", "studio.aiNotice.ruleCopyright")}</li>
          <li>{localizeText(t, "AI 결과물은 부정확하거나 의도와 다를 수 있어요.", "studio.aiNotice.ruleAccuracy")}</li>
          <li>{localizeText(t, "만든 이미지의 사용 책임은 본인에게 있어요.", "studio.aiNotice.ruleResponsibility")}</li>
        </ul>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-line bg-card px-3 py-2 text-sm font-semibold text-fg-2 transition-colors hover:bg-raised"
          >
            {localizeText(t, "취소", "studio.aiNotice.cancel")}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onAcknowledge}
            className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent/90"
          >
            {localizeText(t, "이해했어요, 생성하기", "studio.aiNotice.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
  // auth-modal.tsx와 동일한 이유로 document.body에 포탈 렌더 — 이 앱의 라우트 콘텐츠 래퍼
  // (route-stage)가 isolation:isolate를 걸어놔서, 그 안에서 아무리 z-index를 높여도 사이트 전역
  // 고정 헤더(z-50, route-stage 밖의 형제) 뒤로 가려진다(z-index는 같은 스태킹 컨텍스트 안에서만
  // 비교된다). 이 고지는 페이지 어디서 트리거되든 항상 최상단이어야 해서 격리 자체를 벗어난다.
  if (typeof document === "undefined") return null;
  return createPortal(notice, document.body);
}
