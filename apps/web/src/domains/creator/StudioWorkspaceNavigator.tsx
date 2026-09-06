import { useCallback, useEffect, useState } from "react";

import {
  STUDIO_WORKSPACE_LANDMARKS,
  cycleStudioWorkspaceLandmark,
  studioWorkspaceLandmarkLabel,
  type StudioWorkspaceLandmarkId,
} from "./studio-workspace-landmarks";

function studioRoot(): HTMLElement | null {
  return document.getElementById("studio-app-shell")
    ?? document.querySelector<HTMLElement>('[data-studio-editor="true"]');
}

function isVisibleLandmark(node: HTMLElement | null): node is HTMLElement {
  if (!node || node.hidden || node.getAttribute("aria-hidden") === "true") return false;
  if (node.closest("[inert]")) return false;
  const style = globalThis.getComputedStyle?.(node);
  return style?.display !== "none" && style?.visibility !== "hidden";
}

function availableLandmarks(): readonly StudioWorkspaceLandmarkId[] {
  return STUDIO_WORKSPACE_LANDMARKS.flatMap(({ id }) =>
    isVisibleLandmark(document.getElementById(id)) ? [id] : [],
  );
}

function landmarkForActiveElement(): StudioWorkspaceLandmarkId | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return null;
  for (const { id } of STUDIO_WORKSPACE_LANDMARKS) {
    const landmark = document.getElementById(id);
    if (landmark && (landmark === active || landmark.contains(active))) return id;
  }
  return null;
}

function visibleModalOwnsFocus(): boolean {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[aria-modal="true"]'),
  ).some(isVisibleLandmark);
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest(
      'input,textarea,select,[contenteditable="true"],[role="textbox"]',
    ),
  );
}

/**
 * Studio 전역 키보드 내비게이션.
 *
 * - 첫 Tab에서 보이는 건너뛰기 링크로 메뉴·도구·캔버스·패널에 바로 이동한다.
 * - F6 / Shift+F6는 현재 보이는 작업영역만 순환한다.
 * - 모달이 열려 있을 때는 모달의 포커스 트랩을 침범하지 않는다.
 * - 루트에 입력 방식과 현재 영역을 기록해 포커스 강조를 포인터와 분리한다.
 */
export function StudioWorkspaceNavigator() {
  const [announcement, setAnnouncement] = useState("");

  const focusLandmark = useCallback((id: StudioWorkspaceLandmarkId): boolean => {
    const target = document.getElementById(id);
    if (!isVisibleLandmark(target)) return false;
    target.focus({ preventScroll: true });
    target.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    const label = studioWorkspaceLandmarkLabel(id);
    setAnnouncement(`${label} 영역으로 이동했습니다.`);
    const root = studioRoot();
    if (root) root.dataset.studioActiveZone = id;
    return true;
  }, []);

  useEffect(() => {
    const root = studioRoot();
    if (!root) return;

    const markPointer = () => {
      root.dataset.studioInputModality = "pointer";
    };
    const markKeyboard = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      root.dataset.studioInputModality = "keyboard";
    };
    const trackZone = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      for (const { id } of STUDIO_WORKSPACE_LANDMARKS) {
        const landmark = document.getElementById(id);
        if (landmark && (landmark === target || landmark.contains(target))) {
          root.dataset.studioActiveZone = id;
          return;
        }
      }
    };
    const cycleZones = (event: KeyboardEvent) => {
      if (event.key !== "F6" || event.defaultPrevented) return;
      if (visibleModalOwnsFocus()) return;
      if (isEditableTarget(event.target) && event.repeat) return;
      const ids = availableLandmarks();
      const next = cycleStudioWorkspaceLandmark(
        ids,
        landmarkForActiveElement(),
        event.shiftKey ? -1 : 1,
      );
      if (!next) return;
      event.preventDefault();
      event.stopPropagation();
      focusLandmark(next);
    };

    root.dataset.studioInputModality ||= "pointer";
    document.addEventListener("pointerdown", markPointer, true);
    document.addEventListener("keydown", markKeyboard, true);
    document.addEventListener("keydown", cycleZones, true);
    document.addEventListener("focusin", trackZone, true);
    return () => {
      document.removeEventListener("pointerdown", markPointer, true);
      document.removeEventListener("keydown", markKeyboard, true);
      document.removeEventListener("keydown", cycleZones, true);
      document.removeEventListener("focusin", trackZone, true);
    };
  }, [focusLandmark]);

  return (
    <>
      <nav
        aria-label="작업 영역 바로가기"
        aria-keyshortcuts="F6 Shift+F6"
        data-studio-skip-nav="true"
        data-studio-workspace-navigator="true"
      >
        <div>
          {STUDIO_WORKSPACE_LANDMARKS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              data-studio-skip-link="true"
              onClick={() => focusLandmark(id)}
            >
              {label}로 이동
            </button>
          ))}
        </div>
      </nav>
      <span
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-studio-workspace-announcer="true"
      >
        {announcement}
      </span>
    </>
  );
}
