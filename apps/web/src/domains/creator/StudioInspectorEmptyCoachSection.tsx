import { useEffect, useRef } from "react";

import type { StudioInspectorAsideModel } from "./useStudioInspectorAsideModel";

export function StudioInspectorEmptyCoachSection({
  model,
}: {
  model: StudioInspectorAsideModel;
}) {
  const {
    activateCanvasTool,
    announceDrawingShortcut,
    changeInspectorLayout,
    inspectorContentMode,
    inspectorLayout,
    openFeatureTutorial,
    setUnselectedImageToolsVisible,
    setEyedropperActive,
    unselectedImageToolsVisible,
  } = model;
  const imageEditButtonRef = useRef<HTMLButtonElement>(null);
  const previousImageToolsVisibleRef = useRef(unselectedImageToolsVisible);

  useEffect(() => {
    const wasVisible = previousImageToolsVisibleRef.current;
    previousImageToolsVisibleRef.current = unselectedImageToolsVisible;
    if (
      wasVisible &&
      !unselectedImageToolsVisible &&
      inspectorContentMode === "empty"
    ) {
      imageEditButtonRef.current?.focus({ preventScroll: true });
    }
  }, [inspectorContentMode, unselectedImageToolsVisible]);

  return (
    <>
          {inspectorContentMode === "empty" && !unselectedImageToolsVisible && (
            <div
              data-testid="studio-inspector-empty-coach"
              className="rounded-xl border border-line bg-panel/40 p-3"
            >
              <p className="text-xs font-bold tracking-tight text-fg">캔버스에서 바로 시작</p>
              <p className="mt-1 text-[0.6875rem] leading-snug text-fg-3">
                빈 화면에 그려도 됩니다. V 로 선택, 모서리 핸들로 크기 조절, 레이어는 위 탭에서 바로 열려요.
              </p>
              {/*
                세 개 이내(UX 감사 2026-09-02 §5.8 빈 캔버스). 선택 도구(V)와 레이어 탭은 빈 캔버스에서
                우선순위가 낮고 탭 스트립·단축키로 이미 닿는다. 첫 획과 이미지 편집만 카드로 남긴다.
              */}
              <div className="mt-2.5 grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  aria-label="펜으로 그리기"
                  data-inspector-priority="essential"
                  data-inspector-control-id="coach.pen"
                  className="min-h-11 rounded-lg border border-accent/40 bg-accent-soft px-2.5 py-2 text-left text-xs font-semibold text-fg transition-colors hover:border-accent/70"
                  onClick={() => {
                    activateCanvasTool("draw", "pen");
                    setEyedropperActive(false);
                    announceDrawingShortcut("펜 · 캔버스에 바로 그려 보세요");
                  }}
                >
                  펜으로 그리기
                  <span className="mt-0.5 block text-[0.6875rem] font-medium text-fg-3">단축키 B</span>
                </button>
                <button
                  ref={imageEditButtonRef}
                  type="button"
                  aria-label="이미지 편집 · 전문 도구 열기"
                  data-inspector-priority="essential"
                  data-inspector-control-id="coach.image-edit"
                  className="min-h-11 rounded-lg border border-line bg-card px-2.5 py-2 text-left text-xs font-semibold text-fg-2 transition-colors hover:border-accent/50 hover:bg-raised hover:text-fg"
                  onClick={() => {
                    setUnselectedImageToolsVisible(true);
                    changeInspectorLayout({
                      ...inspectorLayout,
                      primary: "properties",
                      image: "quick",
                    });
                  }}
                >
                  이미지 편집
                  <span className="mt-0.5 block text-[0.6875rem] font-medium text-fg-3">가져오기·선택·합성본 준비</span>
                </button>
              </div>
              <button
                type="button"
                aria-label="스튜디오 사용법 따라 하기"
                data-inspector-priority="essential"
                data-inspector-control-id="coach.tutorial"
                className="mt-1.5 min-h-11 w-full rounded-lg border border-line bg-canvas/45 px-2.5 py-2 text-left text-xs font-semibold text-fg-2 transition-colors hover:border-accent/50 hover:bg-raised hover:text-fg"
                onClick={() => openFeatureTutorial(null)}
              >
                처음이라면 사용법 따라 하기
                <span className="mt-0.5 block text-[0.6875rem] font-medium text-fg-3">
                  핵심 도구를 화면에서 차례로 안내해요
                </span>
              </button>
            </div>
          )}
    </>
  );
}
